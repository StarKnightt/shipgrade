import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { isWatchActive } from "@/lib/paypal/offers";
import { notConfigured, restClient, upstreamError } from "@/lib/paypal/server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const cfg = readPayPalConfig();
  if (!cfg.configured || !cfg.offers.watchPlanId) return notConfigured(cfg);
  const { id } = await ctx.params;
  try {
    const sub = await restClient(cfg).getSubscription(id);
    return NextResponse.json({ status: sub.status, active: isWatchActive(sub, cfg) });
  } catch (err) {
    return upstreamError(err);
  }
}
