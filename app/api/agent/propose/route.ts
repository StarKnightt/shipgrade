import { NextResponse } from "next/server";
import type { MonetizationSignals } from "@/lib/monetization";
import { propose } from "@/lib/paypal/agent";
import { createChatClient } from "@/lib/paypal/chat";
import { badRequest, readJson } from "@/lib/paypal/server";

export async function POST(request: Request) {
  const body = await readJson(request);
  const checkout = body?.checkout as MonetizationSignals | undefined;
  const url = typeof body?.url === "string" ? body.url : "";
  if (!checkout || !Array.isArray(checkout.tiers) || !url) {
    return badRequest("Send { url, title, checkout } from a Shipgrade analysis.");
  }
  const title = typeof body?.title === "string" ? body.title : null;
  const proposal = await propose(checkout, { url, title }, createChatClient());
  return NextResponse.json({ proposal });
}
