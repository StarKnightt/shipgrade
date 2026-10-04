"use client";

import { useState } from "react";
import type { AnalysisResult } from "@/lib/analyze";
import type { ProvisionResult } from "@/lib/paypal/agent";
import type { CatalogProposal, ProposedPlan } from "@/lib/paypal/catalog";
import type { PublicPayPalStatus } from "@/lib/paypal/config";

export type PayPalStatus = PublicPayPalStatus & { agentLLM: boolean };

type Phase = "idle" | "proposing" | "proposed" | "provisioning" | "done" | "error";

interface Provisioned {
  result: ProvisionResult;
  previewToken: string;
  snippet: string;
}

const INTERVAL_LABEL: Record<ProposedPlan["interval"], string> = {
  MONTH: "/mo",
  YEAR: "/yr",
  ONE_TIME: " once",
};

export default function CheckoutAgent({
  result,
  status,
}: {
  result: AnalysisResult;
  status: PayPalStatus | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [proposal, setProposal] = useState<CatalogProposal | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Provisioned | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const canProvision = Boolean(status && (status.configured || status.dryRun));

  async function draft() {
    setPhase("proposing");
    setError("");
    try {
      const res = await fetch("/api/agent/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.finalUrl, title: result.title, checkout: result.checkout }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't draft a catalog.");
      setProposal(data.proposal);
      setExcluded(new Set());
      setPhase("proposed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function approve() {
    if (!proposal) return;
    const approved = { ...proposal, plans: proposal.plans.filter((p) => !excluded.has(p.tierId)) };
    if (!approved.plans.length) return;
    setPhase("provisioning");
    setError("");
    try {
      const res = await fetch("/api/agent/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, proposal: approved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Provisioning failed.");
      setDone(data);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function copySnippet() {
    if (!done) return;
    try {
      await navigator.clipboard.writeText(done.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  const toggle = (tierId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) next.delete(tierId);
      else next.add(tierId);
      return next;
    });

  return (
    <section className="animate-fade-up mt-4 overflow-hidden rounded-2xl border-2 border-accent/60 bg-surface shadow-sm">
      <div className="flex flex-col gap-4 border-b border-(--border) p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
            Checkout agent · PayPal sandbox
          </span>
          <h3 className="mt-1.5 font-serif text-2xl font-semibold tracking-tight">
            Don&apos;t just grade it. Ship the fix.
          </h3>
          <p className="text-pretty mt-1.5 max-w-xl text-sm leading-6 text-muted">
            The agent reads your pricing, drafts a PayPal catalog for you to approve, then creates the
            product and plans with the PayPal Agent Toolkit and hands back a working checkout.
          </p>
        </div>
        {phase === "idle" || phase === "error" ? (
          <button
            onClick={draft}
            className="shrink-0 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition-transform hover:scale-[1.02] active:scale-95"
          >
            Draft my PayPal catalog →
          </button>
        ) : null}
      </div>

      <div className="p-5 sm:p-7">
        <SandboxBanner status={status} />

        {phase === "idle" && (
          <ol className="grid gap-3 text-sm sm:grid-cols-3">
            {[
              ["1", "Draft", "Plans and prices mapped from your page."],
              ["2", "Approve", "Nothing is created until you say so."],
              ["3", "Ship", "PayPal plans, live preview, and v6 button code."],
            ].map(([n, t, d]) => (
              <li key={n} className="rounded-xl border border-(--border) bg-background/60 p-4">
                <span className="font-mono text-xs text-accent">{n}</span>
                <div className="mt-1 font-semibold">{t}</div>
                <div className="mt-0.5 text-muted">{d}</div>
              </li>
            ))}
          </ol>
        )}

        {(phase === "proposing" || phase === "provisioning") && (
          <div className="flex items-center gap-3 py-6 text-sm text-muted">
            <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-dashed border-accent" />
            {phase === "proposing"
              ? "Reading your plans and drafting a PayPal catalog…"
              : "The agent is calling PayPal: creating your product and plans…"}
          </div>
        )}

        {phase === "error" && (
          <p role="alert" className="rounded-lg border border-grade-poor/45 bg-grade-poor/10 px-4 py-3 text-sm text-grade-poor">
            {error}
          </p>
        )}

        {phase === "proposed" && proposal && (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-serif text-lg font-semibold">
                {proposal.product.name}
                <span className="ml-2 font-mono text-[11px] font-normal uppercase tracking-[0.14em] text-muted">
                  PayPal catalog product
                </span>
              </h4>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {proposal.source === "ai" ? "AI-refined draft" : "Rule-engine draft"}
              </span>
            </div>
            {proposal.rationale && (
              <p className="text-pretty mt-2 border-l-2 border-accent pl-3.5 font-serif text-[0.95rem] italic leading-7 text-foreground/85">
                {proposal.rationale}
              </p>
            )}

            <ul className="mt-4 divide-y divide-(--border) rounded-xl border border-(--border) bg-background/60">
              {proposal.plans.map((p) => {
                const on = !excluded.has(p.tierId);
                return (
                  <li key={p.tierId} className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(p.tierId)}
                      aria-label={`Include ${p.name}`}
                      className="h-4 w-4 accent-(--accent)"
                    />
                    <div className={`flex-1 ${on ? "" : "opacity-45 line-through"}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {p.name}
                        {p.suggested && (
                          <span className="rounded-full border border-accent/50 px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
                            Suggested
                          </span>
                        )}
                        {p.trialDays > 0 && (
                          <span className="rounded-full border border-(--border-strong) px-1.5 py-px font-mono text-[10px] text-muted">
                            {p.trialDays}-day trial
                          </span>
                        )}
                      </div>
                      {p.description && <div className="text-xs text-muted">{p.description}</div>}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold">
                        ${p.amount}
                        <span className="font-normal text-muted">{INTERVAL_LABEL[p.interval]}</span>
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                        {p.interval === "ONE_TIME" ? "Order" : "Subscription plan"}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {proposal.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {proposal.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                onClick={approve}
                disabled={!canProvision || excluded.size === proposal.plans.length}
                className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition-transform enabled:hover:scale-[1.02] enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {status?.configured && !status.dryRun
                  ? "Approve & create in PayPal sandbox"
                  : "Approve & simulate (dry run)"}
              </button>
              <button
                onClick={() => setPhase("idle")}
                className="rounded-xl border border-(--border-strong) px-5 py-3 text-sm font-medium transition-colors hover:border-accent"
              >
                Cancel
              </button>
              {!canProvision && (
                <span className="text-xs text-muted">Connect a PayPal sandbox app to create these plans.</span>
              )}
            </div>
          </div>
        )}

        {phase === "done" && done && (
          <ProvisionedView done={done} onCopy={copySnippet} copied={copied} />
        )}
      </div>
    </section>
  );
}

function SandboxBanner({ status }: { status: PayPalStatus | null }) {
  if (!status) return null;
  if (status.configured && !status.dryRun) {
    return (
      <p className="mb-4 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-grade-excellent">
        <span className="h-1.5 w-1.5 rounded-full bg-grade-excellent" />
        Connected to PayPal sandbox{status.agentLLM ? " · AI agent on" : " · rule engine"}
      </p>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-grade-mixed/50 bg-grade-mixed/10 px-4 py-3 text-sm text-foreground/85">
      <span className="font-semibold text-grade-mixed">
        {status.dryRun ? "Dry run: PayPal responses are simulated." : "PayPal sandbox not configured."}
      </span>{" "}
      {status.dryRun
        ? "Plans get placeholder ids and the preview buttons stay inert."
        : `Add ${status.missing.join(" and ") || "sandbox credentials"} to .env.local (or set PAYPAL_DRY_RUN=true) to provision plans.`}
    </div>
  );
}

function ProvisionedView({
  done,
  onCopy,
  copied,
}: {
  done: Provisioned;
  onCopy: () => void;
  copied: boolean;
}) {
  const { result } = done;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
            result.complete ? "bg-grade-excellent/15 text-grade-excellent" : "bg-grade-mixed/15 text-grade-mixed"
          }`}
        >
          {result.complete ? "Provisioned" : "Partially provisioned"}
          {result.simulated ? " · simulated" : ""}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {result.mode === "agent" ? "Driven by the AI agent" : "Rule engine"}
        </span>
      </div>
      <p className="mt-2 font-serif text-lg">{result.summary}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">PayPal tool calls</h4>
          <ol className="mt-2 space-y-1.5">
            {result.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-(--border) bg-background/60 px-3 py-2 text-xs">
                <span
                  className="mt-px font-mono font-bold"
                  style={{
                    color:
                      s.status === "ok" ? "var(--grade-excellent)" : s.status === "rejected" ? "var(--grade-mixed)" : "var(--grade-poor)",
                  }}
                >
                  {s.status === "ok" ? "✓" : s.status === "rejected" ? "⊘" : "✕"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-mono">
                    {s.tool}
                    <span className="ml-1.5 text-muted">by {s.by}</span>
                  </div>
                  <div className="truncate text-muted">{s.resultId ?? s.message}</div>
                </div>
              </li>
            ))}
          </ol>
          <ul className="mt-3 space-y-1 text-xs">
            {result.plans.map((p) => (
              <li key={p.tierId} className="flex justify-between gap-3">
                <span>{p.name}</span>
                <span className="truncate font-mono text-muted">{p.paypalPlanId ?? p.orderId ?? "not created"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Live preview · your pricing with PayPal
          </h4>
          <iframe
            title="Pricing preview with PayPal buttons"
            src={`/preview?t=${encodeURIComponent(done.previewToken)}`}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            className="mt-2 h-[460px] w-full rounded-xl border border-(--border-strong) bg-white"
          />
          <a
            href={`/preview?t=${encodeURIComponent(done.previewToken)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block font-mono text-[11px] text-accent hover:opacity-70"
          >
            Open preview in a new tab ↗
          </a>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Drop-in code · PayPal JS SDK v6
          </h4>
          <button onClick={onCopy} className="font-mono text-[11px] text-accent hover:opacity-70">
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-(--border) bg-foreground p-4 font-mono text-[11.5px] leading-5 text-background">
          {done.snippet}
        </pre>
      </div>
    </div>
  );
}
