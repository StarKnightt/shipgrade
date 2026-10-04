// Monetization & Checkout: the seventh Shipgrade dimension.
// Deterministic extraction of pricing tiers, payment providers, trust signals
// near the buy button, currency handling, billing model, and checkout friction
// from raw HTML. Pure functions only, so every rule is unit-testable.

import type { Finding } from "./analyze";

export type PaymentProvider =
  | "PayPal"
  | "Venmo"
  | "Stripe"
  | "Paddle"
  | "Lemon Squeezy"
  | "Gumroad"
  | "Shopify"
  | "Chargebee"
  | "Braintree"
  | "Square"
  | "Razorpay"
  | "Apple Pay"
  | "Google Pay"
  | "Klarna"
  | "Afterpay";

export type BillingInterval = "month" | "year" | "week" | "one_time";

export interface PricingTier {
  id: string;
  name: string;
  /** Price in major units (9.99), null for "contact us" tiers. */
  amount: number | null;
  currency: string;
  interval: BillingInterval;
  features: string[];
  ctaText: string | null;
  isFree: boolean;
  isCustom: boolean;
}

export type BillingModel = "subscription" | "one_time" | "mixed" | "unknown";

export interface MonetizationSignals {
  pricingSource: "page" | "linked" | "none";
  pricingUrl: string | null;
  hasPricingSection: boolean;
  tiers: PricingTier[];
  providers: PaymentProvider[];
  currencies: string[];
  hasCurrencySwitcher: boolean;
  billingModel: BillingModel;
  hasAnnualOption: boolean;
  hasFreeTrial: boolean;
  payLater: boolean;
  trustSignals: string[];
  checkoutCtas: string[];
  forcedSignup: boolean;
  guestCheckout: boolean;
}

// ---------------------------------------------------------------------------
// Low-level helpers (kept local so this module has no runtime dependency on
// analyze.ts, which imports it)
// ---------------------------------------------------------------------------

function decode(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&euro;/gi, "€")
    .replace(/&pound;/gi, "£")
    .replace(/&#8377;/g, "₹");
}

function toText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tagTexts(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const t = toText(m[1]);
    if (t) out.push(t);
  }
  return out;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "tier"
  );
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

const SYMBOL_CURRENCY: Record<string, string> = {
  $: "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR",
  "¥": "JPY",
  "A$": "AUD",
  "C$": "CAD",
};

const CURRENCY_CODES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD"];

// "$29/mo", "€ 9.99 per month", "USD 49 / year", "$0", "$199 one-time"
const PRICE_RE =
  /(US\$|A\$|C\$|\$|€|£|₹|¥|\b(?:USD|EUR|GBP|INR|AUD|CAD)\b)\s?(\d{1,5}(?:[.,]\d{1,2})?)(?:\s*(?:\/|per|a)\s*(?:user\s*\/\s*|seat\s*\/\s*|user\s+per\s+|seat\s+per\s+)?(mo|month|monthly|yr|year|annum|annually|wk|week))?(?:\s*(one[-\s]?time|lifetime|once))?/i;

export interface ParsedPrice {
  amount: number;
  currency: string;
  interval: BillingInterval | null;
}

export function parsePrice(text: string): ParsedPrice | null {
  const m = text.match(PRICE_RE);
  if (!m) return null;
  const rawCur = m[1];
  const currency = SYMBOL_CURRENCY[rawCur] ?? rawCur.toUpperCase();
  const amount = Number(m[2].replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  let interval: BillingInterval | null = null;
  const unit = m[3]?.toLowerCase();
  if (unit) {
    if (unit.startsWith("mo")) interval = "month";
    else if (unit.startsWith("y") || unit.startsWith("ann")) interval = "year";
    else interval = "week";
  } else if (m[4]) {
    interval = "one_time";
  }
  return { amount, currency, interval };
}

// ---------------------------------------------------------------------------
// Pricing region + tiers
// ---------------------------------------------------------------------------

const PRICING_HEADING_RE =
  /\b(pricing|plans?|choose (?:a|your) plan|simple,? transparent pricing|buy now|get (?:access|started) today)\b/i;

/**
 * Returns the slice of HTML most likely to be the pricing section, or null.
 * Prefers an element with id/class "pricing", then a pricing heading, then the
 * densest price cluster.
 */
export function findPricingRegion(html: string): string | null {
  const idMatch = html.search(/<[a-z]+\b[^>]*\b(?:id|class)=["'][^"']*\b(pricing|plans)\b[^"']*["']/i);
  if (idMatch >= 0) return html.slice(idMatch, idMatch + 40_000);

  const headingRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) !== null) {
    if (PRICING_HEADING_RE.test(toText(m[1]))) {
      return html.slice(m.index, m.index + 40_000);
    }
  }

  const text = toText(html);
  const priceCount = (text.match(new RegExp(PRICE_RE.source, "gi")) ?? []).length;
  if (priceCount >= 2) return html;
  return null;
}

const CTA_RE =
  /^(?:start|get|try|go|choose|select|upgrade to)\b|\b(buy|purchase|subscribe|get started|upgrade|sign up|signup|create account|contact (?:sales|us)|talk to sales|book a demo|checkout|pay now|add to cart)\b/i;

const NOT_TIER_NAMES =
  /^(pricing|plans?|faq|frequently asked questions|features|compare|testimonials?|questions?|what's included|everything in)/i;

export function extractTiers(regionHtml: string): PricingTier[] {
  const headingRe = /<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const marks: { index: number; end: number; name: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(regionHtml)) !== null) {
    marks.push({ index: m.index, end: m.index + m[0].length, name: toText(m[2]) });
  }

  const tiers: PricingTier[] = [];
  for (let i = 0; i < marks.length; i++) {
    const { name, end } = marks[i];
    if (!name || name.split(/\s+/).length > 5 || NOT_TIER_NAMES.test(name)) continue;
    const segment = regionHtml.slice(end, marks[i + 1]?.index ?? end + 6_000);
    const text = toText(segment);
    if (!text) continue;

    const price = parsePrice(name) ?? parsePrice(text);
    const isCustom = !price && /\b(contact (?:us|sales)|custom|let's talk|talk to sales)\b/i.test(text);
    const isFreeWord = /^(free|\$0|0)\b/i.test(text) || /\bfree forever\b/i.test(text);
    if (!price && !isCustom && !isFreeWord) continue;

    const amount = price ? price.amount : isFreeWord ? 0 : null;
    const ctaText =
      [...tagTexts(segment, "button"), ...tagTexts(segment, "a")].find(
        (t) => t.length < 40 && CTA_RE.test(t),
      ) ?? null;

    tiers.push({
      id: slug(name),
      name: name.replace(PRICE_RE, "").trim() || name,
      amount,
      currency: price?.currency ?? "USD",
      interval: price?.interval ?? (amount === 0 ? "month" : inferInterval(text)),
      features: tagTexts(segment, "li")
        .filter((f) => f.length < 120)
        .slice(0, 6),
      ctaText,
      isFree: amount === 0,
      isCustom,
    });
  }

  const seen = new Set<string>();
  return tiers
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    .slice(0, 6);
}

function inferInterval(text: string): BillingInterval {
  if (/\b(one[-\s]?time|lifetime|pay once)\b/i.test(text)) return "one_time";
  if (/\b(per year|\/yr|\/year|annually|billed yearly)\b/i.test(text)) return "year";
  if (/\b(per month|\/mo|monthly)\b/i.test(text)) return "month";
  return "one_time";
}

// ---------------------------------------------------------------------------
// Providers, trust, friction
// ---------------------------------------------------------------------------

const PROVIDER_PATTERNS: [PaymentProvider, RegExp][] = [
  [
    "PayPal",
    /paypal\.com\/(?:sdk\/js|web-sdk\/v6)|paypalobjects\.com|<paypal-button|data-paypal|paypal-button|\bpaypal\b/i,
  ],
  ["Venmo", /\bvenmo\b|<venmo-button/i],
  [
    "Stripe",
    /js\.stripe\.com|checkout\.stripe\.com|buy\.stripe\.com|<stripe-(?:pricing-table|buy-button)|\bpowered by stripe\b/i,
  ],
  ["Paddle", /cdn\.paddle\.com|paddle\.js|Paddle\.(?:Checkout|Setup|Initialize)/],
  ["Lemon Squeezy", /lemonsqueezy\.com|lemon\.js/i],
  ["Gumroad", /gumroad\.com\/(?:js|l\/)/i],
  ["Shopify", /cdn\.shopify\.com|shopify-payment-button|\bshop pay\b/i],
  ["Chargebee", /js\.chargebee\.com|chargebee\.com\/v2/i],
  ["Braintree", /js\.braintreegateway\.com|braintree-web/i],
  ["Square", /web\.squarecdn\.com|squareup\.com\/|square\.link/i],
  ["Razorpay", /checkout\.razorpay\.com|razorpay/i],
  ["Apple Pay", /\bapple pay\b|apple-pay-button/i],
  ["Google Pay", /\bgoogle pay\b|pay\.google\.com|gpay-button/i],
  ["Klarna", /\bklarna\b/i],
  ["Afterpay", /\bafterpay\b|\bclearpay\b/i],
];

export function detectProviders(html: string): PaymentProvider[] {
  return PROVIDER_PATTERNS.filter(([, re]) => re.test(html)).map(([p]) => p);
}

const TRUST_PATTERNS: [string, RegExp][] = [
  ["money-back guarantee", /money[-\s]back|refund guarantee|\d+[-\s]day guarantee|full refund/i],
  ["cancel anytime", /cancel any ?time|no lock[-\s]?in|no long[-\s]term contract/i],
  ["secure checkout", /secure (?:checkout|payment)s?|ssl|encrypted|pci[-\s]?(?:dss|compliant)/i],
  ["no credit card required", /no credit card (?:required|needed)/i],
  ["free trial", /free trial|\d+[-\s]day trial|try (?:it )?free/i],
  ["customer proof", /trusted by|loved by|used by \d|customers|reviews?|rating/i],
];

const FORCED_SIGNUP_RE =
  /\b(?:create an account|sign up|register|log ?in) (?:to|before you) (?:buy|purchase|checkout|check out|pay|subscribe|continue to (?:checkout|payment))\b|\baccount (?:is )?required (?:to|for) (?:checkout|purchase)\b/i;

const GUEST_RE = /\bguest checkout\b|\bcheckout as (?:a )?guest\b|\bno account (?:needed|required)\b/i;

const SIGNUP_ONLY_CTA = /^(sign up|signup|create (?:an )?account|register|join)( free| now)?$/i;

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function extractMonetization(
  html: string,
  opts: { pricingUrl?: string | null; source?: "page" | "linked" } = {},
): MonetizationSignals {
  const region = findPricingRegion(html);
  const regionHtml = region ?? "";
  const regionText = toText(regionHtml);
  const fullText = toText(html);
  const tiers = region ? extractTiers(region) : [];

  const currencies = unique(
    [
      ...[...regionText.matchAll(new RegExp(PRICE_RE.source, "gi"))].map(
        (m) => SYMBOL_CURRENCY[m[1]] ?? m[1].toUpperCase(),
      ),
      ...tiers.filter((t) => t.amount !== null).map((t) => t.currency),
    ].filter((c) => CURRENCY_CODES.includes(c)),
  );
  const switcherOptions = (html.match(/<option\b[^>]*>\s*(?:USD|EUR|GBP|INR|AUD|CAD|JPY)\b/gi) ?? []).length;
  const hasCurrencySwitcher =
    switcherOptions >= 2 || /\b(?:change|select|switch) currency\b/i.test(fullText);

  const recurring = tiers.filter((t) => !t.isCustom && t.amount && t.interval !== "one_time").length;
  const oneTime = tiers.filter((t) => t.amount && t.interval === "one_time").length;
  const textSaysRecurring = /\b(per month|\/mo\b|monthly|billed (?:annually|yearly|monthly))\b/i.test(regionText);
  const textSaysOneTime = /\b(one[-\s]?time|lifetime (?:deal|access|license)|pay once)\b/i.test(regionText);
  let billingModel: BillingModel = "unknown";
  if ((recurring || textSaysRecurring) && (oneTime || textSaysOneTime)) billingModel = "mixed";
  else if (recurring || textSaysRecurring) billingModel = "subscription";
  else if (oneTime || textSaysOneTime) billingModel = "one_time";

  const hasAnnualOption =
    /\b(annual(?:ly)?|yearly|billed yearly|per year|\/yr)\b/i.test(regionText) &&
    /\b(monthly|per month|\/mo)\b/i.test(regionText);

  const checkoutCtas = unique(
    [...tagTexts(regionHtml, "button"), ...tagTexts(regionHtml, "a")]
      .filter((t) => t.length < 40 && CTA_RE.test(t))
      .map((t) => t.trim()),
  ).slice(0, 8);

  const trustScope = region ? regionText : fullText;
  const trustSignals = TRUST_PATTERNS.filter(([, re]) => re.test(trustScope)).map(([label]) => label);

  const providers = detectProviders(html);
  const tierCtas = tiers.map((t) => t.ctaText).filter((c): c is string => Boolean(c));
  const forcedSignup =
    FORCED_SIGNUP_RE.test(fullText) ||
    (tierCtas.length >= 2 &&
      tierCtas.every((c) => SIGNUP_ONLY_CTA.test(c.trim())) &&
      tiers.some((t) => (t.amount ?? 0) > 0) &&
      providers.length === 0);

  return {
    pricingSource: region ? (opts.source ?? "page") : "none",
    pricingUrl: region ? (opts.pricingUrl ?? null) : null,
    hasPricingSection: Boolean(region),
    tiers,
    providers,
    currencies,
    hasCurrencySwitcher,
    billingModel,
    hasAnnualOption,
    hasFreeTrial: /free trial|\d+[-\s]day trial/i.test(fullText),
    payLater:
      /pay later|pay in 4|paypal-message|data-pp-message|<paypal-message/i.test(html) ||
      providers.includes("Klarna") ||
      providers.includes("Afterpay"),
    trustSignals,
    checkoutCtas,
    forcedSignup,
    guestCheckout: GUEST_RE.test(fullText),
  };
}

/** Merge signals from the landing page with a discovered /pricing page. */
export function mergeMonetization(
  page: MonetizationSignals,
  linked: MonetizationSignals | null,
): MonetizationSignals {
  if (!linked || !linked.hasPricingSection) return page;
  const primary = page.tiers.length >= linked.tiers.length && page.hasPricingSection ? page : linked;
  return {
    ...primary,
    pricingSource: page.hasPricingSection ? "page" : "linked",
    pricingUrl: page.hasPricingSection ? page.pricingUrl : linked.pricingUrl,
    hasPricingSection: true,
    providers: unique([...page.providers, ...linked.providers]),
    currencies: unique([...page.currencies, ...linked.currencies]),
    hasCurrencySwitcher: page.hasCurrencySwitcher || linked.hasCurrencySwitcher,
    hasFreeTrial: page.hasFreeTrial || linked.hasFreeTrial,
    payLater: page.payLater || linked.payLater,
    trustSignals: unique([...page.trustSignals, ...linked.trustSignals]),
    checkoutCtas: unique([...primary.checkoutCtas, ...page.checkoutCtas]).slice(0, 8),
    forcedSignup: page.forcedSignup || linked.forcedSignup,
    guestCheckout: page.guestCheckout || linked.guestCheckout,
  };
}

/** Find a same-origin link to a pricing page from the landing page HTML. */
export function findPricingLink(html: string, baseUrl: string): string | null {
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const label = toText(m[2]);
    if (!/\/(pricing|plans|buy|upgrade|purchase)\b/i.test(href) && !/^(pricing|plans)$/i.test(label)) continue;
    try {
      const url = new URL(href, base);
      if (url.hostname !== base.hostname || !/^https?:$/.test(url.protocol)) continue;
      if (url.pathname === base.pathname) continue;
      return url.toString();
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function formatTierPrice(t: PricingTier): string {
  if (t.isCustom || t.amount === null) return "Custom";
  if (t.amount === 0) return "Free";
  const sym = { USD: "$", EUR: "€", GBP: "£", INR: "₹", JPY: "¥" }[t.currency] ?? `${t.currency} `;
  const value = Number.isInteger(t.amount) ? String(t.amount) : t.amount.toFixed(2);
  const suffix = { month: "/mo", year: "/yr", week: "/wk", one_time: "" }[t.interval];
  return `${sym}${value}${suffix}`;
}

interface Weighted extends Finding {
  weight: number;
}

export function scoreMonetization(s: MonetizationSignals): { score: number; findings: Finding[] } {
  let score = 42;
  const f: Weighted[] = [];
  const paidTiers = s.tiers.filter((t) => (t.amount ?? 0) > 0);

  if (!s.hasPricingSection) {
    score -= 22;
    f.push({
      type: "fix",
      weight: 10,
      text: "No pricing found on the page or a linked /pricing page. Visitors who can't see a price assume it's expensive, so show at least one plan and its price.",
    });
  } else {
    score += 14;
    if (s.tiers.length >= 2 && s.tiers.length <= 4) {
      score += 12;
      f.push({
        type: "win",
        weight: 4,
        text: `${s.tiers.length} clear plans (${s.tiers
          .slice(0, 3)
          .map((t) => `${t.name} ${formatTierPrice(t)}`)
          .join(", ")}). Few, named tiers make the choice easy.`,
      });
    } else if (s.tiers.length > 4) {
      score -= 6;
      f.push({
        type: "fix",
        weight: 5,
        text: `${s.tiers.length} plans is a lot to compare. Cut to three and highlight the one most buyers should pick.`,
      });
    } else if (s.tiers.length === 1) {
      score += 4;
    } else {
      score -= 4;
      f.push({
        type: "fix",
        weight: 6,
        text: "There's a pricing section, but no plan reads as a clear name plus price. Give each tier a heading and one visible number.",
      });
    }
    if (s.tiers.length > 0 && paidTiers.length === 0 && s.tiers.every((t) => t.isCustom || t.isFree)) {
      score -= 8;
      f.push({
        type: "fix",
        weight: 7,
        text: "Every plan is free or 'contact sales'. Add one self-serve paid plan so buyers who are ready can pay today.",
      });
    }
  }

  if (s.providers.length > 0) {
    score += 12;
    f.push({
      type: "win",
      weight: s.providers.includes("PayPal") ? 5 : 3,
      text: `Checkout runs on ${s.providers.slice(0, 3).join(", ")}${
        s.providers.includes("PayPal") ? ", so the buyer can pay with the wallet they already trust." : "."
      }`,
    });
    if (!s.providers.includes("PayPal") && !s.providers.includes("Apple Pay") && !s.providers.includes("Google Pay")) {
      f.push({
        type: "fix",
        weight: 6,
        text: "No wallet checkout detected. Adding PayPal (and Pay Later) lets buyers pay in two taps without typing a card.",
      });
    }
  } else if (s.hasPricingSection) {
    score -= 10;
    f.push({
      type: "fix",
      weight: 8,
      text: "Prices are shown, but no payment provider is visible on the page. Put a real buy button (PayPal, card) next to the price so intent turns into payment.",
    });
  }

  if (s.hasPricingSection) {
    const ctaTiers = s.tiers.filter((t) => t.ctaText).length;
    if (s.tiers.length > 0 && ctaTiers >= Math.ceil(s.tiers.length / 2)) {
      score += 8;
    } else if (s.checkoutCtas.length === 0) {
      score -= 6;
      f.push({
        type: "fix",
        weight: 6,
        text: "No buy or subscribe button inside the pricing section. Each plan needs its own action button, like 'Start Pro'.",
      });
    }
  }

  if (s.hasPricingSection) {
    if (s.trustSignals.length >= 2) {
      score += 10;
      f.push({
        type: "win",
        weight: 2,
        text: `Reassurance sits near the price (${s.trustSignals.slice(0, 2).join(", ")}), which is where buyers hesitate.`,
      });
    } else if (s.trustSignals.length === 1) {
      score += 4;
    } else {
      score -= 8;
      f.push({
        type: "fix",
        weight: 7,
        text: "Nothing near the price lowers the risk of paying. Add 'cancel anytime', a refund guarantee, or 'secure checkout' under the buttons.",
      });
    }
  }

  if (s.currencies.length >= 2 || s.hasCurrencySwitcher) score += 6;

  if (s.billingModel === "subscription" || s.billingModel === "mixed") {
    if (s.hasAnnualOption) {
      score += 6;
    } else if (paidTiers.length > 0) {
      score -= 2;
      f.push({
        type: "fix",
        weight: 3,
        text: "Subscriptions without an annual option leave money on the table. Offer yearly billing at roughly 2 months free.",
      });
    }
  } else if (s.billingModel === "one_time") {
    score += 3;
  }

  if (s.payLater) score += 4;

  if (s.forcedSignup) {
    score -= 12;
    f.push({
      type: "fix",
      weight: 9,
      text: "Buyers have to create an account before they can pay. Let them pay first (guest or wallet checkout) and create the account after.",
    });
  } else if (s.guestCheckout) {
    score += 6;
  }

  const ordered = [...f].sort((a, b) => {
    if (a.type !== b.type) return a.type === "fix" ? -1 : 1;
    return b.weight - a.weight;
  });
  // Lead with the strongest win so the card isn't all red pen.
  const topWin = ordered.find((x) => x.type === "win");
  const fixes = ordered.filter((x) => x.type === "fix");
  const findings = (topWin ? [topWin, ...fixes] : fixes).map(({ type, text }) => ({ type, text }));
  if (findings.length === 0) {
    findings.push({ type: "win", text: "Pricing, checkout, and reassurance are all in place. Buyers can pay without friction." });
  }

  return { score, findings };
}

/** Deterministic, human-readable one-paragraph explanation (no LLM needed). */
export function explainMonetization(s: MonetizationSignals, score: number): string {
  if (!s.hasPricingSection) {
    return "We couldn't find a price anywhere a buyer would look, so the page asks for trust before it shows the cost. A visible plan with a PayPal button beside it is the fastest fix.";
  }
  const plans = s.tiers.length
    ? `${s.tiers.length} plan${s.tiers.length > 1 ? "s" : ""} (${s.tiers.map((t) => `${t.name} ${formatTierPrice(t)}`).join(", ")})`
    : "a pricing section";
  const pay = s.providers.length ? `checkout via ${s.providers.slice(0, 3).join(", ")}` : "no visible way to pay";
  const risk = s.forcedSignup
    ? "buyers must sign up before paying"
    : s.trustSignals.length
      ? `reassurance like ${s.trustSignals[0]} near the price`
      : "nothing near the price that lowers the risk";
  const tail =
    score >= 75
      ? "This checkout is close to frictionless."
      : "Each fix below removes a reason to leave before paying.";
  return `Found ${plans}, ${pay}, and ${risk}. ${tail}`;
}
