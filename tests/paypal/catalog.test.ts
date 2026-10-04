import { describe, expect, it } from "vitest";
import { extractMonetization } from "@/lib/monetization";
import {
  CatalogProposalSchema,
  createFixInvoiceArgs,
  createOrderArgs,
  createPlanArgs,
  createProductArgs,
  proposeCatalog,
} from "@/lib/paypal/catalog";
import { AGENT_TOOL_NAMES, createDryRunExecutor } from "@/lib/paypal/toolkit";
import { FORCED_SIGNUP, NO_PRICING, SAAS_WITH_PAYPAL, STRIPE_MULTI_CURRENCY } from "../fixtures/pages";

const site = { url: "https://acme.dev/", title: "Acme Notes | notes for teams" };

describe("proposeCatalog", () => {
  it("maps paid tiers to plans, skips custom tiers, and validates", () => {
    const p = proposeCatalog(extractMonetization(SAAS_WITH_PAYPAL), site);
    expect(p.product.name).toBe("Acme Notes");
    expect(p.plans.map((x) => [x.name, x.amount, x.interval])).toEqual([
      ["Starter", "9.00", "MONTH"],
      ["Pro", "29.00", "MONTH"],
    ]);
    expect(p.notes.join(" ")).toMatch(/Enterprise.*contact-sales/);
    expect(CatalogProposalSchema.safeParse(p).success).toBe(true);
  });

  it("suggests annual plans when the page bills monthly only", () => {
    const p = proposeCatalog(extractMonetization(STRIPE_MULTI_CURRENCY), site);
    const annual = p.plans.filter((x) => x.suggested);
    expect(annual.map((x) => [x.amount, x.interval])).toEqual([
      ["120.00", "YEAR"],
      ["390.00", "YEAR"],
    ]);
    expect(p.notes.join(" ")).toMatch(/EUR/);
  });

  it("keeps one-time tiers as orders", () => {
    const p = proposeCatalog(extractMonetization(FORCED_SIGNUP), site);
    expect(p.plans.every((x) => x.interval === "ONE_TIME")).toBe(true);
  });

  it("falls back to a suggested starter plan", () => {
    const p = proposeCatalog(extractMonetization(NO_PRICING), site);
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0].suggested).toBe(true);
  });
});

// Check our arguments against the JSON schemas the real PayPal Agent Toolkit
// publishes to the LLM (built offline from its zod schemas).
type JsonSchema = { type?: string; properties?: Record<string, JsonSchema>; required?: string[]; items?: JsonSchema; enum?: unknown[] };

function conforms(value: unknown, schema: JsonSchema, path = "$"): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${String(value)} not in enum`);
  if (schema.type === "object" && schema.properties) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (obj[key] === undefined) errors.push(`${path}.${key} missing`);
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const sub = schema.properties[key];
      if (sub) errors.push(...conforms(v, sub, `${path}.${key}`));
    }
  }
  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    value.forEach((v, i) => errors.push(...conforms(v, schema.items!, `${path}[${i}]`)));
  }
  if (schema.type === "string" && typeof value !== "string") errors.push(`${path} should be string`);
  if (schema.type === "number" && typeof value !== "number") errors.push(`${path} should be number`);
  return errors;
}

describe("toolkit argument builders", async () => {
  const executor = await createDryRunExecutor();
  const schemas = Object.fromEntries(executor.tools().map((t) => [t.function.name, t.function.parameters as JsonSchema]));
  const proposal = proposeCatalog(extractMonetization(SAAS_WITH_PAYPAL), site);

  it("exposes exactly the agent tools from @paypal/agent-toolkit", () => {
    expect(Object.keys(schemas).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it("create_product args match the toolkit schema", () => {
    expect(conforms(createProductArgs(proposal), schemas.create_product)).toEqual([]);
  });

  it("create_subscription_plan args match, including a trial", () => {
    const plan = { ...proposal.plans[1], trialDays: 14 };
    const args = createPlanArgs(plan, "PROD-1");
    expect(conforms(args, schemas.create_subscription_plan)).toEqual([]);
    expect(args.billing_cycles.map((c) => c.tenure_type)).toEqual(["TRIAL", "REGULAR"]);
  });

  it("create_order args match the toolkit schema", () => {
    const oneTime = proposeCatalog(extractMonetization(FORCED_SIGNUP), site).plans[0];
    expect(conforms(createOrderArgs(oneTime), schemas.create_order)).toEqual([]);
  });

  it("create_invoice args match the toolkit schema", () => {
    const args = createFixInvoiceArgs({
      site: "acme.dev",
      recipientEmail: "founder@acme.dev",
      hourlyRate: 60,
      invoicerBusinessName: "Shipgrade",
      fixes: [{ title: "Add PayPal buttons to pricing", hours: 2 }],
    });
    expect(conforms(args, schemas.create_invoice)).toEqual([]);
  });
});
