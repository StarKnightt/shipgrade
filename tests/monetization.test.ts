import { describe, expect, it } from "vitest";
import { extract, scoreExtracted } from "@/lib/analyze";
import {
  detectProviders,
  explainMonetization,
  extractMonetization,
  findPricingLink,
  formatTierPrice,
  mergeMonetization,
  parsePrice,
  scoreMonetization,
} from "@/lib/monetization";
import {
  FORCED_SIGNUP,
  LANDING_WITH_PRICING_LINK,
  NO_PRICING,
  SAAS_WITH_PAYPAL,
  STRIPE_MULTI_CURRENCY,
} from "./fixtures/pages";

describe("parsePrice", () => {
  it.each([
    ["$9/mo", 9, "USD", "month"],
    ["$29 per month", 29, "USD", "month"],
    ["€12 / month", 12, "EUR", "month"],
    ["£99/yr", 99, "GBP", "year"],
    ["₹499 per month", 499, "INR", "month"],
    ["USD 49 / year", 49, "USD", "year"],
    ["$199 one-time", 199, "USD", "one_time"],
    ["$19.99", 19.99, "USD", null],
  ])("parses %s", (input, amount, currency, interval) => {
    expect(parsePrice(input)).toEqual({ amount, currency, interval });
  });

  it("returns null when there is no price", () => {
    expect(parsePrice("Contact sales")).toBeNull();
  });
});

describe("extractMonetization", () => {
  it("reads tiers, providers, trust, and billing from a SaaS pricing section", () => {
    const s = extractMonetization(SAAS_WITH_PAYPAL);
    expect(s.hasPricingSection).toBe(true);
    expect(s.tiers.map((t) => [t.name, t.amount, t.interval])).toEqual([
      ["Starter", 9, "month"],
      ["Pro", 29, "month"],
      ["Enterprise", null, "one_time"],
    ]);
    expect(s.tiers[2].isCustom).toBe(true);
    expect(s.tiers[0].ctaText).toBe("Start Starter");
    expect(s.tiers[0].features).toEqual(["3 projects", "Email support"]);
    expect(s.providers).toContain("PayPal");
    expect(s.billingModel).toBe("subscription");
    expect(s.hasAnnualOption).toBe(true);
    expect(s.payLater).toBe(true);
    expect(s.trustSignals).toEqual(
      expect.arrayContaining(["money-back guarantee", "cancel anytime", "secure checkout"]),
    );
    expect(s.forcedSignup).toBe(false);
  });

  it("reports no pricing for a vague landing page", () => {
    const s = extractMonetization(NO_PRICING);
    expect(s.hasPricingSection).toBe(false);
    expect(s.tiers).toEqual([]);
    expect(s.pricingSource).toBe("none");
  });

  it("flags forced sign-up before purchase and one-time billing", () => {
    const s = extractMonetization(FORCED_SIGNUP);
    expect(s.forcedSignup).toBe(true);
    expect(s.billingModel).toBe("one_time");
    expect(s.tiers.map((t) => t.amount)).toEqual([49, 199]);
  });

  it("detects Stripe, EUR prices, and a currency switcher", () => {
    const s = extractMonetization(STRIPE_MULTI_CURRENCY);
    expect(s.providers).toEqual(["Stripe"]);
    expect(s.currencies).toContain("EUR");
    expect(s.hasCurrencySwitcher).toBe(true);
    expect(s.tiers.every((t) => t.currency === "EUR")).toBe(true);
  });
});

describe("detectProviders", () => {
  it("recognises script tags and web components", () => {
    expect(detectProviders('<script src="https://cdn.paddle.com/paddle/v2/paddle.js"></script>')).toEqual(["Paddle"]);
    expect(detectProviders("<stripe-pricing-table></stripe-pricing-table>")).toEqual(["Stripe"]);
    expect(detectProviders('<script src="https://checkout.razorpay.com/v1/checkout.js"></script>')).toEqual([
      "Razorpay",
    ]);
  });
});

describe("findPricingLink", () => {
  it("returns the same-origin pricing link only", () => {
    expect(findPricingLink(LANDING_WITH_PRICING_LINK, "https://bar.dev/")).toBe("https://bar.dev/pricing");
  });
  it("ignores pages without one", () => {
    expect(findPricingLink(NO_PRICING, "https://foo.dev/")).toBeNull();
  });
});

describe("mergeMonetization", () => {
  it("adopts the linked pricing page when the landing page has none", () => {
    const page = extractMonetization(NO_PRICING, { pricingUrl: "https://foo.dev/" });
    const linked = extractMonetization(SAAS_WITH_PAYPAL, {
      pricingUrl: "https://foo.dev/pricing",
      source: "linked",
    });
    const merged = mergeMonetization(page, linked);
    expect(merged.pricingSource).toBe("linked");
    expect(merged.pricingUrl).toBe("https://foo.dev/pricing");
    expect(merged.tiers).toHaveLength(3);
  });
});

describe("scoreMonetization", () => {
  it("ranks a clear PayPal checkout well above no pricing", () => {
    const good = scoreMonetization(extractMonetization(SAAS_WITH_PAYPAL)).score;
    const none = scoreMonetization(extractMonetization(NO_PRICING)).score;
    expect(good).toBeGreaterThanOrEqual(80);
    expect(none).toBeLessThan(30);
  });

  it("puts the forced sign-up fix near the top", () => {
    const { findings } = scoreMonetization(extractMonetization(FORCED_SIGNUP));
    const fixes = findings.filter((f) => f.type === "fix");
    expect(fixes[0].text).toMatch(/payment provider|create an account/i);
    expect(findings.some((f) => /create an account/i.test(f.text))).toBe(true);
  });

  it("suggests a wallet when only card checkout is present", () => {
    const { findings } = scoreMonetization(extractMonetization(STRIPE_MULTI_CURRENCY));
    expect(findings.some((f) => /wallet checkout/i.test(f.text))).toBe(true);
  });
});

describe("formatTierPrice + explainMonetization", () => {
  it("formats prices", () => {
    const s = extractMonetization(SAAS_WITH_PAYPAL);
    expect(s.tiers.map(formatTierPrice)).toEqual(["$9/mo", "$29/mo", "Custom"]);
  });
  it("explains in plain language without an LLM", () => {
    const s = extractMonetization(SAAS_WITH_PAYPAL);
    expect(explainMonetization(s, 85)).toMatch(/Found 3 plans .*PayPal/);
  });
});

describe("integration with the overall grade", () => {
  it("adds a seventh dimension with an explanation", () => {
    const result = scoreExtracted(extract(SAAS_WITH_PAYPAL), {
      url: "https://acme.dev",
      finalUrl: "https://acme.dev/",
    });
    expect(result.dimensions).toHaveLength(7);
    const dim = result.dimensions.find((d) => d.key === "monetization");
    expect(dim?.label).toBe("Monetization & Checkout");
    expect(dim?.explanation).toBeTruthy();
    expect(result.checkout.tiers).toHaveLength(3);
  });
});
