// The Shipgrade checkout agent.
//
// 1. propose(): turn detected pricing into a PayPal catalog proposal. Rules
//    first, then an LLM refines names, descriptions, and the rationale. The
//    LLM can never invent prices that the rules didn't produce.
// 2. provision(): after the human approves the proposal, an LLM drives the
//    PayPal Agent Toolkit tools (create_product, create_subscription_plan,
//    create_order). Every tool call passes through a guard that only allows
//    actions matching the approved catalog. Anything the LLM skips is
//    completed deterministically, so the result always matches the approval.

import { z } from "zod";
import type { MonetizationSignals } from "../monetization";
import {
  CatalogProposalSchema,
  createOrderArgs,
  createPlanArgs,
  createProductArgs,
  proposeCatalog,
  type CatalogProposal,
  type ProposedPlan,
} from "./catalog";
import type { ChatClient, ChatMessage } from "./chat";
import { compactTools, ToolCallError, type ToolExecutor } from "./toolkit";

// ---------------------------------------------------------------------------
// Propose
// ---------------------------------------------------------------------------

const RefinementSchema = z.object({
  productName: z.string().min(1).max(127).optional(),
  productDescription: z.string().max(256).optional(),
  plans: z
    .array(
      z.object({
        tierId: z.string(),
        name: z.string().min(1).max(127).optional(),
        description: z.string().max(127).optional(),
        trialDays: z.number().int().min(0).max(30).optional(),
        include: z.boolean().optional(),
      }),
    )
    .default([]),
  rationale: z.string().max(800).default(""),
});

const PROPOSE_PROMPT = `You are Shipgrade's checkout agent. A crawler read a founder's pricing section and a rule engine drafted a PayPal catalog (one product, one plan per paid tier).

Refine it for PayPal. Keep the plan names the site uses (buyers must recognise them at checkout); only rename a plan whose detected name is clearly broken. Write short buyer-facing descriptions (max 127 chars), suggest a free trial (0-30 days) where the page mentions one, and drop plans that make no sense (include=false). You may NOT change prices, intervals, or currency, and may not add plans.

Reply with ONLY JSON:
{"productName": string, "productDescription": string, "plans": [{"tierId": string, "name": string, "description": string, "trialDays": number, "include": boolean}], "rationale": string}
"rationale": 2-3 sentences to the founder on why this catalog will convert better, naming their plans.`;

export async function propose(
  signals: MonetizationSignals,
  site: { url: string; title: string | null },
  llm: ChatClient | null,
): Promise<CatalogProposal> {
  const base = proposeCatalog(signals, site);
  if (!llm) {
    return { ...base, rationale: rulesRationale(base) };
  }
  try {
    const res = await llm.complete(
      [
        { role: "system", content: PROPOSE_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            site: base.site,
            detectedTiers: signals.tiers,
            trustSignals: signals.trustSignals,
            hasFreeTrial: signals.hasFreeTrial,
            draft: base,
          }),
        },
      ],
      { json: true, temperature: 0.4 },
    );
    const refined = RefinementSchema.parse(JSON.parse(res.content ?? "{}"));
    return applyRefinement(base, refined);
  } catch (err) {
    console.warn(`[checkout-agent] proposal refinement fell back to rules: ${err instanceof Error ? err.message : err}`);
    return { ...base, rationale: rulesRationale(base) };
  }
}

export function applyRefinement(
  base: CatalogProposal,
  r: z.infer<typeof RefinementSchema>,
): CatalogProposal {
  const byTier = new Map(r.plans.map((p) => [p.tierId, p]));
  const plans = base.plans
    .filter((p) => byTier.get(p.tierId)?.include !== false)
    .map((p) => {
      const edit = byTier.get(p.tierId);
      return {
        ...p,
        name: edit?.name?.trim() || p.name,
        description: edit?.description?.trim() || p.description,
        trialDays: p.interval === "ONE_TIME" ? 0 : (edit?.trialDays ?? p.trialDays),
      };
    });
  return CatalogProposalSchema.parse({
    ...base,
    product: {
      ...base.product,
      name: r.productName?.trim() || base.product.name,
      description: r.productDescription?.trim() || base.product.description,
    },
    plans: plans.length ? plans : base.plans,
    rationale: r.rationale || rulesRationale(base),
    source: "ai",
  });
}

function rulesRationale(p: CatalogProposal): string {
  const recurring = p.plans.filter((x) => x.interval !== "ONE_TIME").length;
  const oneTime = p.plans.length - recurring;
  const parts = [];
  if (recurring) parts.push(`${recurring} PayPal subscription plan${recurring > 1 ? "s" : ""}`);
  if (oneTime) parts.push(`${oneTime} one-time checkout${oneTime > 1 ? "s" : ""}`);
  return `This creates one PayPal catalog product with ${parts.join(" and ")}, mirroring the prices on your page so buyers can pay with PayPal right next to each plan.`;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export interface GuardState {
  productId: string | null;
  createdPlanTiers: Set<string>;
  createdOrderTiers: Set<string>;
}

export type GuardVerdict = { ok: true; tierId: string | null } | { ok: false; reason: string };

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));

/** Only allow tool calls that exactly match the approved proposal. */
export function checkToolCall(
  name: string,
  args: Record<string, unknown>,
  approved: CatalogProposal,
  state: GuardState,
): GuardVerdict {
  if (name === "create_product") {
    if (state.productId) return { ok: false, reason: "The product already exists; reuse its id." };
    if (String(args.name ?? "").trim().toLowerCase() !== approved.product.name.toLowerCase()) {
      return { ok: false, reason: `Product name must be exactly "${approved.product.name}".` };
    }
    return { ok: true, tierId: null };
  }

  if (name === "create_subscription_plan") {
    if (!state.productId) return { ok: false, reason: "Create the product first." };
    if (args.product_id !== state.productId) {
      return { ok: false, reason: `product_id must be ${state.productId}.` };
    }
    // Optional in the toolkit's schema, but PayPal rejects plans without it.
    if (!args.payment_preferences || typeof args.payment_preferences !== "object") {
      return {
        ok: false,
        reason: 'payment_preferences is required: {"auto_bill_outstanding": true, "payment_failure_threshold": 3}.',
      };
    }
    const cycles = Array.isArray(args.billing_cycles) ? (args.billing_cycles as Record<string, unknown>[]) : [];
    const regular = cycles.find((c) => c.tenure_type === "REGULAR") as
      | { frequency?: { interval_unit?: string; interval_count?: number }; pricing_scheme?: { fixed_price?: { value?: string; currency_code?: string } } }
      | undefined;
    const unit = regular?.frequency?.interval_unit;
    const value = num(regular?.pricing_scheme?.fixed_price?.value);
    const match = approved.plans.find(
      (p) =>
        p.interval !== "ONE_TIME" &&
        p.interval === unit &&
        num(p.amount) === value &&
        regular?.pricing_scheme?.fixed_price?.currency_code === p.currency &&
        (regular?.frequency?.interval_count ?? 1) === 1 &&
        !state.createdPlanTiers.has(p.tierId),
    );
    if (!match) {
      return { ok: false, reason: `No approved, not-yet-created ${unit ?? "?"} plan at ${value}. Only create approved plans.` };
    }
    const trials = cycles.filter((c) => c.tenure_type === "TRIAL");
    if (trials.length > (match.trialDays > 0 ? 1 : 0)) {
      return { ok: false, reason: "Trial cycles must match the approved trial." };
    }
    return { ok: true, tierId: match.tierId };
  }

  if (name === "create_order") {
    const items = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
    if (items.length !== 1) return { ok: false, reason: "Create one order per approved one-time plan." };
    const cost = num(items[0].itemCost);
    const match = approved.plans.find(
      (p) => p.interval === "ONE_TIME" && num(p.amount) === cost && !state.createdOrderTiers.has(p.tierId),
    );
    if (!match || num(items[0].quantity ?? 1) !== 1 || args.currencyCode !== "USD") {
      return { ok: false, reason: `No approved one-time plan at ${cost} USD.` };
    }
    return { ok: true, tierId: match.tierId };
  }

  return { ok: false, reason: `Tool ${name} is not allowed during provisioning.` };
}

// ---------------------------------------------------------------------------
// Provision
// ---------------------------------------------------------------------------

export interface ProvisionStep {
  tool: string;
  by: "agent" | "rules";
  args: Record<string, unknown>;
  status: "ok" | "rejected" | "error";
  resultId?: string;
  message?: string;
}

export interface ProvisionedPlan extends ProposedPlan {
  paypalPlanId: string | null;
  orderId: string | null;
  approveUrl: string | null;
}

export interface ProvisionResult {
  mode: "agent" | "rules";
  simulated: boolean;
  productId: string | null;
  plans: ProvisionedPlan[];
  steps: ProvisionStep[];
  summary: string;
  complete: boolean;
  /** Why the LLM stopped early, when the rule engine had to finish. */
  agentError?: string;
}

const PROVISION_PROMPT = `You are Shipgrade's PayPal provisioning agent, working in the PayPal SANDBOX. The founder approved the catalog below. Use the PayPal tools to create exactly that:
1. create_product once, with the exact approved product name, type, and description.
2. create_subscription_plan for every MONTH or YEAR plan, using the product id returned in step 1, one REGULAR billing cycle with interval_count 1 and total_cycles 0, the exact amount as a string, currency USD, and payment_preferences {"auto_bill_outstanding": true, "payment_failure_threshold": 3}. If trialDays > 0, add a TRIAL cycle first (interval_unit DAY, interval_count = trialDays, total_cycles 1, price "0"), and the REGULAR cycle gets sequence 2.
3. create_order for every ONE_TIME plan: currencyCode USD, one item with quantity 1, itemCost = itemTotal = amount, taxPercent 0.
Make independent calls in the same turn (for example, all plans at once after the product exists). Do not create anything else. If a tool call is rejected, read the reason and fix the call. When everything is created, reply with a one-sentence summary and no tool calls.`;

function idOf(res: Record<string, unknown>): string | null {
  return typeof res.id === "string" ? res.id : null;
}

function describePayPalError(res: Record<string, unknown>): string {
  const details = Array.isArray(res.details) ? (res.details as { issue?: string; field?: string; description?: string }[]) : [];
  const parts = [
    typeof res.name === "string" ? res.name : null,
    typeof res.message === "string" ? res.message : null,
    ...details.slice(0, 3).map((d) => [d.field, d.issue, d.description].filter(Boolean).join(" ")),
  ].filter(Boolean);
  return parts.length ? `: ${parts.join("; ").slice(0, 400)}` : `: ${JSON.stringify(res).slice(0, 300)}`;
}

/** What the agent needs back from a tool call; full PayPal bodies waste tokens. */
function briefResult(res: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { id: res.id };
  for (const k of ["status", "name", "product_id"]) if (res[k] !== undefined) out[k] = res[k];
  const approve = approveLink(res);
  if (approve) out.approve_url = approve;
  return out;
}

function approveLink(res: Record<string, unknown>): string | null {
  const links = Array.isArray(res.links) ? (res.links as { rel?: string; href?: string }[]) : [];
  return links.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href ?? null;
}

export async function provision(
  approvedInput: CatalogProposal,
  executor: ToolExecutor,
  llm: ChatClient | null,
  opts: { maxTurns?: number; urls?: { returnUrl: string; cancelUrl: string } } = {},
): Promise<ProvisionResult> {
  const approved = CatalogProposalSchema.parse(approvedInput);
  const state: GuardState = { productId: null, createdPlanTiers: new Set(), createdOrderTiers: new Set() };
  const steps: ProvisionStep[] = [];
  const plans = new Map<string, ProvisionedPlan>(
    approved.plans.map((p) => [p.tierId, { ...p, paypalPlanId: null, orderId: null, approveUrl: null }]),
  );

  const execute = async (
    name: string,
    args: Record<string, unknown>,
    by: "agent" | "rules",
  ): Promise<{ ok: boolean; message: string; result?: Record<string, unknown> }> => {
    const verdict = checkToolCall(name, args, approved, state);
    if (!verdict.ok) {
      steps.push({ tool: name, by, args, status: "rejected", message: verdict.reason });
      return { ok: false, message: `REJECTED by Shipgrade guard: ${verdict.reason}` };
    }
    try {
      const result = await executor.call(name, args);
      const id = idOf(result);
      if (!id) throw new ToolCallError(name, `PayPal response had no id${describePayPalError(result)}`, result);
      if (name === "create_product") state.productId = id;
      if (name === "create_subscription_plan" && verdict.tierId) {
        state.createdPlanTiers.add(verdict.tierId);
        plans.get(verdict.tierId)!.paypalPlanId = id;
      }
      if (name === "create_order" && verdict.tierId) {
        state.createdOrderTiers.add(verdict.tierId);
        const p = plans.get(verdict.tierId)!;
        p.orderId = id;
        p.approveUrl = approveLink(result);
      }
      steps.push({ tool: name, by, args, status: "ok", resultId: id });
      return { ok: true, message: JSON.stringify(result), result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "PayPal call failed";
      steps.push({ tool: name, by, args, status: "error", message });
      return { ok: false, message: `ERROR from PayPal: ${message}` };
    }
  };

  let mode: ProvisionResult["mode"] = "rules";
  let agentSummary: string | null = null;
  let agentError: string | null = null;

  if (llm) {
    mode = "agent";
    const messages: ChatMessage[] = [
      { role: "system", content: PROVISION_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          approvedCatalog: {
            product: approved.product,
            plans: approved.plans.map(({ tierId, name, description, amount, currency, interval, trialDays }) => ({
              tierId,
              name,
              description,
              amount,
              currency,
              interval,
              trialDays,
            })),
          },
        }),
      },
    ];
    const needed = [
      "create_product",
      ...(approved.plans.some((p) => p.interval !== "ONE_TIME") ? ["create_subscription_plan"] : []),
      ...(approved.plans.some((p) => p.interval === "ONE_TIME") ? ["create_order"] : []),
    ];
    const tools = compactTools(executor.tools(), needed);
    const maxTurns = opts.maxTurns ?? 6;
    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        const res = await llm.complete(messages, { tools });
        if (!res.toolCalls.length) {
          agentSummary = res.content?.trim() || null;
          break;
        }
        messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
        for (const call of res.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            messages.push({ role: "tool", tool_call_id: call.id, content: "ERROR: arguments were not valid JSON" });
            continue;
          }
          const out = await execute(call.function.name, args, "agent");
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: out.result ? JSON.stringify(briefResult(out.result)) : out.message.slice(0, 1500),
          });
        }
      }
    } catch (err) {
      // LLM unavailable mid-run; the deterministic pass below finishes the job.
      agentError = err instanceof Error ? err.message : "LLM request failed";
      console.warn(`[checkout-agent] LLM stopped, finishing with rules: ${agentError}`);
    }
  }

  // Deterministic completion: create whatever the agent didn't.
  if (!state.productId) await execute("create_product", createProductArgs(approved), "rules");
  if (state.productId) {
    for (const p of approved.plans) {
      if (p.interval !== "ONE_TIME" && !state.createdPlanTiers.has(p.tierId)) {
        await execute("create_subscription_plan", createPlanArgs(p, state.productId), "rules");
      }
    }
  }
  for (const p of approved.plans) {
    if (p.interval === "ONE_TIME" && !state.createdOrderTiers.has(p.tierId)) {
      await execute("create_order", createOrderArgs(p, opts.urls), "rules");
    }
  }

  const finalPlans = [...plans.values()];
  const complete =
    Boolean(state.productId) && finalPlans.every((p) => p.paypalPlanId || p.orderId);
  const created = finalPlans.filter((p) => p.paypalPlanId || p.orderId).length;
  const summary =
    agentSummary ??
    (complete
      ? `Created ${approved.product.name} in PayPal with ${created} plan${created === 1 ? "" : "s"}.`
      : `Created ${created} of ${finalPlans.length} plans. Check the failed steps below.`);

  return {
    mode,
    simulated: executor.simulated,
    productId: state.productId,
    plans: finalPlans,
    steps,
    summary,
    complete,
    ...(agentError ? { agentError } : {}),
  };
}
