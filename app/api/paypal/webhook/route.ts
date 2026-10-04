import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { webhookHeadersFrom } from "@/lib/paypal/rest";
import { notConfigured, restClient } from "@/lib/paypal/server";
import { routeWebhookEvent, type WebhookEvent } from "@/lib/paypal/webhooks";

export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  if (!cfg.configured || !cfg.webhookId) return notConfigured(cfg);

  const raw = await request.text();
  let verified = false;
  try {
    verified = await restClient(cfg).verifyWebhookSignature(
      webhookHeadersFrom(request.headers),
      raw,
      cfg.webhookId,
    );
  } catch {
    verified = false;
  }
  if (!verified) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });

  const action = routeWebhookEvent(JSON.parse(raw) as WebhookEvent);
  // Phase 2: persist purchases/subscriptions (Upstash) and unlock features.
  console.info("[paypal:webhook]", action.kind, JSON.stringify(action));
  return NextResponse.json({ received: true, action: action.kind });
}
