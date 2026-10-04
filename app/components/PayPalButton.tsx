"use client";

import { useEffect, useRef, useState } from "react";
import {
  createSubscriptionSession,
  getPayPalInstance,
  type PayPalSession,
} from "@/lib/paypal/sdk-client";

export interface PayPalButtonProps {
  sdkUrl: string;
  clientId: string | null;
  mode: "order" | "subscription";
  /** Server call that creates the order/subscription and returns its id. */
  create: () => Promise<string>;
  onApproved: (id: string) => Promise<void> | void;
  onError?: (message: string) => void;
  disabledReason?: string | null;
}

type State = "loading" | "ready" | "ineligible" | "error";

export default function PayPalButton({
  sdkUrl,
  clientId,
  mode,
  create,
  onApproved,
  onError,
  disabledReason,
}: PayPalButtonProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("loading");
  const latest = useRef({ create, onApproved, onError });
  useEffect(() => {
    latest.current = { create, onApproved, onError };
  });

  const disabled = disabledReason ?? (clientId ? null : "PayPal sandbox not configured");

  useEffect(() => {
    if (disabled || !clientId) return;
    let cancelled = false;
    let button: HTMLElement | null = null;

    (async () => {
      try {
        const instance = await getPayPalInstance(
          sdkUrl,
          clientId,
          mode === "order" ? "paypal-payments" : "paypal-subscriptions",
        );
        const methods = await instance.findEligibleMethods(
          mode === "order"
            ? { currencyCode: "USD" }
            : { currencyCode: "USD", paymentFlow: "RECURRING_PAYMENT" },
        );
        if (cancelled) return;
        if (!methods.isEligible("paypal")) {
          setState("ineligible");
          return;
        }
        const callbacks = {
          onApprove: async (data: { orderId?: string; subscriptionId?: string }) => {
            const id = mode === "order" ? data.orderId : data.subscriptionId;
            if (id) await latest.current.onApproved(id);
          },
          onError: (err: { message?: string }) =>
            latest.current.onError?.(err?.message ?? "PayPal checkout failed"),
        };
        const session: PayPalSession =
          mode === "order"
            ? instance.createPayPalOneTimePaymentSession(callbacks)
            : createSubscriptionSession(instance, callbacks);

        button = document.createElement("paypal-button");
        button.setAttribute("type", mode === "order" ? "pay" : "subscribe");
        button.addEventListener("click", () => {
          // Start synchronously inside the click so the popup isn't blocked.
          const payment = latest.current
            .create()
            .then((id) => (mode === "order" ? { orderId: id } : { subscriptionId: id }));
          session.start({ presentationMode: "auto" }, payment).catch((e: unknown) => {
            latest.current.onError?.(e instanceof Error ? e.message : "PayPal checkout failed");
          });
        });
        host.current?.appendChild(button);
        setState("ready");
      } catch (e) {
        if (cancelled) return;
        setState("error");
        latest.current.onError?.(e instanceof Error ? e.message : "PayPal failed to load");
      }
    })();

    return () => {
      cancelled = true;
      button?.remove();
    };
  }, [sdkUrl, clientId, mode, disabled]);

  if (disabled) {
    return (
      <div className="flex h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-(--border-strong) bg-surface-2/60 px-3 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
        <PayPalMark />
        {disabled}
      </div>
    );
  }

  return (
    <div>
      <div ref={host} className="min-h-11 [&_paypal-button]:block [&_paypal-button]:w-full" />
      {state === "loading" && (
        <div className="h-11 animate-pulse rounded-lg bg-surface-2" aria-label="Loading PayPal" />
      )}
      {state === "ineligible" && (
        <p className="text-xs text-muted">PayPal isn&apos;t available for this browser or region.</p>
      )}
      {state === "error" && <p className="text-xs text-grade-poor">PayPal couldn&apos;t load.</p>}
    </div>
  );
}

function PayPalMark() {
  return (
    <svg width="12" height="14" viewBox="0 0 24 28" aria-hidden fill="currentColor">
      <path d="M20.1 2.2C18.8.8 16.5.2 13.5.2H4.8a1.3 1.3 0 0 0-1.2 1L0 23.9a.8.8 0 0 0 .8.9h5.4l1.3-8.6v.3a1.3 1.3 0 0 1 1.3-1h2.6c5.1 0 9.1-2.1 10.3-8.1v-.5c.4-2.3 0-3.8-1.4-5.4z" />
    </svg>
  );
}
