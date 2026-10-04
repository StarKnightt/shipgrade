import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { deepAuditUnlockFrom, signUnlock } from "@/lib/paypal/offers";
import { notConfigured, restClient, upstreamError } from "@/lib/paypal/server";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const cfg = readPayPalConfig();
  if (!cfg.configured) return notConfigured(cfg);
  const { id } = await ctx.params;
  try {
    const order = await restClient(cfg).captureOrder(id);
    const unlock = deepAuditUnlockFrom(order, cfg);
    if (!unlock) {
      return NextResponse.json({ status: order.status, unlocked: false }, { status: 402 });
    }
    return NextResponse.json({
      status: order.status,
      unlocked: true,
      captureId: unlock.captureId,
      unlockToken: signUnlock(unlock, cfg),
    });
  } catch (err) {
    return upstreamError(err);
  }
}
