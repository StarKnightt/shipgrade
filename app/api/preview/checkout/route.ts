import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { badRequest, notConfigured, readJson, restClient, tokenSecret, upstreamError } from "@/lib/paypal/server";
import { verifyToken, type PreviewPayload } from "@/lib/paypal/token";

// Creates the sandbox order or subscription behind a preview button. Prices
// and plan ids come only from the signed preview token.
export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  const body = await readJson(request);
  const token = typeof body?.token === "string" ? body.token : "";
  const tierId = typeof body?.tierId === "string" ? body.tierId : "";
  const payload = verifyToken<PreviewPayload>(token, tokenSecret(cfg));
  if (!payload || payload.kind !== "preview") return badRequest("Preview link expired or invalid.");
  if (!cfg.configured) return notConfigured(cfg);
  if (payload.simulated) {
    return NextResponse.json(
      { error: "This preview was provisioned in dry-run mode, so its plans don't exist in PayPal." },
      { status: 409 },
    );
  }
  const plan = payload.plans.find((p) => p.tierId === tierId);
  if (!plan) return badRequest("Unknown plan.");

  const rest = restClient(cfg);
  try {
    if (plan.interval === "ONE_TIME") {
      const order = await rest.createOrder({
        amount: plan.amount,
        currency: plan.currency,
        description: `${payload.productName}: ${plan.name}`,
        customId: `preview:${payload.site}:${plan.tierId}`,
        brandName: payload.productName,
      });
      return NextResponse.json({ kind: "order", id: order.id });
    }
    if (!plan.paypalPlanId) return badRequest("This plan has no PayPal plan id.");
    const sub = await rest.createSubscription({
      planId: plan.paypalPlanId,
      customId: `preview:${payload.site}:${plan.tierId}`,
      brandName: payload.productName,
    });
    return NextResponse.json({ kind: "subscription", id: sub.id });
  } catch (err) {
    return upstreamError(err);
  }
}
