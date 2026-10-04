import { describe, expect, it, vi } from "vitest";
import { extractMonetization } from "@/lib/monetization";
import { checkToolCall, propose, provision, type GuardState } from "@/lib/paypal/agent";
import { createPlanArgs, proposeCatalog, type CatalogProposal } from "@/lib/paypal/catalog";
import type { ChatClient, ChatMessage, ToolCall } from "@/lib/paypal/chat";
import { ToolCallError, createDryRunExecutor, type ToolExecutor } from "@/lib/paypal/toolkit";
import { FORCED_SIGNUP, SAAS_WITH_PAYPAL } from "../fixtures/pages";
import { PLAN_CREATED, PRODUCT_CREATED } from "../fixtures/paypal";

const site = { url: "https://acme.dev/", title: "Acme Notes" };
const proposal = (): CatalogProposal => proposeCatalog(extractMonetization(SAAS_WITH_PAYPAL), site);

/** Executor that replays mocked PayPal toolkit responses. */
function mockExecutor(overrides: Partial<Record<string, (args: Record<string, unknown>) => Record<string, unknown>>> = {}) {
  let plan = 0;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const executor: ToolExecutor = {
    simulated: false,
    tools: () => [{ type: "function", function: { name: "create_product" } }],
    async call(name, args) {
      calls.push({ name, args });
      const o = overrides[name];
      if (o) return o(args);
      if (name === "create_product") return PRODUCT_CREATED;
      if (name === "create_subscription_plan") return { ...PLAN_CREATED, id: `P-MOCK${++plan}` };
      if (name === "create_order") {
        return { id: "ORDER123456", status: "CREATED", links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER123456" }] };
      }
      throw new ToolCallError(name, "unexpected");
    },
  };
  return { executor, calls };
}

function toolCall(name: string, args: unknown, id = name): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** LLM stub that plays back scripted turns. */
function scriptedLlm(turns: (ToolCall[] | string)[]) {
  const seen: ChatMessage[][] = [];
  const llm: ChatClient = {
    model: "mock",
    complete: vi.fn(async (messages: ChatMessage[]) => {
      seen.push([...messages]);
      const turn = turns.shift() ?? "Done.";
      return typeof turn === "string" ? { content: turn, toolCalls: [] } : { content: null, toolCalls: turn };
    }),
  };
  return { llm, seen };
}

describe("propose", () => {
  it("uses rules and a plain rationale without an LLM", async () => {
    const p = await propose(extractMonetization(SAAS_WITH_PAYPAL), site, null);
    expect(p.source).toBe("rules");
    expect(p.rationale).toMatch(/2 PayPal subscription plans/);
  });

  it("applies AI naming but ignores any attempt to change prices", async () => {
    const llm: ChatClient = {
      model: "mock",
      complete: async () => ({
        toolCalls: [],
        content: JSON.stringify({
          productName: "Acme Notes",
          plans: [
            { tierId: "starter", name: "Starter", description: "For solo devs", trialDays: 14, amount: "1.00" },
            { tierId: "pro", include: false },
          ],
          rationale: "Two clear plans.",
        }),
      }),
    };
    const p = await propose(extractMonetization(SAAS_WITH_PAYPAL), site, llm);
    expect(p.source).toBe("ai");
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0]).toMatchObject({ amount: "9.00", description: "For solo devs", trialDays: 14 });
  });

  it("falls back to rules when the LLM returns garbage", async () => {
    const llm: ChatClient = { model: "mock", complete: async () => ({ content: "not json", toolCalls: [] }) };
    const p = await propose(extractMonetization(SAAS_WITH_PAYPAL), site, llm);
    expect(p.source).toBe("rules");
  });
});

describe("checkToolCall guard", () => {
  const approved = proposal();
  const fresh = (): GuardState => ({ productId: "PROD-1", createdPlanTiers: new Set(), createdOrderTiers: new Set() });

  it("allows an approved plan", () => {
    expect(checkToolCall("create_subscription_plan", createPlanArgs(approved.plans[1], "PROD-1"), approved, fresh())).toEqual({
      ok: true,
      tierId: "pro",
    });
  });

  it("rejects a tampered price, wrong product, duplicates, and other tools", () => {
    const args = createPlanArgs({ ...approved.plans[1], amount: "1.00" }, "PROD-1");
    expect(checkToolCall("create_subscription_plan", args, approved, fresh()).ok).toBe(false);
    expect(checkToolCall("create_subscription_plan", createPlanArgs(approved.plans[1], "PROD-OTHER"), approved, fresh()).ok).toBe(false);
    const state = fresh();
    state.createdPlanTiers.add("pro");
    expect(checkToolCall("create_subscription_plan", createPlanArgs(approved.plans[1], "PROD-1"), approved, state).ok).toBe(false);
    expect(checkToolCall("create_refund", {}, approved, fresh()).ok).toBe(false);
    expect(checkToolCall("create_product", { name: "Evil Corp" }, approved, { ...fresh(), productId: null }).ok).toBe(false);
  });

  it("rejects a plan without payment_preferences, which PayPal requires", () => {
    const args = { ...createPlanArgs(approved.plans[1], "PROD-1") } as Record<string, unknown>;
    delete args.payment_preferences;
    const verdict = checkToolCall("create_subscription_plan", args, approved, fresh());
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.reason).toMatch(/payment_preferences/);
  });
});

describe("provision", () => {
  it("creates the product and every plan deterministically without an LLM", async () => {
    const { executor, calls } = mockExecutor();
    const res = await provision(proposal(), executor, null);
    expect(res.mode).toBe("rules");
    expect(res.complete).toBe(true);
    expect(calls.map((c) => c.name)).toEqual(["create_product", "create_subscription_plan", "create_subscription_plan"]);
    expect(res.plans.map((p) => p.paypalPlanId)).toEqual(["P-MOCK1", "P-MOCK2"]);
    expect(res.productId).toBe(PRODUCT_CREATED.id);
  });

  it("runs the LLM tool loop, feeds back guard rejections, and lets the agent fix its call", async () => {
    const approved = proposal();
    const { executor, calls } = mockExecutor();
    const { llm, seen } = scriptedLlm([
      [toolCall("create_product", { name: "Acme Notes", type: "SERVICE" })],
      [toolCall("create_subscription_plan", createPlanArgs({ ...approved.plans[0], amount: "5.00" }, PRODUCT_CREATED.id), "bad")],
      [
        toolCall("create_subscription_plan", createPlanArgs(approved.plans[0], PRODUCT_CREATED.id), "s"),
        toolCall("create_subscription_plan", createPlanArgs(approved.plans[1], PRODUCT_CREATED.id), "p"),
      ],
      "never requested",
    ]);
    const res = await provision(approved, executor, llm);

    expect(res.mode).toBe("agent");
    // Stops as soon as everything exists instead of spending a turn on a summary.
    expect(seen).toHaveLength(3);
    expect(res.summary).toBe("Created Acme Notes in PayPal with 2 plans.");
    expect(res.complete).toBe(true);
    expect(res.steps.map((s) => s.status)).toEqual(["ok", "rejected", "ok", "ok"]);
    expect(res.steps.every((s) => s.by === "agent")).toBe(true);
    // The tampered price never reached PayPal.
    expect(calls.filter((c) => c.name === "create_subscription_plan")).toHaveLength(2);
    const rejection = seen[2].find((m) => m.role === "tool" && m.tool_call_id === "bad");
    expect(rejection && "content" in rejection && rejection.content).toMatch(/REJECTED by Shipgrade guard/);
  });

  it("completes plans the agent forgot", async () => {
    const { executor } = mockExecutor();
    const { llm } = scriptedLlm([[toolCall("create_product", { name: "Acme Notes", type: "SERVICE" })], "All done!"]);
    const res = await provision(proposal(), executor, llm);
    expect(res.complete).toBe(true);
    expect(res.steps.filter((s) => s.by === "rules").map((s) => s.tool)).toEqual([
      "create_subscription_plan",
      "create_subscription_plan",
    ]);
  });

  it("nudges once when the agent stops with plans still missing", async () => {
    const approved = proposal();
    const { executor } = mockExecutor();
    const { llm, seen } = scriptedLlm([
      [toolCall("create_product", { name: "Acme Notes", type: "SERVICE" })],
      "All done!",
      [
        toolCall("create_subscription_plan", createPlanArgs(approved.plans[0], PRODUCT_CREATED.id), "s"),
        toolCall("create_subscription_plan", createPlanArgs(approved.plans[1], PRODUCT_CREATED.id), "p"),
      ],
    ]);
    const res = await provision(approved, executor, llm);
    const nudge = seen[2].at(-1);
    expect(nudge && "content" in nudge && nudge.content).toMatch(/Still missing: starter, pro/);
    expect(res.steps.every((s) => s.by === "agent")).toBe(true);
  });

  it("creates orders for one-time plans and keeps the approve link", async () => {
    const { executor } = mockExecutor();
    const res = await provision(proposeCatalog(extractMonetization(FORCED_SIGNUP), site), executor, null);
    expect(res.plans.every((p) => p.orderId === "ORDER123456")).toBe(true);
    expect(res.plans[0].approveUrl).toMatch(/sandbox\.paypal\.com\/checkoutnow/);
  });

  it("reports PayPal errors without throwing", async () => {
    const { executor } = mockExecutor({
      create_subscription_plan: () => {
        throw new ToolCallError("create_subscription_plan", "UNPROCESSABLE_ENTITY");
      },
    });
    const res = await provision(proposal(), executor, null);
    expect(res.complete).toBe(false);
    expect(res.steps.filter((s) => s.status === "error")).toHaveLength(2);
    expect(res.summary).toMatch(/0 of 2/);
  });

  it("works end to end against the dry-run executor", async () => {
    const res = await provision(proposal(), await createDryRunExecutor(), null);
    expect(res.simulated).toBe(true);
    expect(res.complete).toBe(true);
    expect(res.productId).toMatch(/^PROD-DRYRUN/);
  });
});
