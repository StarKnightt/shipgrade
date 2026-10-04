// Typed, sandbox-only PayPal configuration read from env.
// Shipgrade never talks to live PayPal: any PAYPAL_ENVIRONMENT other than
// "sandbox" is treated as unconfigured, enforced here on the server.

export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com";
export const SANDBOX_SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

export interface ShipgradeOffers {
  brandName: string;
  currency: "USD";
  deepAuditPrice: string;
  watchPrice: string;
  watchPlanId: string | null;
}

interface Common {
  environment: "sandbox";
  apiBase: string;
  sdkUrl: string;
  /** Simulate PayPal responses in the agent layer (no network). */
  dryRun: boolean;
  offers: ShipgradeOffers;
}

export interface PayPalReady extends Common {
  configured: true;
  clientId: string;
  clientSecret: string;
  webhookId: string | null;
  signingSecret: string;
}

export interface PayPalUnconfigured extends Common {
  configured: false;
  missing: string[];
  reason: string;
}

export type PayPalConfig = PayPalReady | PayPalUnconfigured;

type Env = Record<string, string | undefined>;

const money = (raw: string | undefined, fallback: string): string => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : fallback;
};

const truthy = (v: string | undefined) => /^(1|true|yes|on)$/i.test(v?.trim() ?? "");

export function readPayPalConfig(env: Env = process.env): PayPalConfig {
  const offers: ShipgradeOffers = {
    brandName: env.SHIPGRADE_BRAND_NAME?.trim() || "Shipgrade",
    currency: "USD",
    deepAuditPrice: money(env.SHIPGRADE_DEEP_AUDIT_PRICE, "9.00"),
    watchPrice: money(env.SHIPGRADE_WATCH_PRICE, "19.00"),
    watchPlanId: env.SHIPGRADE_WATCH_PLAN_ID?.trim() || null,
  };
  const common: Common = {
    environment: "sandbox",
    apiBase: SANDBOX_API_BASE,
    sdkUrl: SANDBOX_SDK_URL,
    dryRun: truthy(env.PAYPAL_DRY_RUN),
    offers,
  };

  const environment = (env.PAYPAL_ENVIRONMENT ?? "sandbox").trim().toLowerCase();
  if (environment !== "sandbox") {
    return {
      ...common,
      configured: false,
      missing: [],
      reason: `PAYPAL_ENVIRONMENT="${environment}" is not allowed. Shipgrade only runs against the PayPal sandbox.`,
    };
  }

  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  const missing = [
    !clientId && "PAYPAL_CLIENT_ID",
    !clientSecret && "PAYPAL_CLIENT_SECRET",
  ].filter((m): m is string => Boolean(m));

  if (!clientId || !clientSecret) {
    return {
      ...common,
      configured: false,
      missing,
      reason: "PayPal sandbox not configured. Add a sandbox REST app's client ID and secret to .env.local.",
    };
  }

  return {
    ...common,
    configured: true,
    clientId,
    clientSecret,
    webhookId: env.PAYPAL_WEBHOOK_ID?.trim() || null,
    signingSecret: env.SHIPGRADE_SIGNING_SECRET?.trim() || `shipgrade:${clientSecret}`,
  };
}

/** Safe-to-expose subset for the browser. Never includes the secret. */
export interface PublicPayPalStatus {
  configured: boolean;
  environment: "sandbox";
  clientId: string | null;
  sdkUrl: string;
  dryRun: boolean;
  reason: string | null;
  missing: string[];
  offers: {
    brandName: string;
    currency: "USD";
    deepAudit: { price: string; enabled: boolean };
    watch: { price: string; enabled: boolean };
  };
  webhooks: boolean;
}

export function publicStatus(cfg: PayPalConfig = readPayPalConfig()): PublicPayPalStatus {
  return {
    configured: cfg.configured,
    environment: cfg.environment,
    clientId: cfg.configured ? cfg.clientId : null,
    sdkUrl: cfg.sdkUrl,
    dryRun: cfg.dryRun,
    reason: cfg.configured ? null : cfg.reason,
    missing: cfg.configured ? [] : cfg.missing,
    offers: {
      brandName: cfg.offers.brandName,
      currency: cfg.offers.currency,
      deepAudit: { price: cfg.offers.deepAuditPrice, enabled: cfg.configured },
      watch: {
        price: cfg.offers.watchPrice,
        enabled: cfg.configured && Boolean(cfg.offers.watchPlanId),
      },
    },
    webhooks: cfg.configured && Boolean(cfg.webhookId),
  };
}

export class PayPalNotConfiguredError extends Error {
  constructor(readonly config: PayPalUnconfigured) {
    super(config.reason);
    this.name = "PayPalNotConfiguredError";
  }
}

export function requirePayPal(cfg: PayPalConfig = readPayPalConfig()): PayPalReady {
  if (!cfg.configured) throw new PayPalNotConfiguredError(cfg);
  return cfg;
}
