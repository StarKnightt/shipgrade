import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { badRequest, notConfigured, readJson, restClient, upstreamError } from "@/lib/paypal/server";

export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  if (!cfg.configured) return notConfigured(cfg);
  const body = await readJson(request);
  const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId : "";
  if (!subscriptionId) return badRequest("Missing subscriptionId.");
  try {
    const sub = await restClient(cfg).getSubscription(subscriptionId);
    return NextResponse.json({ status: sub.status, active: ["ACTIVE", "APPROVED"].includes(sub.status) });
  } catch (err) {
    return upstreamError(err);
  }
}
