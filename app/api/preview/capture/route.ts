import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { captureOf } from "@/lib/paypal/rest";
import { badRequest, notConfigured, readJson, restClient, upstreamError } from "@/lib/paypal/server";

export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  if (!cfg.configured) return notConfigured(cfg);
  const body = await readJson(request);
  const orderId = typeof body?.orderId === "string" ? body.orderId : "";
  if (!orderId) return badRequest("Missing orderId.");
  try {
    const order = await restClient(cfg).captureOrder(orderId);
    const capture = captureOf(order);
    return NextResponse.json({ status: order.status, captureId: capture?.id ?? null });
  } catch (err) {
    return upstreamError(err);
  }
}
