"use client";

import { useEffect, useState } from "react";
import type { AnalysisResult } from "@/lib/analyze";
import type { ProvisionResult, ProvisionStep } from "@/lib/paypal/agent";
import type { CatalogProposal, ProposedPlan } from "@/lib/paypal/catalog";
import type { PublicPayPalStatus } from "@/lib/paypal/config";

export type PayPalStatus = PublicPayPalStatus & { agentLLM: boolean };

type Phase = "idle" | "proposing" | "proposed" | "provisioning" | "done" | "error";

interface Provisioned {
  result: ProvisionResult;
  previewToken: string;
  snippet: string;
  seconds: number;
}

const INTERVAL_LABEL: Record<ProposedPlan["interval"], string> = {
  MONTH: "/mo",
  YEAR: "/yr",
  ONE_TIME: " once",
};

const FOUND_INTERVAL: Record<string, string> = { month: "/mo", year: "/yr", week: "/wk", one_time: " once" };

export default function CheckoutAgent({
  result,
  status,
}: {
  result: AnalysisResult;
  status: PayPalStatus | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [failedAt, setFailedAt] = useState<"draft" | "provision">("draft");
  const [proposal, setProposal] = useState<CatalogProposal | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Provisioned | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);

  const canProvision = Boolean(status && (status.configured || status.dryRun));
  const hasPaidTiers = result.checkout.tiers.some((t) => !t.isFree && !t.isCustom && t.amount);
  const approvedPlans = proposal ? proposal.plans.filter((p) => !excluded.has(p.tierId)) : [];

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
      setFailedAt("draft");
      setPhase("error");
    }
  }

  async function approve() {
    if (!proposal || !approvedPlans.length) return;
    const started = Date.now();
    setStartedAt(started);
    setPhase("provisioning");
    setError("");
    try {
      const res = await fetch("/api/agent/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, proposal: { ...proposal, plans: approvedPlans } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Provisioning failed.");
      setDone({ ...data, seconds: (Date.now() - started) / 1000 });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setFailedAt("provision");
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

  const stage = phase === "done" || phase === "provisioning" ? 3 : phase === "error" && failedAt === "provision" ? 3 : 2;

  return (
    <section
      id="checkout-agent"
      className="animate-fade-up mt-4 overflow-hidden rounded-2xl border-2 border-accent/60 bg-surface shadow-sm"
    >
      <div className="border-b border-(--border) p-5 sm:p-7">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">
          Checkout agent · PayPal Agent Toolkit · sandbox
        </span>
        <h3 className="mt-1.5 font-serif text-2xl font-semibold tracking-tight">
          Don&apos;t just grade it. Ship the fix.
        </h3>
        <p className="text-pretty mt-1.5 max-w-xl text-sm leading-6 text-muted">
          The agent turns the pricing it just graded into a real PayPal catalog. You approve every plan
          before it touches PayPal, then you get a working checkout and the code to ship it.
        </p>
        <Stepper stage={stage} phase={phase} />
      </div>

      <div className="p-5 sm:p-7">
        <SandboxBanner status={status} />

        {phase === "idle" && (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] lg:items-start">
            <FoundPricing result={result} title="Before · what buyers see today" />
            <div className="rounded-xl border border-(--border) bg-background/60 p-5">
              <div className="font-serif text-lg font-semibold">
                {hasPaidTiers ? "Turn these prices into a PayPal checkout" : "No paid plans to turn into a checkout"}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                {hasPaidTiers
                  ? "The agent maps each paid tier to a PayPal product and plan, suggests an annual option if you lack one, and keeps your exact prices. Nothing is created until you approve."
                  : "We couldn't read paid tiers on this page. Try your pricing page URL, or draft anyway and we'll show what we found."}
              </p>
              <button
                onClick={draft}
                className="mt-4 w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition-transform hover:scale-[1.02] active:scale-95 sm:w-auto"
              >
                Draft my PayPal catalog →
              </button>
            </div>
          </div>
        )}

        {phase === "proposing" && (
          <Working text="Reading your plans and drafting a PayPal catalog…" />
        )}

        {phase === "error" && (
          <div role="alert" className="rounded-xl border border-grade-poor/45 bg-grade-poor/10 p-4 text-sm">
            <div className="font-semibold text-grade-poor">
              {failedAt === "draft" ? "The draft didn't come through." : "PayPal provisioning stopped."}
            </div>
            <p className="mt-1 text-foreground/85">{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={failedAt === "draft" || !proposal ? draft : approve}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink"
              >
                Try again
              </button>
              {proposal && (
                <button
                  onClick={() => setPhase("proposed")}
                  className="rounded-lg border border-(--border-strong) px-4 py-2 text-xs font-medium"
                >
                  Back to the draft
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "proposed" && proposal && (
          <ProposalView
            proposal={proposal}
            excluded={excluded}
            onToggle={toggle}
            onApprove={approve}
            onCancel={() => setPhase("idle")}
            canProvision={canProvision}
            dryRun={Boolean(status?.dryRun)}
          />
        )}

        {phase === "provisioning" && proposal && (
          <PendingTimeline proposal={{ ...proposal, plans: approvedPlans }} startedAt={startedAt} />
        )}

        {phase === "done" && done && (
          <ProvisionedView done={done} result={result} onCopy={copySnippet} copied={copied} />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Stepper({ stage, phase }: { stage: number; phase: Phase }) {
  const steps = [
    { n: 1, title: "Grade", detail: "Pricing read and scored" },
    { n: 2, title: "Approve", detail: "Review the agent's catalog" },
    { n: 3, title: "Live checkout", detail: "Real PayPal plans and buttons" },
  ];
  return (
    <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Checkout agent progress">
      {steps.map((s) => {
        const complete = s.n < stage || (s.n === 3 && phase === "done");
        const current = s.n === stage && !complete;
        return (
          <li
            key={s.n}
            aria-current={current ? "step" : undefined}
            className={`rounded-xl border px-3 py-2.5 transition-colors ${
              complete
                ? "border-grade-excellent/40 bg-grade-excellent/10"
                : current
                  ? "border-accent bg-accent/8"
                  : "border-(--border) bg-background/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${
                  complete
                    ? "bg-grade-excellent text-white"
                    : current
                      ? "bg-accent text-accent-ink"
                      : "border border-(--border-strong) text-muted"
                }`}
              >
                {complete ? "✓" : s.n}
              </span>
              <span className="text-sm font-semibold">{s.title}</span>
            </div>
            <div className="mt-0.5 hidden text-xs text-muted sm:block">{s.detail}</div>
          </li>
        );
      })}
    </ol>
  );
}

function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 py-6 text-sm text-muted" role="status">
      <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-dashed border-accent" />
      {text}
    </div>
  );
}

function FoundPricing({ result, title }: { result: AnalysisResult; title: string }) {
  const c = result.checkout;
  const host = (() => {
    try {
      return new URL(c.pricingUrl ?? result.finalUrl).host;
    } catch {
      return result.finalUrl;
    }
  })();
  return (
    <div>
      <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">{title}</h4>
      <div className="mt-2 rounded-xl border border-dashed border-(--border-strong) bg-background/60 p-4">
        <div className="font-mono text-[11px] text-muted">{host}</div>
        {c.tiers.length ? (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {c.tiers.slice(0, 4).map((t) => (
              <li key={t.id} className="rounded-lg border border-(--border) bg-surface p-3">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="font-mono text-sm">
                  {t.isCustom ? "Custom" : t.isFree || !t.amount ? "Free" : `$${t.amount}`}
                  {!t.isCustom && !t.isFree && t.amount ? (
                    <span className="text-muted">{FOUND_INTERVAL[t.interval] ?? ""}</span>
                  ) : null}
                </div>
                <div className="mt-2 rounded-md border border-(--border-strong) px-2 py-1 text-center text-xs text-muted">
                  {t.ctaText ?? (t.isCustom ? "Contact sales" : "No button")}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No pricing tiers were readable on this page.</p>
        )}
        <p className="mt-3 text-xs text-grade-poor">
          {c.providers.length
            ? `Payments: ${c.providers.join(", ")}`
            : "No payment button: buyers leave the page to pay."}
        </p>
      </div>
    </div>
  );
}

function ProposalView({
  proposal,
  excluded,
  onToggle,
  onApprove,
  onCancel,
  canProvision,
  dryRun,
}: {
  proposal: CatalogProposal;
  excluded: Set<string>;
  onToggle: (id: string) => void;
  onApprove: () => void;
  onCancel: () => void;
  canProvision: boolean;
  dryRun: boolean;
}) {
  const chosen = proposal.plans.length - excluded.size;
  return (
    <div className="animate-fade-up">
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

      {proposal.plans.length === 0 ? (
        <p className="mt-4 rounded-xl border border-(--border) bg-background/60 p-4 text-sm text-muted">
          The agent found no paid plans to create. Free and contact-sales tiers stay off PayPal.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-(--border) rounded-xl border border-(--border) bg-background/60">
          {proposal.plans.map((p) => {
            const on = !excluded.has(p.tierId);
            return (
              <li key={p.tierId}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(p.tierId)}
                    aria-label={`Include ${p.name}`}
                    className="h-4 w-4 accent-(--accent)"
                  />
                  <div className={`min-w-0 flex-1 ${on ? "" : "opacity-45 line-through"}`}>
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
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-bold">
                      ${p.amount}
                      <span className="font-normal text-muted">{INTERVAL_LABEL[p.interval]}</span>
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      {p.interval === "ONE_TIME" ? "Order" : "Plan"}
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {proposal.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {proposal.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onApprove}
          disabled={!canProvision || chosen === 0}
          className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition-transform enabled:hover:scale-[1.02] enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {dryRun ? "Approve & simulate (dry run)" : `Approve ${chosen} plan${chosen === 1 ? "" : "s"} & create in PayPal`}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-(--border-strong) px-5 py-3 text-sm font-medium transition-colors hover:border-accent"
        >
          Cancel
        </button>
        {!canProvision && (
          <span className="text-xs text-muted">Connect a PayPal sandbox app to create these plans.</span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Guardrail: the agent can only create exactly what you approve. Prices it tries to change are rejected.
      </p>
    </div>
  );
}

function plannedCalls(proposal: CatalogProposal): { tool: string; label: string }[] {
  return [
    { tool: "create_product", label: proposal.product.name },
    ...proposal.plans.map((p) => ({
      tool: p.interval === "ONE_TIME" ? "create_order" : "create_subscription_plan",
      label: `${p.name} · $${p.amount}${INTERVAL_LABEL[p.interval]}`,
    })),
  ];
}

function PendingTimeline({ proposal, startedAt }: { proposal: CatalogProposal; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return (
    <div role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Agent is calling PayPal</h4>
        <span className="font-mono text-[11px] text-muted">{elapsed.toFixed(1)}s</span>
      </div>
      <ol className="relative mt-3 space-y-2 border-l border-dashed border-(--border-strong) pl-5">
        {plannedCalls(proposal).map((c, i) => (
          <li key={i} className="relative">
            <span className="absolute -left-[27px] top-1.5 h-3 w-3 animate-spin-slow rounded-full border-2 border-dashed border-accent bg-surface" />
            <div className="rounded-lg border border-(--border) bg-background/60 px-3 py-2 text-xs">
              <div className="font-mono text-foreground/80">{c.tool}</div>
              <div className="text-muted">{c.label}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function stepLabel(s: ProvisionStep): string {
  const a = s.args as Record<string, unknown>;
  if (s.tool === "create_subscription_plan") {
    const cycles = Array.isArray(a.billing_cycles) ? (a.billing_cycles as Record<string, unknown>[]) : [];
    const regular = cycles.find((c) => c.tenure_type === "REGULAR") as
      | { frequency?: { interval_unit?: string }; pricing_scheme?: { fixed_price?: { value?: string } } }
      | undefined;
    const price = regular?.pricing_scheme?.fixed_price?.value;
    const unit = regular?.frequency?.interval_unit?.toLowerCase();
    return [a.name, price ? `$${price}${unit ? `/${unit}` : ""}` : null].filter(Boolean).join(" · ");
  }
  if (s.tool === "create_order") {
    const items = Array.isArray(a.items) ? (a.items as { name?: string; itemCost?: number | string }[]) : [];
    return [items[0]?.name, items[0]?.itemCost ? `$${items[0].itemCost}` : null].filter(Boolean).join(" · ");
  }
  return typeof a.name === "string" ? a.name : "";
}

function Timeline({ steps }: { steps: ProvisionStep[] }) {
  return (
    <ol className="relative mt-3 space-y-2 border-l border-(--border-strong) pl-5">
      {steps.map((s, i) => {
        const color =
          s.status === "ok" ? "var(--grade-excellent)" : s.status === "rejected" ? "var(--grade-mixed)" : "var(--grade-poor)";
        return (
          <li key={i} className="animate-fade-up relative" style={{ animationDelay: `${i * 90}ms` }}>
            <span
              className="absolute -left-[27px] top-2 flex h-3 w-3 items-center justify-center rounded-full"
              style={{ background: color }}
            />
            <div className="rounded-lg border border-(--border) bg-background/60 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono font-semibold">{s.tool}</span>
                <span
                  className={`rounded-full px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.1em] ${
                    s.by === "agent" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted"
                  }`}
                >
                  {s.by === "agent" ? "AI agent" : "rule engine"}
                </span>
                {s.status !== "ok" && (
                  <span className="font-mono text-[10px] uppercase" style={{ color }}>
                    {s.status === "rejected" ? "blocked by guard" : "failed"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-foreground/80">{stepLabel(s)}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                {s.status === "ok" ? s.resultId : s.message}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProvisionedView({
  done,
  result,
  onCopy,
  copied,
}: {
  done: Provisioned;
  result: AnalysisResult;
  onCopy: () => void;
  copied: boolean;
}) {
  const r = done.result;
  const okCalls = r.steps.filter((s) => s.status === "ok");
  const byAgent = okCalls.filter((s) => s.by === "agent").length;
  const previewSrc = `/preview?t=${encodeURIComponent(done.previewToken)}`;
  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
            r.complete ? "bg-grade-excellent/15 text-grade-excellent" : "bg-grade-mixed/15 text-grade-mixed"
          }`}
        >
          {r.complete ? "Live in PayPal sandbox" : "Partially provisioned"}
          {r.simulated ? " · simulated" : ""}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {okCalls.length} toolkit calls · {byAgent} by the AI agent · {done.seconds.toFixed(1)}s
        </span>
      </div>
      <p className="mt-2 font-serif text-lg">{r.summary}</p>
      {r.agentError && byAgent < okCalls.length && (
        <p className="mt-1 text-xs text-muted">
          The AI model paused (rate limit), so the deterministic rule engine finished the remaining calls with the same
          guardrails.
        </p>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            Agent timeline · PayPal Agent Toolkit
          </h4>
          <Timeline steps={r.steps} />
          {r.productId && (
            <p className="mt-3 font-mono text-[11px] text-muted">Product {r.productId}</p>
          )}
        </div>

        <div>
          <h4 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
            After · your pricing with PayPal
          </h4>
          <iframe
            title="Pricing preview with PayPal buttons"
            src={previewSrc}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            className="mt-2 h-[560px] w-full rounded-xl border border-(--border-strong) bg-white sm:h-[480px]"
          />
          <a
            href={previewSrc}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-block font-mono text-[11px] text-accent hover:opacity-70"
          >
            Open the live checkout in a new tab ↗
          </a>
        </div>
      </div>

      <details className="mt-6 rounded-xl border border-(--border) bg-background/60 p-4">
        <summary className="cursor-pointer text-sm font-semibold">Compare with the original pricing</summary>
        <div className="mt-3">
          <FoundPricing result={result} title="Before · what buyers saw" />
        </div>
      </details>

      <div className="mt-6">
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

      <FixInvoice result={result} />
    </div>
  );
}

function FixInvoice({ result }: { result: AnalysisResult }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "ok"; id: string } | { kind: "soon" } | { kind: "error"; text: string }
  >({ kind: "idle" });
  const fixes = result.dimensions
    .flatMap((d) => d.findings.filter((f) => f.type === "fix").map((f) => f.text))
    .slice(0, 3)
    .map((text) => ({ title: text.split(/[.:]/)[0].slice(0, 120), hours: 2 }));
  if (!fixes.length) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/agent/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site: new URL(result.finalUrl).host, email, fixes }),
      });
      const data = await res.json();
      if (res.status === 502 && /Invoicing permission/.test(data?.error ?? "")) return setState({ kind: "soon" });
      if (!res.ok) throw new Error(data?.error ?? "Couldn't draft the invoice.");
      setState({ kind: "ok", id: data.invoiceId ?? "draft created" });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : "Couldn't draft the invoice." });
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-(--border) bg-background/60 p-4">
      <div className="text-sm font-semibold">Hiring someone for the copy fixes?</div>
      <p className="mt-1 text-xs leading-5 text-muted">
        The agent scopes your top {fixes.length} fixes into a <span className="font-semibold">draft</span> PayPal
        invoice (2h each) with the toolkit&apos;s <span className="font-mono">create_invoice</span>. Nothing is sent.
      </p>
      {state.kind === "ok" ? (
        <p className="mt-3 font-mono text-xs text-grade-excellent">Draft invoice {state.id} created in PayPal sandbox.</p>
      ) : state.kind === "soon" ? (
        <p className="mt-3 text-xs text-muted">Invoice drafts are coming soon for this PayPal app.</p>
      ) : (
        <form onSubmit={send} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@example.com"
            aria-label="Invoice recipient email"
            className="min-w-0 flex-1 rounded-lg border border-(--border-strong) bg-surface px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={state.kind === "busy"}
            className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent disabled:opacity-50"
          >
            {state.kind === "busy" ? "Drafting…" : "Draft PayPal invoice"}
          </button>
        </form>
      )}
      {state.kind === "error" && <p className="mt-2 text-xs text-grade-poor">{state.text}</p>}
    </div>
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
