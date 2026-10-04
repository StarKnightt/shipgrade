"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CreditCard,
  CursorClick,
  Eye,
  Lightning,
  PenNib,
  ShieldCheck,
  UsersThree,
  type Icon,
} from "@phosphor-icons/react";
import type { AnalysisResult, DimensionKey, DimensionResult, Finding } from "@/lib/analyze";
import { formatTierPrice, type MonetizationSignals } from "@/lib/monetization";
import { track } from "@/lib/analytics";
import CheckoutAgent, { type PayPalStatus } from "./CheckoutAgent";
import ShipgradeUpgrade from "./ShipgradeUpgrade";

const DEMO_SITE = "linear.app";

const LOADING_STEPS = [
  "Fetching the page",
  "Reading your headline",
  "Checking who it's for",
  "Hunting for proof",
  "Weighing your call to action",
  "Finding your pricing",
  "Tallying the grade",
];

const HOW_IT_WORKS = [
  ["Grade", "Seven scores, including whether a ready buyer can actually pay."],
  ["Approve", "An AI agent drafts your PayPal catalog. Nothing is created until you say so."],
  ["Live checkout", "Real sandbox plans, working PayPal buttons, and drop-in v6 code."],
] as const;

const DIMENSION_ICON: Record<DimensionKey, Icon> = {
  valueProp: Eye,
  audience: UsersThree,
  differentiation: Lightning,
  cta: CursorClick,
  trust: ShieldCheck,
  craft: PenNib,
  monetization: CreditCard,
};

const SHORT_LABEL: Record<DimensionKey, string> = {
  valueProp: "Value prop",
  audience: "Audience",
  differentiation: "Different",
  cta: "Call to action",
  trust: "Trust",
  craft: "Craft",
  monetization: "Checkout",
};

type Status = "idle" | "loading" | "done" | "error";

function scoreColor(score: number): string {
  if (score >= 75) return "var(--grade-excellent)";
  if (score >= 60) return "var(--grade-good)";
  if (score >= 45) return "var(--grade-mixed)";
  return "var(--grade-poor)";
}

function bandColor(band: AnalysisResult["band"]): string {
  return {
    excellent: "var(--grade-excellent)",
    good: "var(--grade-good)",
    mixed: "var(--grade-mixed)",
    poor: "var(--grade-poor)",
  }[band];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function useCountUp(target: number, duration = 900, delay = 0): number {
  const [value, setValue] = useState(0);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, duration, delay, reduced]);
  return reduced ? target : value;
}

export default function Shipgrade() {
  const router = useRouter();
  const params = useSearchParams();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const [demo, setDemo] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoRan = useRef<string | null>(null);
  const [paypal, setPaypal] = useState<PayPalStatus | null>(null);

  useEffect(() => () => clearInterval(stepTimer.current), []);

  useEffect(() => {
    fetch("/api/paypal/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setPaypal)
      .catch(() => setPaypal(null));
  }, []);

  const run = useCallback(
    async (target: string, source: "form" | "example" | "demo" = "form") => {
      const trimmed = target.trim();
      if (!trimmed) return;

      setStatus("loading");
      setError("");
      setResult(null);
      setStep(0);
      setDemo(source === "demo");
      track("analyze_submitted", { url: trimmed, source });

      let i = 0;
      clearInterval(stepTimer.current);
      stepTimer.current = setInterval(() => {
        i = Math.min(i + 1, LOADING_STEPS.length - 1);
        setStep(i);
      }, 700);

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Couldn't grade that page. Check the URL and try again.");
        const analysisResult = data as AnalysisResult;
        setResult(analysisResult);
        setStatus("done");
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });

        const dimScores: Record<string, number> = {};
        for (const dim of analysisResult.dimensions) dimScores[`${dim.key}Score`] = dim.score;
        track("analyze_succeeded", {
          url: analysisResult.finalUrl,
          grade: analysisResult.grade,
          score: analysisResult.overallScore,
          band: analysisResult.band,
          usedLLM: analysisResult.meta.usedLLM,
          wordCount: analysisResult.meta.wordCount,
          headingCount: analysisResult.meta.headingCount,
          ...dimScores,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Something went wrong. Try again.";
        setError(errorMessage);
        setStatus("error");
        track("analyze_failed", { url: trimmed, errorMessage });
      } finally {
        clearInterval(stepTimer.current);
      }
    },
    [],
  );

  // One-click demo and shareable links: /?demo=linear.app or /?url=linear.app
  useEffect(() => {
    const demoTarget = params.get("demo");
    const target = demoTarget ?? params.get("url");
    if (!target || autoRan.current === target) return;
    autoRan.current = target;
    setUrl(target);
    run(target, demoTarget ? "demo" : "example");
  }, [params, run]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    if (!url.trim()) {
      setError("Enter a product URL, like yourproduct.com.");
      setStatus("error");
      inputRef.current?.focus();
      return;
    }
    run(url);
  }

  function runDemo() {
    autoRan.current = DEMO_SITE;
    setUrl(DEMO_SITE);
    track("example_clicked", { url: DEMO_SITE });
    run(DEMO_SITE, "demo");
  }

  function reset() {
    track("analyze_reset", {
      previousUrl: result?.finalUrl,
      previousGrade: result?.grade,
      previousScore: result?.overallScore,
      previousBand: result?.band,
    });
    setStatus("idle");
    setResult(null);
    setError("");
    setUrl("");
    setDemo(false);
    autoRan.current = null;
    if (params.toString()) router.replace("/", { scroll: false });
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function share() {
    if (!result) return;
    const link = `${window.location.origin}/?url=${encodeURIComponent(hostOf(result.finalUrl))}`;
    const text = `${result.grade} (${result.overallScore}/100) for ${hostOf(result.finalUrl)}, graded by Shipgrade.\n${result.verdict}\n${link}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; ignore
    }
    track("result_shared", {
      grade: result.grade,
      score: result.overallScore,
      band: result.band,
      url: result.finalUrl,
      usedLLM: result.meta.usedLLM,
    });
  }

  const showHero = status === "idle" || status === "error";

  return (
    <div className="mx-auto w-full max-w-6xl px-5 pt-8 pb-20 sm:pt-12 sm:pb-28">
      {showHero && (
        <>
          <section className="grid items-center gap-10 lg:grid-cols-[1.02fr_1fr] lg:gap-14">
            <div className="text-center lg:text-left">
              <p className="rise font-mono text-[11px] uppercase tracking-[0.18em] text-accent" style={{ "--i": 0 } as React.CSSProperties}>
                Product critique + PayPal checkout agent
              </p>
              <h1
                className="rise mt-4 pb-1 font-serif text-[2.6rem] font-semibold leading-[1.04] tracking-tight text-balance sm:text-6xl lg:text-[4.1rem]"
                style={{ "--i": 1 } as React.CSSProperties}
              >
                Grade your page.{" "}
                <span className="block italic text-accent">Then ship the checkout.</span>
              </h1>
              <p
                className="rise mx-auto mt-5 max-w-xl text-pretty text-base leading-7 text-muted sm:text-lg lg:mx-0"
                style={{ "--i": 2 } as React.CSSProperties}
              >
                Shipgrade critiques your landing page in seconds. Then a PayPal agent turns your prices into a live
                checkout you approve.
              </p>

              <form
                onSubmit={onSubmit}
                noValidate
                className="rise mx-auto mt-7 flex max-w-xl flex-col gap-3 sm:flex-row lg:mx-0"
                style={{ "--i": 3 } as React.CSSProperties}
              >
                <label htmlFor="grade-url" className="sr-only">
                  Product URL to grade
                </label>
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-(--border-strong) bg-surface px-4 shadow-[0_1px_0_rgba(33,28,21,0.04)] transition-[border-color,box-shadow] duration-200 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
                  <span className="select-none font-mono text-sm text-muted">https://</span>
                  <input
                    id="grade-url"
                    ref={inputRef}
                    name="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Product URL to grade"
                    aria-invalid={status === "error"}
                    aria-describedby={status === "error" ? "grade-error" : undefined}
                    placeholder="yourproduct.com…"
                    className="h-14 w-full min-w-0 bg-transparent py-3.5 text-base text-foreground outline-none placeholder:text-muted"
                  />
                </div>
                <button
                  type="submit"
                  className="press group flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-ink shadow-[0_6px_18px_-8px_rgba(207,58,38,0.7)] hover:bg-[#bb3220]"
                >
                  Grade it
                  <ArrowRight aria-hidden size={18} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </form>

              {status === "error" && (
                <p
                  id="grade-error"
                  role="alert"
                  className="mx-auto mt-3 max-w-xl rounded-lg border border-grade-poor/40 bg-grade-poor/8 px-4 py-2.5 text-left text-sm text-grade-poor lg:mx-0"
                >
                  {error}
                </p>
              )}

              <div className="rise mt-5 flex justify-center lg:justify-start" style={{ "--i": 4 } as React.CSSProperties}>
                <button
                  type="button"
                  onClick={runDemo}
                  className="press group inline-flex items-center gap-2 rounded-lg px-1 py-1.5 text-sm font-medium text-foreground underline decoration-accent/50 decoration-2 underline-offset-[5px] hover:decoration-accent"
                >
                  Or watch the full run on {DEMO_SITE}
                  <ArrowRight aria-hidden size={15} weight="bold" className="text-accent transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </div>
            </div>

            <figure className="rise relative mx-auto w-full max-w-xl lg:max-w-none" style={{ "--i": 3 } as React.CSSProperties}>
              <div className="relative rotate-[0.6deg] overflow-hidden rounded-2xl border border-(--border-strong) bg-surface p-1.5 shadow-[0_30px_60px_-30px_rgba(60,40,20,0.45),0_2px_0_rgba(33,28,21,0.04)]">
                <Image
                  src="/hero-agent.png"
                  alt="A real Shipgrade run on linear.app: the PayPal agent's tool calls with sandbox IDs, next to the live pricing page with PayPal buttons."
                  width={1656}
                  height={1242}
                  priority
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="h-auto w-full rounded-xl"
                />
              </div>
              <span
                aria-hidden
                className="animate-stamp absolute -right-2 bottom-4 grid h-20 w-20 place-items-center rounded-full border-[3px] border-grade-excellent bg-surface/90 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-grade-excellent shadow-sm sm:-right-6"
                style={{ animationDelay: "500ms" }}
              >
                Live
              </span>
              <figcaption className="mt-3 text-center text-xs leading-5 text-muted lg:text-left">
                A real run on linear.app: the agent&apos;s PayPal calls, then the live checkout it built.
              </figcaption>
            </figure>
          </section>

          <section aria-labelledby="how" className="mt-16 border-t border-(--border) pt-10 sm:mt-20">
            <h2 id="how" className="font-serif text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-0">
              {HOW_IT_WORKS.map(([title, detail], i) => (
                <li key={title} className="relative md:pr-8">
                  {i < HOW_IT_WORKS.length - 1 && (
                    <span aria-hidden className="absolute top-4 left-10 hidden h-px w-[calc(100%-3rem)] bg-(--border-strong) md:block" />
                  )}
                  <div className="flex items-center gap-3 md:block">
                    <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-accent bg-background font-mono text-xs font-bold text-accent">
                      {i + 1}
                    </span>
                    <h3 className="text-base font-semibold md:mt-4">{title}</h3>
                  </div>
                  <p className="mt-1.5 max-w-xs text-sm leading-6 text-muted">{detail}</p>
                </li>
              ))}
            </ol>
            <p className="mt-10 text-sm leading-6 text-muted">
              Seven grades: value proposition, audience, differentiation, call to action, trust, craft, and the new
              checkout grade. No sign-up, any public URL.
            </p>
          </section>
        </>
      )}

      {status === "loading" && <LoadingState step={step} url={url} />}

      {status === "done" && result && (
        <Scorecard
          result={result}
          onReset={reset}
          onShare={share}
          copied={copied}
          demo={demo}
          agent={<CheckoutAgent key={result.fetchedAt} result={result} status={paypal} autoDraft={demo} />}
          upgrade={<ShipgradeUpgrade url={result.finalUrl} status={paypal} />}
        />
      )}
    </div>
  );
}

function LoadingState({ step, url }: { step: number; url: string }) {
  return (
    <section aria-live="polite" aria-busy="true" className="animate-fade-up">
      <div className="overflow-hidden rounded-2xl border border-(--border-strong) bg-surface shadow-sm">
        <div className="grid gap-8 p-6 sm:grid-cols-[auto_1fr] sm:p-9">
          <div className="mx-auto grid h-32 w-32 place-items-center rounded-full border-[3px] border-dashed border-(--border-strong)">
            <span className="tabular font-mono text-sm font-bold text-accent">
              {step + 1}/{LOADING_STEPS.length}
            </span>
          </div>
          <div>
            <p className="font-mono text-xs text-muted">Grading {hostOf(url || "your page")}</p>
            <div className="mt-3 space-y-2.5">
              <div className="skeleton h-7 w-11/12" />
              <div className="skeleton h-7 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          </div>
        </div>
        <ol className="grid gap-x-6 gap-y-2 border-t border-(--border) px-6 py-5 text-sm sm:grid-cols-2 sm:px-9 lg:grid-cols-4">
          {LOADING_STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "now" : "todo";
            return (
              <li key={s} className={`flex items-center gap-2 ${state === "todo" ? "text-muted/70" : "text-foreground"}`}>
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${
                    state === "done"
                      ? "bg-grade-excellent text-white"
                      : state === "now"
                        ? "live-ring border-2 border-accent"
                        : "border border-(--border-strong)"
                  }`}
                >
                  {state === "done" && <Check aria-hidden size={10} weight="bold" />}
                </span>
                {s}
                {state === "now" ? "…" : ""}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function GradeSeal({ result }: { result: AnalysisResult }) {
  const color = bandColor(result.band);
  const count = useCountUp(result.overallScore, 1100, 220);
  return (
    <div className="shrink-0">
      <div
        className="animate-stamp relative grid h-32 w-32 place-items-center rounded-full border-[3px]"
        style={{ borderColor: color }}
      >
        <span className="absolute inset-[7px] rounded-full border border-dashed" style={{ borderColor: color, opacity: 0.45 }} />
        <span className="font-serif text-6xl font-semibold leading-none" style={{ color }}>
          {result.grade}
        </span>
      </div>
      <div className="tabular mt-3 text-center font-mono text-xs text-muted">{count} / 100</div>
    </div>
  );
}

function ScoreStrip({ dimensions }: { dimensions: DimensionResult[] }) {
  const ordered = [
    ...dimensions.filter((d) => d.key === "monetization"),
    ...dimensions.filter((d) => d.key !== "monetization"),
  ];
  return (
    <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Scores by dimension">
      {ordered.map((d, i) => (
        <ScoreTile key={d.key} dim={d} index={i} />
      ))}
    </ul>
  );
}

function ScoreTile({ dim, index }: { dim: DimensionResult; index: number }) {
  const color = scoreColor(dim.score);
  const count = useCountUp(dim.score, 800, 350 + index * 70);
  const isCheckout = dim.key === "monetization";
  const IconC = DIMENSION_ICON[dim.key];
  return (
    <li className="rise" style={{ "--i": index + 2 } as React.CSSProperties}>
      <a
        href={isCheckout ? "#checkout" : `#dim-${dim.key}`}
        className={`press flex h-full flex-col rounded-xl border px-3 py-2.5 hover:border-accent ${
          isCheckout ? "border-accent/60 bg-accent/6" : "border-(--border) bg-background/50"
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <IconC aria-hidden size={14} weight="duotone" style={{ color }} />
          {SHORT_LABEL[dim.key]}
        </span>
        <span className="tabular mt-1 font-mono text-xl font-bold" style={{ color }}>
          {count}
        </span>
      </a>
    </li>
  );
}

function Scorecard({
  result,
  onReset,
  onShare,
  copied,
  demo,
  agent,
  upgrade,
}: {
  result: AnalysisResult;
  onReset: () => void;
  onShare: () => void;
  copied: boolean;
  demo: boolean;
  agent: React.ReactNode;
  upgrade: React.ReactNode;
}) {
  const checkoutDim = result.dimensions.find((d) => d.key === "monetization");
  const others = result.dimensions.filter((d) => d.key !== "monetization");

  useEffect(() => {
    if (!demo) return;
    const t = setTimeout(() => {
      document.getElementById("checkout")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }, 2600);
    return () => clearTimeout(t);
  }, [demo]);

  return (
    <section className="animate-fade-up" aria-label={`Report card for ${hostOf(result.finalUrl)}`}>
      <div className="overflow-hidden rounded-2xl border border-(--border-strong) bg-surface shadow-sm">
        <div className="p-6 sm:p-9">
          <div className="flex flex-col items-center gap-7 text-center sm:flex-row sm:items-start sm:gap-9 sm:text-left">
            <GradeSeal result={result} />
            <div className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm sm:justify-start">
                <span className="text-muted">Report card for</span>
                <a
                  href={result.finalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
                >
                  {hostOf(result.finalUrl)}
                  <ArrowUpRight aria-hidden size={13} weight="bold" />
                </a>
              </div>
              <h1 className="mt-2 text-pretty font-serif text-2xl font-medium leading-snug sm:text-[1.85rem]">
                {result.verdict}
              </h1>
              {result.roast && (
                <p className="mt-4 text-pretty border-l-2 border-accent pl-3.5 font-serif text-base italic leading-7 text-muted">
                  “{result.roast}”
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs text-muted sm:justify-start">
                <Chip>{result.meta.wordCount.toLocaleString()} words</Chip>
                <Chip>{result.meta.headingCount} headings</Chip>
                <Chip accent>{result.meta.usedLLM ? "AI-enhanced" : "Heuristic engine"}</Chip>
              </div>
            </div>
          </div>
          <ScoreStrip dimensions={result.dimensions} />
        </div>
      </div>

      {checkoutDim && <CheckoutCard dim={checkoutDim} checkout={result.checkout} />}

      {agent}

      <h2 className="mt-14 font-serif text-2xl font-semibold tracking-tight">The other six grades</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {others.map((dim, idx) => (
          <DimensionCard key={dim.key} dim={dim} delay={idx * 70} />
        ))}
      </div>

      {upgrade}

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          onClick={onReset}
          className="press rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-ink shadow-sm hover:bg-[#bb3220]"
        >
          Grade another page
        </button>
        <button
          onClick={onShare}
          aria-live="polite"
          className="press rounded-xl border border-(--border-strong) bg-surface px-6 py-3 text-sm font-medium text-foreground hover:border-accent"
        >
          {copied ? "Copied with link" : "Copy result"}
        </button>
      </div>
    </section>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono ${accent ? "border-accent text-accent" : "border-(--border-strong)"}`}
    >
      {children}
    </span>
  );
}

function ScoreLine({ count, color }: { count: number; color: string }) {
  return (
    <div aria-hidden className="mt-3.5 h-[3px] rounded-full transition-[width] duration-500" style={{ width: `${count}%`, background: color }} />
  );
}

function DimensionCard({ dim, delay }: { dim: DimensionResult; delay: number }) {
  const color = scoreColor(dim.score);
  const count = useCountUp(dim.score, 850, delay);
  const IconC = DIMENSION_ICON[dim.key];
  return (
    <article
      id={`dim-${dim.key}`}
      className="scroll-mt-24 rounded-2xl border border-(--border) bg-surface p-5 shadow-sm transition-[border-color] duration-200 hover:border-(--border-strong)"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2" style={{ color }}>
            <IconC aria-hidden size={18} weight="duotone" />
          </span>
          <h3 className="text-base font-semibold tracking-tight">{dim.label}</h3>
        </div>
        <span className="flex items-baseline gap-0.5">
          <span className="tabular font-mono text-2xl font-bold" style={{ color }}>
            {count}
          </span>
          <span className="font-mono text-[11px] text-muted">/100</span>
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{dim.blurb}</p>
      <ScoreLine count={count} color={color} />
      <ul className="mt-4 space-y-2.5">
        {dim.findings.map((f, i) => (
          <FindingRow key={i} finding={f} />
        ))}
      </ul>
    </article>
  );
}

function CheckoutCard({ dim, checkout }: { dim: DimensionResult; checkout: MonetizationSignals }) {
  const color = scoreColor(dim.score);
  const count = useCountUp(dim.score, 850, 420);
  const facts: [string, string][] = [
    ["Billing", BILLING_LABEL[checkout.billingModel]],
    [
      "Currency",
      checkout.currencies.length
        ? `${checkout.currencies.join(", ")}${checkout.hasCurrencySwitcher ? ", with switcher" : ""}`
        : "None shown",
    ],
    ["Pay Later", checkout.payLater ? "Shown" : "Not shown"],
    ["Sign-up wall", checkout.forcedSignup ? "Before paying" : checkout.guestCheckout ? "Guest checkout" : "None detected"],
  ];

  return (
    <article
      id="checkout"
      className="animate-fade-up mt-5 scroll-mt-24 overflow-hidden rounded-2xl border border-(--border-strong) bg-surface shadow-sm"
    >
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2" style={{ color }}>
                <CreditCard aria-hidden size={18} weight="duotone" />
              </span>
              <h2 className="text-base font-semibold tracking-tight">{dim.label}</h2>
              <span className="rounded-md bg-accent px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-accent-ink">
                New
              </span>
            </div>
            <span className="flex items-baseline gap-0.5">
              <span className="tabular font-mono text-2xl font-bold" style={{ color }}>
                {count}
              </span>
              <span className="font-mono text-[11px] text-muted">/100</span>
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">{dim.blurb}</p>
          <ScoreLine count={count} color={color} />

          {dim.explanation && (
            <p className="mt-4 text-pretty border-l-2 border-accent pl-3.5 font-serif text-[0.95rem] italic leading-7 text-foreground/85">
              {dim.explanation}
              <span className="ml-2 align-middle font-sans text-[11px] not-italic text-muted">
                {dim.explanationByAI ? "AI explanation" : "Rule engine"}
              </span>
            </p>
          )}

          <ul className="mt-4 space-y-2.5">
            {dim.findings.map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-(--border) bg-background/60 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">What we found</h3>
            {checkout.pricingSource === "linked" && checkout.pricingUrl && (
              <a
                href={checkout.pricingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-mono text-[11px] text-accent hover:underline"
              >
                {hostPath(checkout.pricingUrl)}
                <ArrowUpRight aria-hidden size={11} weight="bold" />
              </a>
            )}
          </div>

          {checkout.tiers.length > 0 ? (
            <ul className="mt-3 divide-y divide-(--border)">
              {checkout.tiers.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{t.name}</span>
                  <span className="flex items-center gap-2">
                    {t.ctaText && (
                      <span className="hidden max-w-[10rem] truncate text-xs text-muted sm:inline">“{t.ctaText}”</span>
                    )}
                    <span className="tabular font-mono text-sm font-bold">{formatTierPrice(t)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">
              {checkout.hasPricingSection
                ? "A pricing section, but no readable plan names and prices."
                : "No pricing section or /pricing page found. Try grading the pricing page directly."}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
            {checkout.providers.length ? (
              checkout.providers.map((p) => (
                <Chip key={p} accent={p === "PayPal"}>
                  {p}
                </Chip>
              ))
            ) : (
              <span className="text-muted">No payment provider detected</span>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted">{k}</dt>
                <dd className="mt-0.5 font-medium text-foreground/90">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </article>
  );
}

const BILLING_LABEL: Record<MonetizationSignals["billingModel"], string> = {
  subscription: "Subscription",
  one_time: "One-time",
  mixed: "Subscription + one-time",
  unknown: "Unclear",
};

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

function FindingRow({ finding }: { finding: Finding }) {
  const isWin = finding.type === "win";
  return (
    <li className="flex gap-2.5 text-sm leading-6">
      <span className="mt-1 shrink-0" style={{ color: isWin ? "var(--grade-excellent)" : "var(--accent)" }}>
        {isWin ? <Check aria-label="Working" size={15} weight="bold" /> : <ArrowRight aria-label="Fix" size={15} weight="bold" />}
      </span>
      <span className="text-pretty text-foreground/85">{finding.text}</span>
    </li>
  );
}
