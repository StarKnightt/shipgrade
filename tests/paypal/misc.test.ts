import { describe, expect, it } from "vitest";
import { readPayPalConfig, type PayPalReady } from "@/lib/paypal/config";
import { deepAuditUnlockFrom, hostKey, isWatchActive } from "@/lib/paypal/offers";
import { buttonSnippet } from "@/lib/paypal/snippet";
import { signToken, verifyToken, type PreviewPlan } from "@/lib/paypal/token";
import { routeWebhookEvent } from "@/lib/paypal/webhooks";
import { SUBSCRIPTION_CREATED, WEBHOOK_CAPTURE_COMPLETED, orderCaptured } from "../fixtures/paypal";

const cfg = readPayPalConfig({
  PAYPAL_CLIENT_ID: "cid",
  PAYPAL_CLIENT_SECRET: "secret",
  SHIPGRADE_WATCH_PLAN_ID: SUBSCRIPTION_CREATED.plan_id,
}) as PayPalReady;

describe("signed tokens", () => {
  it("round-trips and rejects tampering or expiry", () => {
    const t = signToken({ kind: "preview", plans: [{ amount: "9.00" }] }, "k");
    expect(verifyToken<{ kind: string }>(t, "k")?.kind).toBe("preview");
    expect(verifyToken(t, "other")).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString().replace("9.00", "0.01")).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "k")).toBeNull();
    expect(verifyToken(signToken({ a: 1 }, "k", -10), "k")).toBeNull();
  });
});

describe("buttonSnippet", () => {
  const plans: PreviewPlan[] = [
    { tierId: "pro", name: "Pro <b>", description: "", amount: "29.00", currency: "USD", interval: "MONTH", paypalPlanId: "P-123" },
    { tierId: "lifetime", name: "Lifetime", description: "", amount: "199.00", currency: "USD", interval: "ONE_TIME", paypalPlanId: null },
  ];
  const code = buttonSnippet({ clientId: "SANDBOX_CID", plans });

  it("uses JS SDK v6 with both components and the plan ids", () => {
    expect(code).toContain("https://www.sandbox.paypal.com/web-sdk/v6/core");
    expect(code).toContain('clientId: "SANDBOX_CID"');
    expect(code).toContain('["paypal-payments","paypal-subscriptions"]');
    expect(code).toContain('"pro": "P-123"');
    expect(code).toContain("createPayPalOneTimePaymentSession");
    expect(code).toContain('paymentFlow: "RECURRING_PAYMENT"');
    expect(code).toContain("sdk.createPayPalSubscriptionPaymentSession(");
    expect(code).not.toContain("createPayPalSubscriptionSession");
  });

  it("escapes plan names", () => {
    expect(code).not.toContain("Pro <b>");
    expect(code).toContain("Pro &lt;b&gt;");
  });

  it("uses a placeholder client id when unconfigured", () => {
    expect(buttonSnippet({ clientId: null, plans })).toContain("YOUR_SANDBOX_CLIENT_ID");
  });
});

describe("Shipgrade offers", () => {
  it("unlocks a Deep Audit only for a fully captured order at the right price", () => {
    expect(deepAuditUnlockFrom(orderCaptured(), cfg)).toMatchObject({ host: "acme.dev", captureId: "3C679366HH908993F" });
    expect(deepAuditUnlockFrom(orderCaptured("0.01"), cfg)).toBeNull();
    expect(deepAuditUnlockFrom(orderCaptured("9.00", "preview:x:y"), cfg)).toBeNull();
    expect(deepAuditUnlockFrom({ ...orderCaptured(), status: "APPROVED" }, cfg)).toBeNull();
  });

  it("checks the Watch subscription plan and status", () => {
    expect(isWatchActive({ ...SUBSCRIPTION_CREATED, status: "ACTIVE" }, cfg)).toBe(true);
    expect(isWatchActive(SUBSCRIPTION_CREATED, cfg)).toBe(false);
    expect(isWatchActive({ ...SUBSCRIPTION_CREATED, status: "ACTIVE", plan_id: "P-OTHER" }, cfg)).toBe(false);
  });

  it("normalises hosts", () => {
    expect(hostKey("www.Acme.dev/pricing")).toBe("acme.dev");
    expect(hostKey("")).toBe("");
  });
});

describe("routeWebhookEvent", () => {
  it("maps capture, subscription, and invoice events", () => {
    expect(routeWebhookEvent(WEBHOOK_CAPTURE_COMPLETED)).toEqual({
      kind: "deep_audit_paid",
      orderId: "5O190127TN364715T",
      captureId: "3C679366HH908993F",
      amount: "9.00",
      customId: "deep-audit:acme.dev",
    });
    expect(
      routeWebhookEvent({ id: "1", event_type: "BILLING.SUBSCRIPTION.ACTIVATED", resource: { id: "I-1", plan_id: "P-1" } }),
    ).toMatchObject({ kind: "watch_activated", subscriptionId: "I-1" });
    expect(routeWebhookEvent({ id: "2", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-1" } })).toEqual({
      kind: "invoice_paid",
      invoiceId: "INV2-1",
    });
    expect(routeWebhookEvent({ id: "3", event_type: "CHECKOUT.ORDER.APPROVED" }).kind).toBe("ignored");
    expect(
      routeWebhookEvent({
        id: "4",
        event_type: "BILLING.SUBSCRIPTION.ACTIVATED",
        resource: { id: "I-2", plan_id: "P-2", custom_id: "preview:linear.app:basic" },
      }),
    ).toEqual({
      kind: "preview_payment",
      eventType: "BILLING.SUBSCRIPTION.ACTIVATED",
      resourceId: "I-2",
      customId: "preview:linear.app:basic",
    });
  });
});
