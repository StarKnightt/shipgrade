import { NextResponse } from "next/server";
import { publicStatus } from "@/lib/paypal/config";
import { createChatClient } from "@/lib/paypal/chat";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ...publicStatus(), agentLLM: Boolean(createChatClient()) });
}
