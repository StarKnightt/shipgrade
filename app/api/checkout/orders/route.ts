import { NextResponse } from "next/server";
import { readPayPalConfig } from "@/lib/paypal/config";
import { createDeepAuditOrder, hostKey } from "@/lib/paypal/offers";
import { badRequest, notConfigured, readJson, restClient, upstreamError } from "@/lib/paypal/server";

// Deep Audit (one-time). The price comes from server env, never the browser.
export async function POST(request: Request) {
  const cfg = readPayPalConfig();
  if (!cfg.configured) return notConfigured(cfg);
  const body = await readJson(request);
  const url = typeof body?.url === "string" ? body.url : "";
  if (!hostKey(url)) return badRequest("Send the graded page's url.");
  try {
    const order = await createDeepAuditOrder(restClient(cfg), cfg, url);
    return NextResponse.json({ id: order.id, status: order.status });
  } catch (err) {
    return upstreamError(err);
  }
}
