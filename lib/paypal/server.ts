// Server-only wiring shared by the PayPal route handlers.

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { readPayPalConfig, type PayPalConfig, type PayPalReady } from "./config";
import { PayPalRest } from "./rest";
import { createDryRunExecutor, createToolkitExecutor, type ToolExecutor } from "./toolkit";

// Route handlers and pages are separate bundles, so share via globalThis.
const g = globalThis as { __shipgradeDevSecret?: string };
g.__shipgradeDevSecret ??= randomBytes(32).toString("hex");

/** Secret for signed preview/unlock tokens. Per-process when PayPal isn't set up. */
export function tokenSecret(cfg: PayPalConfig): string {
  return cfg.configured
    ? cfg.signingSecret
    : process.env.SHIPGRADE_SIGNING_SECRET?.trim() || g.__shipgradeDevSecret!;
}

/** Real toolkit executor when configured; simulated one when PAYPAL_DRY_RUN is on. */
export async function agentExecutor(cfg: PayPalConfig): Promise<ToolExecutor | null> {
  if (cfg.dryRun) return createDryRunExecutor();
  if (cfg.configured) return createToolkitExecutor(cfg);
  return null;
}

export function restClient(cfg: PayPalReady): PayPalRest {
  return new PayPalRest({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, apiBase: cfg.apiBase });
}

export function notConfigured(cfg: PayPalConfig = readPayPalConfig()) {
  return NextResponse.json(
    {
      status: "not_configured",
      error: cfg.configured ? "Not available." : cfg.reason,
      missing: cfg.configured ? [] : cfg.missing,
    },
    { status: 503 },
  );
}

export function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export function upstreamError(err: unknown) {
  const message = err instanceof Error ? err.message : "PayPal request failed";
  const debugId = (err as { debugId?: string })?.debugId ?? null;
  return NextResponse.json({ error: message, debugId }, { status: 502 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function originOf(request: Request): string {
  return new URL(request.url).origin;
}
