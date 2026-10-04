import { NextResponse } from "next/server";
import { provision, type ProvisionEvent, type ProvisionResult } from "@/lib/paypal/agent";
import { CatalogProposalSchema, type CatalogProposal } from "@/lib/paypal/catalog";
import { createChatClient } from "@/lib/paypal/chat";
import { readPayPalConfig, type PayPalConfig } from "@/lib/paypal/config";
import { agentExecutor, badRequest, notConfigured, originOf, readJson, tokenSecret } from "@/lib/paypal/server";
import { buttonSnippet } from "@/lib/paypal/snippet";
import { signToken, type PreviewPayload } from "@/lib/paypal/token";

export const maxDuration = 60;

function finalPayload(result: ProvisionResult, proposal: CatalogProposal, cfg: PayPalConfig) {
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
    site: proposal.site,
    productName: proposal.product.name,
    simulated: result.simulated,
    plans: previewPlans,
  };
  return {
    status: "ok",
    result,
    previewToken: signToken(payload, tokenSecret(cfg)),
    snippet: buttonSnippet({ clientId: cfg.configured ? cfg.clientId : null, plans: previewPlans }),
  };
}

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
  const urls = { returnUrl: `${origin}/preview/done`, cancelUrl: `${origin}/preview/done?cancelled=1` };

  if (body?.stream !== true) {
    const result = await provision(parsed.data, executor, createChatClient(), { urls });
    return NextResponse.json(finalPayload(result, parsed.data, cfg));
  }

  // NDJSON: one event per line as the agent works, then the final payload.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        const result = await provision(parsed.data, executor, createChatClient(), {
          urls,
          onEvent: (event: ProvisionEvent) => send(event),
        });
        send({ type: "done", ...finalPayload(result, parsed.data, cfg) });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Provisioning failed." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
