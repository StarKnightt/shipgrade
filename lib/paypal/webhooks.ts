// Webhook event routing. Signature verification happens in the route via
// PayPalRest.verifyWebhookSignature before any event reaches this function.

export interface WebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: Record<string, unknown>;
  create_time?: string;
}

export type WebhookAction =
  | { kind: "deep_audit_paid"; orderId: string | null; captureId: string; amount: string | null; customId: string | null }
  | { kind: "watch_activated" | "watch_cancelled"; subscriptionId: string; planId: string | null; customId: string | null }
  | { kind: "preview_payment"; eventType: string; resourceId: string; customId: string }
  | { kind: "invoice_paid"; invoiceId: string }
  | { kind: "ignored"; eventType: string };

const str = (v: unknown) => (typeof v === "string" ? v : null);

export function routeWebhookEvent(event: WebhookEvent): WebhookAction {
  const r = event.resource ?? {};
  const customId = str(r.custom_id);
  // Purchases on agent-provisioned preview catalogs carry "preview:<site>:<tier>"
  // and must not unlock Shipgrade's own offers.
  if (customId?.startsWith("preview:")) {
    return { kind: "preview_payment", eventType: event.event_type, resourceId: str(r.id) ?? "", customId };
  }
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const related = (r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids;
      return {
        kind: "deep_audit_paid",
        orderId: str(related?.order_id),
        captureId: str(r.id) ?? "",
        amount: str((r.amount as { value?: string } | undefined)?.value),
        customId,
      };
    }
    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.CANCELLED":
      return {
        kind: event.event_type.endsWith("ACTIVATED") ? "watch_activated" : "watch_cancelled",
        subscriptionId: str(r.id) ?? "",
        planId: str(r.plan_id),
        customId,
      };
    case "INVOICING.INVOICE.PAID":
      return { kind: "invoice_paid", invoiceId: str(r.id) ?? "" };
    default:
      return { kind: "ignored", eventType: event.event_type };
  }
}
