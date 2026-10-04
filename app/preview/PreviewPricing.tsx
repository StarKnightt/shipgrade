"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, LockSimple, WarningCircle } from "@phosphor-icons/react";
import type { PublicPayPalStatus } from "@/lib/paypal/config";
import type { PreviewPayload } from "@/lib/paypal/token";
import PayPalButton from "../components/PayPalButton";

const CADENCE = { MONTH: "/month", YEAR: "/year", ONE_TIME: " one-time" } as const;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

function successText(status: string, id: string, oneTime: boolean): string {
  if (oneTime) return `Payment ${status.toLowerCase()} · capture ${id}`;
  return `Subscription ${status.toLowerCase()} · ${id}`;
}

export default function PreviewPricing({
  payload,
  token,
  status,
}: {
  payload: PreviewPayload;
  token: string;
  status: PublicPayPalStatus;
}) {
  const [result, setResult] = useState<Record<string, { tone: "ok" | "error"; text: string; raw: string }>>({});
  const root = useRef<HTMLDivElement>(null);
  const disabledReason = !status.configured
    ? "PayPal sandbox not configured"
    : payload.simulated
      ? "Dry run: simulated plan"
      : null;
  const n = payload.plans.length;
  const featured = n >= 3 ? 1 : n - 1;
  const cols = n === 1 ? "" : n === 2 || n === 4 ? "sm:grid-cols-2" : "sm:grid-cols-2 md:grid-cols-3";

  // Report the page height so the parent report can size its preview frame.
  useEffect(() => {
    if (window.parent === window || !root.current) return;
    const post = () =>
      window.parent.postMessage(
        // + the main element's vertical padding (py-9)
        { type: "shipgrade:preview-height", height: Math.ceil(root.current!.getBoundingClientRect().height) + 72 },
        window.location.origin,
      );
    const ro = new ResizeObserver(post);
    ro.observe(root.current);
    post();
    return () => ro.disconnect();
  }, []);

  return (
    <main className="min-h-dvh bg-white px-5 py-9 text-neutral-900 sm:px-8">
      <div ref={root} className="mx-auto max-w-4xl">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600">
            Sandbox preview of {payload.site}
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance">{payload.productName} pricing</h1>
          <p className="mt-2 text-sm text-neutral-500">Pick a plan and pay with PayPal. Cancel anytime.</p>
        </div>

        {n === 0 ? (
          <p className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
            No plans were created for this preview. Go back to the report and approve at least one plan.
          </p>
        ) : (
          <div className={`mx-auto mt-8 grid gap-4 ${cols} ${n === 1 ? "max-w-sm" : ""}`}>
            {payload.plans.map((p, i) => {
              const r = result[p.tierId];
              const isFeatured = i === featured && n > 1;
              return (
                <div
                  key={p.tierId}
                  className={`flex flex-col rounded-2xl border bg-white p-5 transition-shadow duration-200 ${
                    isFeatured ? "border-neutral-900 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.35)]" : "border-neutral-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">{p.name}</h2>
                    {isFeatured && (
                      <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-medium text-white">
                        Most popular
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight tabular-nums">${Number(p.amount)}</span>
                    <span className="text-sm text-neutral-500">{CADENCE[p.interval]}</span>
                  </div>
                  {p.description && <p className="mt-2 flex-1 text-sm leading-6 text-neutral-600">{p.description}</p>}
                  <div className="mt-5">
                    <PayPalButton
                      sdkUrl={status.sdkUrl}
                      clientId={status.clientId}
                      mode={p.interval === "ONE_TIME" ? "order" : "subscription"}
                      disabledReason={disabledReason}
                      create={async () => (await postJson("/api/preview/checkout", { token, tierId: p.tierId })).id}
                      onApproved={async (id) => {
                        const oneTime = p.interval === "ONE_TIME";
                        const data = oneTime
                          ? await postJson("/api/preview/capture", { orderId: id })
                          : await postJson("/api/preview/verify", { subscriptionId: id });
                        const ref = data.captureId ?? id;
                        setResult((prev) => ({
                          ...prev,
                          [p.tierId]: { tone: "ok", text: successText(data.status, ref, oneTime), raw: `${data.status}: ${ref}` },
                        }));
                      }}
                      onError={(text) => setResult((prev) => ({ ...prev, [p.tierId]: { tone: "error", text, raw: text } }))}
                    />
                    {r && (
                      <p
                        role="status"
                        data-result={r.raw}
                        className={`mt-2.5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                          r.tone === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {r.tone === "ok" ? (
                          <CheckCircle aria-hidden size={15} weight="fill" className="shrink-0" />
                        ) : (
                          <WarningCircle aria-hidden size={15} weight="fill" className="shrink-0" />
                        )}
                        <span className="min-w-0 break-all">{r.text}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-7 flex items-center justify-center gap-1.5 text-center text-xs text-neutral-500">
          <LockSimple aria-hidden size={13} weight="bold" />
          Secure checkout by PayPal. Generated by Shipgrade&apos;s checkout agent.
        </p>
      </div>
    </main>
  );
}
