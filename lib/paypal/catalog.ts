// Turns detected pricing into a PayPal catalog proposal (the thing the human
// approves), and builds the exact PayPal Agent Toolkit tool arguments for it.

import { z } from "zod";
import type { MonetizationSignals, PricingTier } from "../monetization";

export const PlanInterval = z.enum(["MONTH", "YEAR", "ONE_TIME"]);
export type PlanInterval = z.infer<typeof PlanInterval>;

export const ProposedPlanSchema = z.object({
  tierId: z.string().min(1).max(60),
  name: z.string().min(1).max(127),
  description: z.string().max(127).default(""),
  amount: z.string().regex(/^\d{1,6}\.\d{2}$/, "amount must look like 29.00"),
  currency: z.literal("USD"),
  interval: PlanInterval,
  trialDays: z.number().int().min(0).max(90).default(0),
  /** True when the agent suggested this plan (not on the page). */
  suggested: z.boolean().default(false),
});
export type ProposedPlan = z.infer<typeof ProposedPlanSchema>;

export const CatalogProposalSchema = z.object({
  site: z.string().max(200),
  product: z.object({
    name: z.string().min(1).max(127),
    description: z.string().max(256).default(""),
    type: z.enum(["SERVICE", "DIGITAL"]).default("SERVICE"),
    homeUrl: z.string().url().optional(),
  }),
  plans: z.array(ProposedPlanSchema).min(1).max(8),
  notes: z.array(z.string().max(300)).max(10).default([]),
  rationale: z.string().max(800).default(""),
  source: z.enum(["rules", "ai"]).default("rules"),
});
export type CatalogProposal = z.infer<typeof CatalogProposalSchema>;

const toAmount = (n: number) => n.toFixed(2);

function tierInterval(t: PricingTier): PlanInterval {
  if (t.interval === "year") return "YEAR";
  if (t.interval === "one_time") return "ONE_TIME";
  return "MONTH";
}

function cleanName(raw: string | null | undefined, fallback: string): string {
  const name = (raw ?? "").replace(/\s*[|·:–-]\s.*$/, "").trim();
  return (name || fallback).slice(0, 127);
}

/**
 * Deterministic proposal: one PayPal catalog product, one plan per paid tier.
 * Monthly-only subscriptions get a suggested annual plan (2 months free),
 * matching the Monetization dimension's fix.
 */
export function proposeCatalog(
  signals: MonetizationSignals,
  site: { url: string; title: string | null },
): CatalogProposal {
  let host = site.url;
  try {
    host = new URL(site.url).hostname.replace(/^www\./, "");
  } catch {
    // keep raw
  }
  const productName = cleanName(site.title, host);
  const notes: string[] = [];
  const plans: ProposedPlan[] = [];

  for (const t of signals.tiers) {
    if (t.isCustom || t.amount === null) {
      notes.push(`"${t.name}" is contact-sales pricing, so it stays off PayPal and keeps its sales flow.`);
      continue;
    }
    if (t.amount === 0) {
      notes.push(`"${t.name}" is free, so no PayPal plan is needed.`);
      continue;
    }
    if (t.currency !== "USD") {
      notes.push(
        `"${t.name}" is priced in ${t.currency}. The sandbox catalog uses USD, so the amount is kept as-is in USD for the demo.`,
      );
    }
    plans.push({
      tierId: t.id,
      name: `${t.name}${tierInterval(t) === "YEAR" ? " (annual)" : ""}`.slice(0, 127),
      description: (t.features.slice(0, 3).join(", ") || `${t.name} plan`).slice(0, 127),
      amount: toAmount(t.amount),
      currency: "USD",
      interval: tierInterval(t),
      trialDays: 0,
      suggested: false,
    });
  }

  const monthly = plans.filter((p) => p.interval === "MONTH");
  const hasYearly = plans.some((p) => p.interval === "YEAR");
  if (monthly.length && !hasYearly && !signals.hasAnnualOption) {
    for (const p of monthly.slice(0, 2)) {
      plans.push({
        ...p,
        tierId: `${p.tierId}-annual`,
        name: `${p.name} (annual)`.slice(0, 127),
        amount: toAmount(Number(p.amount) * 10),
        interval: "YEAR",
        suggested: true,
      });
    }
    notes.push("Added annual plans at 10x monthly (2 months free) because the page only bills monthly.");
  }

  if (plans.length === 0) {
    plans.push({
      tierId: "starter",
      name: "Starter",
      description: "Suggested starter plan",
      amount: "9.00",
      currency: "USD",
      interval: "MONTH",
      trialDays: 0,
      suggested: true,
    });
    notes.push("No paid plan was readable on the page, so this is a suggested $9/mo starter plan. Edit it before approving.");
  }

  return {
    site: host,
    product: {
      name: productName,
      description: `${productName} subscription`.slice(0, 256),
      type: "SERVICE",
      homeUrl: /^https?:\/\//.test(site.url) ? site.url : undefined,
    },
    plans: plans.slice(0, 8),
    notes,
    rationale: "",
    source: "rules",
  };
}

// ---------------------------------------------------------------------------
// PayPal Agent Toolkit argument builders (shapes verified against
// @paypal/agent-toolkit 1.11.0 zod schemas)
// ---------------------------------------------------------------------------

export function createProductArgs(p: CatalogProposal) {
  return {
    name: p.product.name,
    type: p.product.type,
    description: p.product.description || undefined,
    category: "SOFTWARE",
    home_url: p.product.homeUrl,
  };
}

export function createPlanArgs(plan: ProposedPlan, productId: string) {
  if (plan.interval === "ONE_TIME") throw new Error("One-time prices use orders, not plans.");
  const cycles: Record<string, unknown>[] = [];
  if (plan.trialDays > 0) {
    cycles.push({
      frequency: { interval_unit: "DAY", interval_count: plan.trialDays },
      tenure_type: "TRIAL",
      sequence: 1,
      total_cycles: 1,
      pricing_scheme: { fixed_price: { currency_code: "USD", value: "0" } },
    });
  }
  cycles.push({
    frequency: { interval_unit: plan.interval, interval_count: 1 },
    tenure_type: "REGULAR",
    sequence: cycles.length + 1,
    total_cycles: 0,
    pricing_scheme: { fixed_price: { currency_code: plan.currency, value: plan.amount } },
  });
  return {
    product_id: productId,
    name: plan.name,
    description: plan.description || undefined,
    billing_cycles: cycles,
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  };
}

export function createOrderArgs(plan: ProposedPlan, urls?: { returnUrl: string; cancelUrl: string }) {
  const cost = Number(plan.amount);
  return {
    currencyCode: "USD" as const,
    items: [
      {
        name: plan.name,
        description: plan.description || undefined,
        quantity: 1,
        itemCost: cost,
        taxPercent: 0,
        itemTotal: cost,
      },
    ],
    ...(urls ?? {}),
  };
}

export interface FixLineItem {
  title: string;
  hours: number;
}

/** Stretch: a draft invoice that scopes Shipgrade's fixes for the founder. */
export function createFixInvoiceArgs(input: {
  site: string;
  recipientEmail: string;
  hourlyRate: number;
  fixes: FixLineItem[];
  invoicerBusinessName: string;
}) {
  return {
    currency_code: "USD",
    note: `Conversion fixes for ${input.site}, scoped by Shipgrade.`,
    invoicer_business_name: input.invoicerBusinessName,
    primary_recipients: [{ billing_info: { email_address: input.recipientEmail } }],
    items: input.fixes.slice(0, 10).map((f) => ({
      name: f.title.slice(0, 200),
      quantity: String(f.hours),
      unit_amount: { currency_code: "USD", value: input.hourlyRate.toFixed(2) },
      unit_of_measure: "HOURS",
    })),
  };
}
