import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { createWatchSubscription, hostKey } from "@/lib/paypal/offers";
import { badRequest, notConfigured, originOf, readJson, restClient, upstreamError } from "@/lib/paypal/server";

// Shipgrade Watch (monthly subscription, weekly re-grades).
export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  if (!cfg.configured || !cfg.offers.watchPlanId) return notConfigured(cfg);
  const body = await readJson(request);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!hostKey(url)) return badRequest("Send the graded page's url.");
  try {
    const sub = await createWatchSubscription(restClient(cfg), cfg, url, originOf(request));
    return NextResponse.json({ id: sub.id, status: sub.status });
  } catch (err) {
    return upstreamError(err);
  }
}
