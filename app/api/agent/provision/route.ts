import { NextResponse } from "next/server";
import { provision } from "@/lib/paypal/agent";
import { CatalogProposalSchema } from "@/lib/paypal/catalog";
import { createChatClient } from "@/lib/paypal/chat";
import { readPayPalConfig } from "@/lib/paypal/config";
import { agentExecutor, badRequest, notConfigured, originOf, readJson, tokenSecret } from "@/lib/paypal/server";
import { buttonSnippet } from "@/lib/paypal/snippet";
import { signToken, type PreviewPayload } from "@/lib/paypal/token";

export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await readJson(request);
  if (body?.approved !== true) return badRequest("Provisioning needs explicit approval (approved: true).");
  const parsed = CatalogProposalSchema.safeParse(body?.proposal);
  if (!parsed.success) {
    return badRequest(`Invalid proposal: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  const cfg = readPayPalConfig();
  const executor = await agentExecutor(cfg);
  if (!executor) return notConfigured(cfg);

  const origin = originOf(request);
  const result = await provision(parsed.data, executor, createChatClient(), {
    urls: { returnUrl: `${origin}/preview/done`, cancelUrl: `${origin}/preview/done?cancelled=1` },
  });

  const previewPlans = result.plans
    .filter((p) => p.paypalPlanId || p.interval === "ONE_TIME")
    .map((p) => ({
      tierId: p.tierId,
      name: p.name,
      description: p.description,
      amount: p.amount,
      currency: p.currency,
      interval: p.interval,
      paypalPlanId: p.paypalPlanId,
    }));
  const payload: PreviewPayload = {
    kind: "preview",
    site: parsed.data.site,
    productName: parsed.data.product.name,
    simulated: result.simulated,
    plans: previewPlans,
  };

  return NextResponse.json({
    status: "ok",
    result,
    previewToken: signToken(payload, tokenSecret(cfg)),
    snippet: buttonSnippet({ clientId: cfg.configured ? cfg.clientId : null, plans: previewPlans }),
  });
}
