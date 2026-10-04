"use client";

import { useState } from "react";
import type { PayPalStatus } from "./CheckoutAgent";
import PayPalButton from "./PayPalButton";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data;
}

export default function ShipgradeUpgrade({ url, status }: { url: string; status: PayPalStatus | null }) {
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!status) return null;
  // Gated on env: hidden in production until PayPal is configured.
  if (!status.configured && process.env.NODE_ENV === "production") return null;

  const notConfigured = status.configured ? null : "Payments not configured";
  const offers = [
    {
      key: "deep",
      name: "Deep Audit",
      price: `$${Number(status.offers.deepAudit.price)}`,
      cadence: "one-time",
      blurb: "Every page of your funnel graded, plus the full fix pack with rewritten copy and checkout code.",
      button: (
        <PayPalButton
          sdkUrl={status.sdkUrl}
          clientId={status.clientId}
          mode="order"
          disabledReason={notConfigured}
          create={async () => (await postJson("/api/checkout/orders", { url })).id}
          onApproved={async (orderId) => {
            const data = await postJson(`/api/checkout/orders/${orderId}/capture`);
            if (data.unlockToken) localStorage.setItem("shipgrade:deep-audit", data.unlockToken);
            setMessage({ tone: "ok", text: `Paid. Deep Audit unlocked (capture ${data.captureId}).` });
          }}
          onError={(text) => setMessage({ tone: "error", text })}
        />
      ),
    },
    {
      key: "watch",
      name: "Shipgrade Watch",
      price: `$${Number(status.offers.watch.price)}`,
      cadence: "per month",
      blurb: "We re-grade your page every week and email you the moment your score or checkout slips.",
      button: (
        <PayPalButton
          sdkUrl={status.sdkUrl}
          clientId={status.clientId}
          mode="subscription"
          disabledReason={notConfigured ?? (status.offers.watch.enabled ? null : "Watch plan not set up")}
          create={async () => (await postJson("/api/checkout/subscriptions", { url })).id}
          onApproved={async (subscriptionId) => {
            const data = await postJson(`/api/checkout/subscriptions/${subscriptionId}/verify`);
            setMessage(
              data.active
                ? { tone: "ok", text: `Subscribed. Watch is ${data.status.toLowerCase()} (${subscriptionId}).` }
                : { tone: "error", text: `Subscription is ${data.status}. We'll activate it once PayPal confirms.` },
            );
          }}
          onError={(text) => setMessage({ tone: "error", text })}
        />
      ),
    },
  ];

  return (
    <section className="animate-fade-up mt-4 rounded-2xl border border-(--border) bg-surface p-5 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-serif text-xl font-semibold tracking-tight">Go deeper with Shipgrade</h3>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          Paid with PayPal · sandbox
        </span>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {offers.map((o) => (
          <div key={o.key} className="flex flex-col rounded-xl border border-(--border) bg-background/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{o.name}</span>
              <span>
                <span className="font-mono text-xl font-bold">{o.price}</span>
                <span className="ml-1 text-xs text-muted">{o.cadence}</span>
              </span>
            </div>
            <p className="mt-1.5 flex-1 text-sm leading-6 text-muted">{o.blurb}</p>
            <div className="mt-3">{o.button}</div>
          </div>
        ))}
      </div>
      {message && (
        <p
          role="status"
          className={`mt-3 text-sm ${message.tone === "ok" ? "text-grade-excellent" : "text-grade-poor"}`}
        >
          {message.text}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">Secure PayPal checkout · cancel Watch anytime · no account needed to pay.</p>
    </section>
  );
}
