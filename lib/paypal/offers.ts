// Shipgrade's own paid offers, sold through PayPal:
// - Deep Audit: one-time Orders v2 purchase.
// - Shipgrade Watch: monthly Subscriptions plan (weekly re-grades).

import type { PayPalReady } from "./config";
import { captureOf, type OrderResponse, type PayPalRest, type SubscriptionResponse } from "./rest";
import { signToken } from "./token";

export function hostKey(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function createDeepAuditOrder(rest: PayPalRest, cfg: PayPalReady, url: string) {
  const host = hostKey(url);
  return rest.createOrder({
    amount: cfg.offers.deepAuditPrice,
    currency: cfg.offers.currency,
    description: `${cfg.offers.brandName} Deep Audit: ${host || "your site"}`,
    customId: `deep-audit:${host}`,
    brandName: cfg.offers.brandName,
  });
}

export interface DeepAuditUnlock {
  kind: "deep-audit";
  host: string;
  orderId: string;
  captureId: string;
}

/** Validates a captured order is a fully paid Deep Audit before unlocking. */
export function deepAuditUnlockFrom(order: OrderResponse, cfg: PayPalReady): DeepAuditUnlock | null {
  const unit = order.purchase_units?.[0];
  const capture = captureOf(order);
  if (order.status !== "COMPLETED" || capture?.status !== "COMPLETED") return null;
  if (!unit?.custom_id?.startsWith("deep-audit:")) return null;
  if (capture.amount.value !== cfg.offers.deepAuditPrice || capture.amount.currency_code !== cfg.offers.currency) {
    return null;
  }
  return { kind: "deep-audit", host: unit.custom_id.slice("deep-audit:".length), orderId: order.id, captureId: capture.id };
}

export function signUnlock(unlock: DeepAuditUnlock, cfg: PayPalReady): string {
  return signToken(unlock, cfg.signingSecret, 60 * 60 * 24 * 30);
}

export function createWatchSubscription(
  rest: PayPalRest,
  cfg: PayPalReady,
  url: string,
  origin: string,
): Promise<SubscriptionResponse> {
  if (!cfg.offers.watchPlanId) throw new Error("SHIPGRADE_WATCH_PLAN_ID is not set.");
  const host = hostKey(url);
  return rest.createSubscription({
    planId: cfg.offers.watchPlanId,
    customId: `watch:${host}`,
    brandName: cfg.offers.brandName,
    returnUrl: `${origin}/?watch=approved`,
    cancelUrl: `${origin}/?watch=cancelled`,
  });
}

export function isWatchActive(sub: SubscriptionResponse, cfg: PayPalReady): boolean {
  return sub.plan_id === cfg.offers.watchPlanId && ["ACTIVE", "APPROVED"].includes(sub.status);
}
