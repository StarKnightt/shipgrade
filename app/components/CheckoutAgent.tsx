"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  CheckCircle,
  Copy,
  Receipt,
  ShieldCheck,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
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
  autoDraft = false,
}: {
  result: AnalysisResult;
  status: PayPalStatus | null;
  autoDraft?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [failedAt, setFailedAt] = useState<"draft" | "provision">("draft");
  const [proposal, setProposal] = useState<CatalogProposal | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Provisioned | null>(null);
  const [liveSteps, setLiveSteps] = useState<ProvisionStep[]>([]);
  const [turn, setTurn] = useState(0);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [startedAt, setStartedAt] = useState(0);

  const canProvision = Boolean(status && (status.configured || status.dryRun));
  const paidTiers = result.checkout.tiers.filter((t) => !t.isFree && !t.isCustom && t.amount);
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
      if (!res.ok) throw new Error(data?.error ?? "Couldn't draft a catalog. Try again.");
      setProposal(data.proposal);
      setExcluded(new Set());
      setPhase("proposed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setFailedAt("draft");
      setPhase("error");
    }
  }

  const autoDrafted = useRef(false);
  useEffect(() => {
    if (!autoDraft || autoDrafted.current) return;
    autoDrafted.current = true;
    const t = setTimeout(draft, 400);
    return () => clearTimeout(t);
    // draft is stable for the lifetime of this result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraft]);

  async function approve() {
    if (!proposal || !approvedPlans.length) return;
    const started = Date.now();
    setStartedAt(started);
    setLiveSteps([]);
    setTurn(0);
    setPhase("provisioning");
    setError("");
    try {
      const res = await fetch("/api/agent/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, stream: true, proposal: { ...proposal, plans: approvedPlans } }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Provisioning failed. Try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done: eof } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "thinking") setTurn(event.turn);
          else if (event.type === "step") setLiveSteps((prev) => [...prev, event.step]);
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "done") {
            finished = true;
            setDone({ ...event, seconds: (Date.now() - started) / 1000 });
            setPhase("done");
          }
        }
        if (eof) break;
      }
      if (!finished) throw new Error("The connection closed before PayPal finished. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
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

  const stage = phase === "done" || phase === "provisioning" || (phase === "error" && failedAt === "provision") ? 3 : 2;
  const working = phase === "proposing" || phase === "provisioning";

  return (
    <section
      id="checkout-agent"
      aria-labelledby="agent-title"
      className="animate-fade-up mt-5 scroll-mt-20 overflow-hidden rounded-2xl border-2 border-accent/55 bg-surface shadow-[0_24px_50px_-34px_rgba(207,58,38,0.55)]"
    >
      <div className="border-b border-(--border) bg-[linear-gradient(180deg,rgba(207,58,38,0.05),transparent)] p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Checkout agent</span>
          <span className="text-xs text-muted">PayPal Agent Toolkit, sandbox</span>
        </div>
        <h2 id="agent-title" className="mt-1.5 font-serif text-[1.7rem] font-semibold leading-tight tracking-tight">
          Don&apos;t just grade it. Ship the fix.
        </h2>
        <p className="mt-1.5 max-w-2xl text-pretty text-sm leading-6 text-muted">
          The agent turns the pricing it just graded into a real PayPal catalog. You approve every plan before it
          touches PayPal, then you get a working checkout and the code to ship it.
        </p>
        <Stepper stage={stage} phase={phase} working={working} />
      </div>

      <div className="p-5 sm:p-7">
        <SandboxBanner status={status} />

        {phase === "idle" && (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr] lg:items-start">
            <FoundPricing result={result} title="Before: what buyers see today" annotate />
            <div className="rounded-xl border border-(--border) bg-background/60 p-5 lg:mt-7">
              <h3 className="font-serif text-xl font-semibold leading-snug">
                {paidTiers.length
                  ? `Turn ${paidTiers.length} paid tier${paidTiers.length === 1 ? "" : "s"} into a PayPal checkout`
                  : "No paid plans to turn into a checkout"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {paidTiers.length
                  ? "The agent maps each paid tier to a PayPal product and plan, suggests an annual option if you lack one, and keeps your exact prices."
                  : "We couldn't read paid tiers on this page. Try your pricing page URL, or draft anyway to see what the agent finds."}
              </p>
              <button
                onClick={draft}
                className="press group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-[0_6px_18px_-8px_rgba(207,58,38,0.7)] hover:bg-[#bb3220] sm:w-auto"
              >
                Draft my PayPal catalog
                <ArrowRight aria-hidden size={16} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
              </button>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck aria-hidden size={14} weight="duotone" className="text-grade-excellent" />
                Nothing is created in PayPal until you approve.
              </p>
            </div>
          </div>
        )}

        {phase === "proposing" && <ProposalSkeleton tiers={paidTiers.length} />}

        {phase === "error" && (
          <div role="alert" className="rounded-xl border border-grade-poor/40 bg-grade-poor/8 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-grade-poor">
              <WarningCircle aria-hidden size={18} weight="fill" />
              {failedAt === "draft" ? "The draft didn't come through." : "PayPal provisioning stopped."}
            </div>
            <p className="mt-1 text-foreground/85">{error}</p>
            {failedAt === "provision" && liveSteps.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                {liveSteps.filter((s) => s.status === "ok").length} calls finished before it stopped. Trying again
                creates a fresh catalog.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={failedAt === "draft" || !proposal ? draft : approve}
                className="press rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:bg-[#bb3220]"
              >
                Try again
              </button>
              {proposal && (
                <button
                  onClick={() => setPhase("proposed")}
                  className="press rounded-lg border border-(--border-strong) px-4 py-2 text-xs font-medium hover:border-accent"
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

        {(phase === "provisioning" || phase === "done") && proposal && (
          <Ledger
            plans={approvedPlans}
            productName={proposal.product.name}
            steps={phase === "done" && done ? done.result.steps : liveSteps}
            running={phase === "provisioning"}
            turn={turn}
            startedAt={startedAt}
            seconds={done?.seconds}
          />
        )}

        {phase === "done" && done && (
          <ProvisionedView done={done} result={result} onCopy={copySnippet} copied={copied} />
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Stepper({ stage, phase, working }: { stage: number; phase: Phase; working: boolean }) {
  const steps = [
    { n: 1, title: "Grade", detail: "Pricing read and scored" },
    { n: 2, title: "Approve", detail: "Review the agent's catalog" },
    { n: 3, title: "Live checkout", detail: "Real PayPal plans and buttons" },
  ];
  return (
    <ol className="mt-6 grid grid-cols-3 gap-2 sm:gap-3" aria-label="Checkout agent progress">
      {steps.map((s, i) => {
        const complete = s.n < stage || (s.n === 3 && phase === "done");
        const current = s.n === stage && !complete;
        return (
          <li key={s.n} aria-current={current ? "step" : undefined}>
            <div className="flex items-start gap-2.5">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[11px] font-bold transition-colors duration-300 ${
                  complete
                    ? "bg-grade-excellent text-white"
                    : current
                      ? `bg-accent text-accent-ink ${working ? "live-ring" : ""}`
                      : "border border-(--border-strong) bg-surface text-muted"
                }`}
              >
                {complete ? <Check aria-hidden size={12} weight="bold" /> : s.n}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${current || complete ? "" : "text-muted"}`}>{s.title}</span>
                <span className="mt-0.5 hidden text-xs text-muted sm:block">{s.detail}</span>
                <span className="sr-only">{complete ? "(done)" : current ? "(current)" : "(next)"}</span>
              </span>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`mt-3 hidden h-[2px] min-w-3 flex-1 rounded-full sm:block transition-colors duration-500 ${
                    complete ? "bg-grade-excellent" : "bg-(--border-strong)"
                  }`}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FoundPricing({ result, title, annotate = false }: { result: AnalysisResult; title: string; annotate?: boolean }) {
  const c = result.checkout;
  const host = (() => {
    try {
      return new URL(c.pricingUrl ?? result.finalUrl).host.replace(/^www\./, "");
    } catch {
      return result.finalUrl;
    }
  })();
  const ctaHint = c.tiers.find((t) => t.ctaText && !t.isCustom)?.ctaText;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="relative mt-2 rounded-xl border border-dashed border-(--border-strong) bg-background/60 p-4">
        <div className="font-mono text-[11px] text-muted">{host}</div>
        {c.tiers.length ? (
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {c.tiers.slice(0, 4).map((t) => (
              <li key={t.id} className="rounded-lg border border-(--border) bg-surface p-3">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className="tabular font-mono text-sm">
                  {t.isCustom ? "Custom" : t.isFree || !t.amount ? "Free" : `$${t.amount}`}
                  {!t.isCustom && !t.isFree && t.amount ? (
                    <span className="text-muted">{FOUND_INTERVAL[t.interval] ?? ""}</span>
                  ) : null}
                </div>
                <div className="mt-2 truncate rounded-md border border-(--border-strong) px-2 py-1 text-center text-xs text-muted">
                  {t.ctaText ?? (t.isCustom ? "Contact sales" : "No button")}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No pricing tiers were readable on this page.</p>
        )}
        {annotate ? (
          <p className="mt-4 -rotate-[1.2deg] font-serif text-[1.05rem] italic leading-6 text-accent">
            {c.providers.length
              ? `Payments run through ${c.providers.join(", ")}.${c.providers.includes("PayPal") ? "" : " No PayPal, no Pay Later."}`
              : `No way to pay on this page. ${ctaHint ? `“${ctaHint}” sends buyers away first.` : "Buyers have to leave to pay."}`}
          </p>
        ) : (
          <p className="mt-3 text-xs text-grade-poor">
            {c.providers.length ? `Payments: ${c.providers.join(", ")}` : "No payment button: buyers leave the page to pay."}
          </p>
        )}
      </div>
    </div>
  );
}

function ProposalSkeleton({ tiers }: { tiers: number }) {
  return (
    <div role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="live-ring h-2 w-2 rounded-full bg-accent" />
        Reading {tiers ? `${tiers} paid tier${tiers === 1 ? "" : "s"}` : "your pricing"} and drafting a PayPal catalog…
      </p>
      <div className="mt-4 space-y-2">
        <div className="skeleton h-6 w-1/3" />
        <div className="skeleton h-12 w-full" />
      </div>
      <div className="mt-4 divide-y divide-(--border) rounded-xl border border-(--border) bg-background/60">
        {Array.from({ length: Math.max(2, Math.min(tiers + 1, 5)) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className="skeleton h-5 w-5 rounded" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-1/4" />
              <div className="skeleton h-3 w-2/3" />
            </div>
            <div className="skeleton h-5 w-16" />
          </div>
        ))}
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
        <h3 className="font-serif text-xl font-semibold">
          {proposal.product.name}
          <span className="ml-2 font-sans text-xs font-normal text-muted">PayPal catalog product</span>
        </h3>
        <span className="rounded-md border border-(--border-strong) px-2 py-0.5 text-xs text-muted">
          {proposal.source === "ai" ? "AI-refined draft" : "Rule-engine draft"}
        </span>
      </div>
      {proposal.rationale && (
        <p className="mt-2 text-pretty border-l-2 border-accent pl-3.5 font-serif text-[0.95rem] italic leading-7 text-foreground/85">
          {proposal.rationale}
        </p>
      )}

      {proposal.plans.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-(--border-strong) bg-background/60 p-5 text-sm">
          <p className="font-semibold">No paid plans to create.</p>
          <p className="mt-1 text-muted">
            Free and contact-sales tiers stay off PayPal. Grade your pricing page directly if your paid plans live
            there.
          </p>
        </div>
      ) : (
        <fieldset className="mt-4">
          <legend className="sr-only">Plans to create in PayPal</legend>
          <ul className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-background/60">
            {proposal.plans.map((p, i) => {
              const on = !excluded.has(p.tierId);
              return (
                <li key={p.tierId} className="rise" style={{ "--i": i } as React.CSSProperties}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-surface has-focus-visible:bg-surface">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(p.tierId)}
                      className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-(--accent)"
                    />
                    <span className={`min-w-0 flex-1 transition-opacity duration-200 ${on ? "" : "opacity-45 line-through"}`}>
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {p.name}
                        {p.suggested && (
                          <span className="rounded-md bg-accent/10 px-1.5 py-px text-[11px] font-medium text-accent">
                            Suggested
                          </span>
                        )}
                        {p.trialDays > 0 && (
                          <span className="rounded-md border border-(--border-strong) px-1.5 py-px text-[11px] text-muted">
                            {p.trialDays}-day trial
                          </span>
                        )}
                      </span>
                      {p.description && <span className="mt-0.5 block text-xs leading-5 text-muted">{p.description}</span>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block font-mono text-sm font-bold">
                        ${p.amount}
                        <span className="font-normal text-muted">{INTERVAL_LABEL[p.interval]}</span>
                      </span>
                      <span className="block text-[11px] text-muted">{p.interval === "ONE_TIME" ? "Order" : "Plan"}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {proposal.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs leading-5 text-muted">
          {proposal.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span aria-hidden className="text-accent">
                <ArrowRight size={11} weight="bold" className="mt-1" />
              </span>
              {n}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          onClick={onApprove}
          disabled={!canProvision || chosen === 0}
          className="press group inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-[0_6px_18px_-8px_rgba(207,58,38,0.7)] enabled:hover:bg-[#bb3220] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {dryRun ? "Approve & simulate (dry run)" : `Approve ${chosen} plan${chosen === 1 ? "" : "s"} & create in PayPal`}
          <ArrowRight aria-hidden size={16} weight="bold" className="transition-transform duration-200 group-enabled:group-hover:translate-x-0.5" />
        </button>
        <button onClick={onCancel} className="press rounded-xl px-4 py-3 text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
        {!canProvision && <span className="text-xs text-muted">Connect a PayPal sandbox app to create these plans.</span>}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs leading-5 text-muted">
        <ShieldCheck aria-hidden size={14} weight="duotone" className="mt-0.5 shrink-0 text-grade-excellent" />
        Guardrail: the agent can only create exactly what you approve. Any call with a different price is blocked
        before it reaches PayPal.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The ledger: planned toolkit calls that fill in live as PayPal answers.

interface PlannedCall {
  tool: string;
  name: string;
  label: string;
}

function plannedCalls(productName: string, plans: ProposedPlan[]): PlannedCall[] {
  return [
    { tool: "create_product", name: productName, label: productName },
    ...plans.map((p) => ({
      tool: p.interval === "ONE_TIME" ? "create_order" : "create_subscription_plan",
      name: p.name,
      label: `${p.name}, $${p.amount}${INTERVAL_LABEL[p.interval]}`,
    })),
  ];
}

function stepName(s: ProvisionStep): string | undefined {
  const a = s.args as Record<string, unknown>;
  if (s.tool === "create_order") {
    const items = Array.isArray(a.items) ? (a.items as { name?: string }[]) : [];
    return items[0]?.name;
  }
  return typeof a.name === "string" ? a.name : undefined;
}

function matchSteps(planned: PlannedCall[], steps: ProvisionStep[]) {
  const pool = steps.filter((s) => s.status === "ok");
  const rows = planned.map((p) => {
    let idx = pool.findIndex((s) => s.tool === p.tool && stepName(s) === p.name);
    if (idx < 0) idx = pool.findIndex((s) => s.tool === p.tool && p.tool === "create_product");
    const step = idx >= 0 ? pool.splice(idx, 1)[0] : undefined;
    return { planned: p, step };
  });
  const extras = steps.filter((s) => s.status !== "ok");
  return { rows, extras };
}

function Ledger({
  plans,
  productName,
  steps,
  running,
  turn,
  startedAt,
  seconds,
}: {
  plans: ProposedPlan[];
  productName: string;
  steps: ProvisionStep[];
  running: boolean;
  turn: number;
  startedAt: number;
  seconds?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  const elapsed = seconds ?? Math.max(0, (now - startedAt) / 1000);
  const { rows, extras } = matchSteps(plannedCalls(productName, plans), steps);
  const okCount = rows.filter((r) => r.step).length;
  const byAgent = steps.filter((s) => s.status === "ok" && s.by === "agent").length;
  const firstOpen = rows.findIndex((r) => !r.step);

  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-(--border-strong) bg-background/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border) px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {running ? (
            <span className="live-ring h-2 w-2 rounded-full bg-accent" />
          ) : (
            <CheckCircle aria-hidden size={16} weight="fill" className="text-grade-excellent" />
          )}
          PayPal Agent Toolkit calls
        </h3>
        <span className="tabular font-mono text-xs text-muted">
          {running
            ? `${turn ? `Agent turn ${turn}` : "Starting"} · ${okCount}/${rows.length} · ${elapsed.toFixed(1)}s`
            : `${okCount} calls · ${byAgent} by the AI agent · ${elapsed.toFixed(1)}s`}
        </span>
      </div>
      <ol className="divide-y divide-(--border)">
        {rows.map(({ planned, step }, i) => {
          const state = step ? "done" : running && i === firstOpen ? "now" : running ? "queued" : "missing";
          return (
            <li key={`${planned.tool}-${planned.name}-${i}`} className="grid grid-cols-[1.25rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[1.25rem_1fr_auto] sm:items-center">
              <span className="mt-0.5 grid h-5 w-5 place-items-center sm:mt-0">
                {state === "done" ? (
                  <CheckCircle aria-hidden size={20} weight="fill" className="ink-in text-grade-excellent" />
                ) : state === "now" ? (
                  <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-accent border-t-transparent" />
                ) : state === "missing" ? (
                  <XCircle aria-hidden size={20} weight="fill" className="text-grade-poor" />
                ) : (
                  <span className="h-3.5 w-3.5 rounded-full border border-dashed border-(--border-strong)" />
                )}
              </span>
              <div className={`min-w-0 ${state === "queued" ? "opacity-55" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <code className="font-mono text-[13px] font-semibold">{planned.tool}</code>
                  {step && (
                    <span
                      className={`ink-in rounded-md px-1.5 py-px text-[11px] font-medium ${
                        step.by === "agent" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {step.by === "agent" ? "AI agent" : "Rule engine"}
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">{planned.label}</div>
              </div>
              <div className="col-start-2 min-w-0 sm:col-start-3 sm:text-right">
                {step ? (
                  <code className="ink-in block truncate font-mono text-xs text-foreground/80" title={step.resultId}>
                    {step.resultId}
                  </code>
                ) : state === "now" ? (
                  <span className="font-mono text-xs text-accent">calling PayPal…</span>
                ) : state === "queued" ? (
                  <span className="font-mono text-xs text-muted">queued</span>
                ) : (
                  <span className="font-mono text-xs text-grade-poor">not created</span>
                )}
              </div>
            </li>
          );
        })}
        {extras.map((s, i) => (
          <li key={`extra-${i}`} className="grid grid-cols-[1.25rem_1fr] gap-3 bg-grade-mixed/6 px-4 py-2.5">
            <WarningCircle aria-hidden size={20} weight="fill" className={s.status === "rejected" ? "text-grade-mixed" : "text-grade-poor"} />
            <div className="min-w-0 text-xs">
              <span className="font-mono font-semibold">{s.tool}</span>{" "}
              <span className="font-medium">{s.status === "rejected" ? "blocked by the guard" : "failed"}</span>
              <span className="mt-0.5 block truncate text-muted" title={s.message}>
                {s.message}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FitFrame({ src, title }: { src: string; title: string }) {
  const BASE_WIDTH = 820;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(640);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "shipgrade:preview-height" && typeof e.data.height === "number") {
        setContentHeight(Math.min(Math.max(e.data.height, 320), 2400));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const scaled = width >= 480 && width < BASE_WIDTH;
  const scale = scaled ? width / BASE_WIDTH : 1;
  return (
    <div ref={wrap} className="relative overflow-hidden rounded-xl border border-(--border-strong) bg-white" style={{ height: contentHeight * scale }}>
      <iframe
        title={title}
        src={src}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
        className="absolute top-0 left-0 origin-top-left border-0"
        style={{
          width: scaled ? BASE_WIDTH : "100%",
          height: contentHeight,
          transform: scaled ? `scale(${scale})` : undefined,
        }}
      />
    </div>
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
    <div className="animate-fade-up mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`animate-stamp inline-flex -rotate-2 items-center gap-1.5 rounded-md border-2 px-2.5 py-1 font-mono text-xs font-bold uppercase tracking-[0.12em] ${
            r.complete ? "border-grade-excellent text-grade-excellent" : "border-grade-mixed text-grade-mixed"
          }`}
        >
          {r.complete ? "Live in PayPal sandbox" : "Partially provisioned"}
          {r.simulated ? ", simulated" : ""}
        </span>
        <p className="font-serif text-lg">{r.summary}</p>
      </div>
      {r.agentError && byAgent < okCalls.length && (
        <p className="mt-2 text-xs leading-5 text-muted">
          The AI model paused (rate limit), so the rule engine finished the remaining calls with the same guardrails.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
        <FoundPricing result={result} title="Before: what buyers saw" annotate />
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">After: the same pricing, with PayPal</h3>
            <a
              href={previewSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline"
            >
              Open the live checkout in a new tab
              <ArrowSquareOut aria-hidden size={13} weight="bold" />
            </a>
          </div>
          <div className="relative mt-2">
            <FitFrame src={previewSrc} title="Pricing preview with PayPal buttons" />
            <span
              aria-hidden
              className="animate-stamp pointer-events-none absolute -top-3 -right-2 grid h-16 w-16 place-items-center rounded-full border-[3px] border-grade-excellent bg-surface/95 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-grade-excellent shadow-sm"
              style={{ animationDelay: "350ms" }}
            >
              Live
            </span>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Drop-in code for your site (PayPal JS SDK v6)</h3>
          <button
            onClick={onCopy}
            aria-live="polite"
            className="press inline-flex items-center gap-1.5 rounded-lg border border-(--border-strong) px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            {copied ? <Check aria-hidden size={13} weight="bold" /> : <Copy aria-hidden size={13} />}
            {copied ? "Copied" : "Copy code"}
          </button>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-(--border) bg-foreground p-4 font-mono text-[12px] leading-5 text-background">
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
      if (!res.ok) throw new Error(data?.error ?? "Couldn't draft the invoice. Check the email and try again.");
      setState({ kind: "ok", id: data.invoiceId ?? "draft created" });
    } catch (err) {
      setState({ kind: "error", text: err instanceof Error ? err.message : "Couldn't draft the invoice." });
    }
  }

  return (
    <div className="mt-8 grid gap-4 rounded-xl border border-(--border) bg-background/60 p-5 sm:grid-cols-[auto_1fr]">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-accent">
        <Receipt aria-hidden size={20} weight="duotone" />
      </span>
      <div>
        <h3 className="text-sm font-semibold">Hiring someone for the copy fixes?</h3>
        <p className="mt-1 text-xs leading-5 text-muted">
          The agent scopes your top {fixes.length} fixes into a <span className="font-semibold">draft</span> PayPal
          invoice (2 hours each) with the toolkit&apos;s <code className="font-mono">create_invoice</code>. Nothing is
          sent.
        </p>
        {state.kind === "ok" ? (
          <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-grade-excellent">
            <CheckCircle aria-hidden size={15} weight="fill" />
            Draft invoice <code className="font-mono">{state.id}</code> created in the PayPal sandbox.
          </p>
        ) : state.kind === "soon" ? (
          <p className="mt-3 text-xs text-muted">Invoice drafts are coming soon for this PayPal app.</p>
        ) : (
          <form onSubmit={send} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label htmlFor="invoice-email" className="sr-only">
              Invoice recipient email
            </label>
            <input
              id="invoice-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com…"
              aria-label="Invoice recipient email"
              aria-invalid={state.kind === "error"}
              className="min-w-0 flex-1 rounded-lg border border-(--border-strong) bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus-visible:border-accent focus-visible:ring-4 focus-visible:ring-accent/15"
            />
            <button
              type="submit"
              disabled={state.kind === "busy"}
              className="press inline-flex items-center justify-center gap-2 rounded-lg border border-accent px-4 py-2.5 text-sm font-semibold text-accent hover:bg-accent/6 disabled:opacity-50"
            >
              {state.kind === "busy" && (
                <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-accent border-t-transparent" />
              )}
              {state.kind === "busy" ? "Drafting…" : "Draft PayPal invoice"}
            </button>
          </form>
        )}
        {state.kind === "error" && (
          <p role="alert" className="mt-2 text-xs text-grade-poor">
            {state.text}
          </p>
        )}
      </div>
    </div>
  );
}

function SandboxBanner({ status }: { status: PayPalStatus | null }) {
  if (!status) return null;
  if (status.configured && !status.dryRun) {
    return (
      <p className="mb-5 inline-flex items-center gap-2 rounded-md bg-grade-excellent/10 px-2.5 py-1 text-xs font-medium text-grade-excellent">
        <CheckCircle aria-hidden size={14} weight="fill" />
        Connected to the PayPal sandbox{status.agentLLM ? ", AI agent on" : ", rule engine"}
      </p>
    );
  }
  return (
    <div className="mb-5 rounded-lg border border-grade-mixed/50 bg-grade-mixed/10 px-4 py-3 text-sm text-foreground/85">
      <span className="font-semibold text-grade-mixed">
        {status.dryRun ? "Dry run: PayPal responses are simulated." : "PayPal sandbox not configured."}
      </span>{" "}
      {status.dryRun
        ? "Plans get placeholder IDs and the preview buttons stay inert."
        : `Add ${status.missing.join(" and ") || "sandbox credentials"} to .env.local (or set PAYPAL_DRY_RUN=true) to provision plans.`}
    </div>
  );
}
