"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { I, Icon, type Glyph } from "@/app/components/icons";
import type { AnalysisResult, DimensionKey, DimensionResult, Finding } from "@/lib/analyze";
import { formatTierPrice, type MonetizationSignals } from "@/lib/monetization";
import { track } from "@/lib/analytics";
import CheckoutAgent, { type PayPalStatus } from "./CheckoutAgent";
import ShipgradeUpgrade from "./ShipgradeUpgrade";
import { tidy } from "@/lib/tidy";

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
  {
    title: "Grade",
    detail: "Seven scores, starting with whether a ready buyer can actually pay.",
    output: "Report card + checkout grade",
  },
  {
    title: "Approve",
    detail: "An AI agent drafts your PayPal catalog. Nothing is created until you say so.",
    output: "Products and plans, at your prices",
  },
  {
    title: "Go live",
    detail: "Real sandbox plans, working PayPal buttons, and code you can paste in.",
    output: "PayPal JS SDK v6 snippet",
  },
] as const;

const DIMENSION_ICON: Record<DimensionKey, Glyph> = {
  valueProp: I.view,
  audience: I.users,
  differentiation: I.flash,
  cta: I.cursor,
  trust: I.shield,
  craft: I.quill,
  monetization: I.creditCard,
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

/** Letter bands on the 0-100 rule, matching gradeFromScore in lib/analyze. */
const BANDS = [
  { letter: "F", from: 0, to: 40 },
  { letter: "D", from: 40, to: 50 },
  { letter: "C", from: 50, to: 65 },
  { letter: "B", from: 65, to: 80 },
  { letter: "A", from: 80, to: 100 },
] as const;

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

/**
 * Counts up to `value` the first time it scrolls into view. Writes the DOM
 * text directly so a frame of counting never re-renders React.
 */
function Ticker({
  value,
  delay = 0,
  duration = 900,
  className = "",
  style,
}: {
  value: number;
  delay?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      el.textContent = String(value);
      return;
    }
    el.textContent = "0";
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        timer = setTimeout(() => {
          let start = 0;
          const tick = (t: number) => {
            if (!start) start = t;
            const p = Math.min((t - start) / duration, 1);
            el.textContent = String(Math.round(value * (1 - Math.pow(1 - p, 3))));
            if (p < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }, delay);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, delay, duration]);
  return (
    <span ref={ref} aria-hidden className={`tabular ${className}`} style={style}>
      {value}
    </span>
  );
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
    const text = `${result.grade} (${result.overallScore}/100) for ${hostOf(result.finalUrl)}, graded by Shipgrade.\n${tidy(result.verdict)}\n${link}`;
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
    <div className="mx-auto w-full max-w-6xl px-5 pt-10 pb-20 sm:pt-16 sm:pb-28">
      {showHero && (
        <>
          <section className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
            <div>
              <p className="rise font-mono text-xs text-muted" style={{ "--i": 0 } as React.CSSProperties}>
                Product critique + PayPal checkout agent
              </p>
              <h1
                className="rise font-display mt-4 pb-1 text-[2.75rem] font-extrabold leading-[1.02] text-balance sm:text-6xl lg:text-[4.25rem]"
                style={{ "--i": 1 } as React.CSSProperties}
              >
                Grade your page.
                <br />
                Then ship the <span className="mark mark-draw">checkout.</span>
              </h1>
              <p
                className="rise mt-5 max-w-[30rem] text-pretty text-[1.0625rem] leading-7 text-muted"
                style={{ "--i": 2 } as React.CSSProperties}
              >
                Seven scores for your landing page. Then a PayPal agent turns your prices into a live checkout you
                approve.
              </p>

              <form
                onSubmit={onSubmit}
                noValidate
                className="rise mt-8 max-w-[32rem]"
                style={{ "--i": 3 } as React.CSSProperties}
              >
                <label htmlFor="grade-url" className="text-sm font-medium">
                  Your product URL
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <div
                    className={`flex flex-1 items-center gap-1.5 rounded-lg border bg-surface px-3.5 shadow-[0_1px_2px_rgba(14,17,23,0.05)] transition-[border-color,box-shadow] duration-150 focus-within:border-foreground/60 focus-within:ring-4 focus-within:ring-foreground/8 ${
                      status === "error" ? "border-grade-poor/60" : "border-(--border-strong)"
                    }`}
                  >
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
                      aria-invalid={status === "error"}
                      aria-describedby={status === "error" ? "grade-error" : undefined}
                      placeholder="yourproduct.com"
                      className="h-12 w-full min-w-0 bg-transparent text-base text-foreground outline-none placeholder:text-muted"
                    />
                  </div>
                  <button
                    type="submit"
                    className="press btn-ink group flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg px-5 text-[0.9375rem] font-semibold"
                  >
                    Grade it
                    <Icon icon={I.arrowRight}
                     
                      size={16}
                      className="transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </button>
                </div>
                {status === "error" && (
                  <p id="grade-error" role="alert" className="mt-2.5 flex items-start gap-1.5 text-sm text-grade-poor">
                    <Icon icon={I.alert} size={17} className="mt-px shrink-0" />
                    {tidy(error)}
                  </p>
                )}
              </form>

              <div className="rise mt-5" style={{ "--i": 4 } as React.CSSProperties}>
                <button
                  type="button"
                  onClick={runDemo}
                  className="press link-mark group -mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium underline decoration-(--border-strong) decoration-1 underline-offset-[5px] hover:decoration-foreground"
                >
                  Or watch a full run on {DEMO_SITE}
                  <Icon icon={I.arrowRight}
                   
                    size={14}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </button>
              </div>
            </div>

            <figure className="rise w-full" style={{ "--i": 3 } as React.CSSProperties}>
              <div className="overflow-hidden rounded-xl border border-(--border-strong) bg-surface p-1 shadow-[0_24px_48px_-28px_rgba(14,17,23,0.35)]">
                <Image
                  src="/hero-agent.png"
                  alt="A real Shipgrade run on linear.app: the PayPal agent's tool calls with sandbox IDs, next to the live pricing page with PayPal buttons."
                  width={1656}
                  height={1242}
                  priority
                  sizes="(min-width: 1024px) 600px, 100vw"
                  className="h-auto w-full rounded-[9px]"
                />
              </div>
              <figcaption className="mt-3 text-xs leading-5 text-muted">
                A real run on linear.app: the agent&apos;s PayPal calls, then the checkout it built.
              </figcaption>
            </figure>
          </section>

          <section aria-label="Why Shipgrade" className="mt-20 border-t border-(--border) pt-14 sm:mt-28 sm:pt-20">
            <p className="font-display max-w-[34ch] text-[1.7rem] leading-[1.2] font-bold text-balance text-muted sm:text-[2.35rem]">
              Most product pages lose ready buyers at the last step: a price with no way to pay.{" "}
              <span className="text-foreground">
                Shipgrade finds that gap, then builds the PayPal checkout that closes it.
              </span>
            </p>
          </section>

          <section aria-labelledby="how" className="mt-16 sm:mt-20">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 id="how" className="font-display text-2xl font-bold">
                How it works
              </h2>
              <p className="text-sm text-muted">Any public URL. No sign-up.</p>
            </div>
            <ol className="mt-5 grid gap-px overflow-hidden rounded-xl border border-(--border) bg-(--border) md:grid-cols-3">
              {HOW_IT_WORKS.map((s, i) => (
                <li key={s.title} className="flex flex-col bg-surface p-5 sm:p-6">
                  <span className="font-mono text-xs text-muted">Step {i + 1}</span>
                  <h3 className="font-display mt-2 text-xl font-bold">{s.title}</h3>
                  <p className="mt-1.5 max-w-xs flex-1 text-sm leading-6 text-muted">{s.detail}</p>
                  <p className="mt-5 border-t border-dashed border-(--border-strong) pt-3 font-mono text-xs text-foreground/80">
                    {s.output}
                  </p>
                </li>
              ))}
            </ol>
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
      <div className="overflow-hidden rounded-xl border border-(--border-strong) bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-(--border) px-5 py-3 sm:px-8">
          <p className="text-sm">
            <span className="text-muted">Grading</span>{" "}
            <span className="font-medium">{hostOf(url || "your page")}</span>
          </p>
          <span className="tabular font-mono text-xs text-muted">
            {step + 1}/{LOADING_STEPS.length}
          </span>
        </div>
        <div className="grid gap-8 p-5 sm:grid-cols-[8.5rem_1fr] sm:p-8">
          <div className="skeleton h-28 w-28 sm:h-32 sm:w-32" />
          <div className="space-y-3 pt-1">
            <div className="skeleton h-7 w-11/12" />
            <div className="skeleton h-7 w-3/5" />
            <div className="skeleton mt-5 h-4 w-2/5" />
          </div>
        </div>
        <ol className="grid gap-x-8 gap-y-2.5 border-t border-(--border) bg-background/60 px-5 py-5 text-sm sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          {LOADING_STEPS.map((s, i) => {
            const state = i < step ? "done" : i === step ? "now" : "todo";
            return (
              <li
                key={s}
                className={`flex items-center gap-2 ${state === "todo" ? "text-muted" : "text-foreground"}`}
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  {state === "done" ? (
                    <Icon icon={I.tick} size={13} className="text-grade-excellent" />
                  ) : state === "now" ? (
                    <Icon icon={I.loading} size={14} className="animate-spin-slow" />
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-current" />
                  )}
                </span>
                {s}
                <span className="sr-only">{state === "done" ? "(done)" : state === "now" ? "(in progress)" : ""}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function GradeRule({ score, color }: { score: number; color: string }) {
  const current = BANDS.find((b) => score >= b.from && score < b.to) ?? BANDS[BANDS.length - 1];
  return (
    <div aria-hidden className="mt-9">
      <div className="relative h-6">
        <div className="absolute inset-x-0 bottom-0 flex h-1.5 gap-[3px]">
          {BANDS.map((b) => (
            <span
              key={b.letter}
              className="h-full basis-0 rounded-[2px]"
              style={{
                flexGrow: b.to - b.from,
                background: b === current ? `color-mix(in oklab, ${color} 30%, transparent)` : "var(--surface-2)",
              }}
            />
          ))}
        </div>
        <div className="marker-in absolute inset-0" style={{ "--from": `-${score}%` } as React.CSSProperties}>
          <span
            className="absolute bottom-[-3px] h-[27px] w-[3px] -translate-x-1/2 rounded-full ring-2 ring-surface"
            style={{ left: `${score}%`, background: color }}
          />
        </div>
      </div>
      <div className="relative mt-2.5 h-4 font-mono text-[11px] text-muted">
        <span className="absolute left-0">0</span>
        {BANDS.map((b) => (
          <span
            key={b.letter}
            className={`absolute -translate-x-1/2 ${b === current ? "font-semibold text-foreground" : ""}`}
            style={{ left: `${(b.from + b.to) / 2}%` }}
          >
            {b.letter}
          </span>
        ))}
        <span className="absolute right-0">100</span>
      </div>
    </div>
  );
}

function MiniRule({ score, color }: { score: number; color: string }) {
  return (
    <div aria-hidden className="relative mt-3 h-2.5">
      <div className="ticks absolute inset-x-0 bottom-0 h-1.5 border-r border-(--border-strong)" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-(--border-strong)" />
      <span
        className="absolute bottom-0 h-2.5 w-[3px] -translate-x-1/2 rounded-full"
        style={{ left: `${score}%`, background: color }}
      />
    </div>
  );
}

function ScoreStrip({ dimensions }: { dimensions: DimensionResult[] }) {
  const ordered = [
    ...dimensions.filter((d) => d.key === "monetization"),
    ...dimensions.filter((d) => d.key !== "monetization"),
  ];
  return (
    <ul
      className="grid grid-cols-2 gap-px border-t border-(--border) bg-(--border) sm:grid-cols-4 lg:grid-cols-7"
      aria-label="Scores by dimension"
    >
      {ordered.map((d, i) => (
        <ScoreTile key={d.key} dim={d} index={i} />
      ))}
    </ul>
  );
}

function ScoreTile({ dim, index }: { dim: DimensionResult; index: number }) {
  const color = scoreColor(dim.score);
  const isCheckout = dim.key === "monetization";
  const glyph = DIMENSION_ICON[dim.key];
  return (
    <li className={`rise ${isCheckout ? "col-span-2 lg:col-span-1" : ""}`} style={{ "--i": index + 2 } as React.CSSProperties}>
      <a
        href={isCheckout ? "#checkout" : `#dim-${dim.key}`}
        className={`group flex h-full flex-col px-4 pt-3.5 pb-4 transition-colors duration-150 hover:bg-background focus-visible:-outline-offset-2 ${
          isCheckout ? "bg-[color-mix(in_oklab,var(--mark)_16%,var(--surface))]" : "bg-surface"
        }`}
      >
        <span className="flex items-center gap-1.5 text-xs text-muted group-hover:text-foreground">
          <Icon icon={glyph} size={14} />
          {SHORT_LABEL[dim.key]}
          <span className="sr-only">: {dim.score} out of 100</span>
        </span>
        <Ticker
          value={dim.score}
          delay={300 + index * 60}
          duration={800}
          className="mt-1.5 font-mono text-2xl font-semibold"
          style={{ color }}
        />
        <MiniRule score={dim.score} color={color} />
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
  const color = bandColor(result.band);

  useEffect(() => {
    if (!demo) return;
    const t = setTimeout(() => {
      document.getElementById("checkout")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }, 2600);
    return () => clearTimeout(t);
  }, [demo]);

  return (
    <section className="animate-fade-up" aria-label={`Report card for ${hostOf(result.finalUrl)}`}>
      <div className="overflow-hidden rounded-xl border border-(--border-strong) bg-surface shadow-[0_1px_2px_rgba(14,17,23,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-(--border) px-5 py-3 text-sm sm:px-8">
          <p className="flex items-center gap-1.5">
            <span className="text-muted">Report card for</span>
            <a
              href={result.finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="link-mark inline-flex items-center gap-0.5 rounded-sm font-medium underline decoration-(--border-strong) underline-offset-4"
            >
              {hostOf(result.finalUrl)}
              <Icon icon={I.arrowUpRight} size={13} />
            </a>
          </p>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted">
            <span>{result.meta.wordCount.toLocaleString()} words</span>
            <span>{result.meta.headingCount} headings</span>
            <span className="text-foreground">{result.meta.usedLLM ? "AI-enhanced" : "Heuristic engine"}</span>
          </p>
        </div>

        <div className="px-5 pt-7 pb-7 sm:px-8 sm:pt-9">
          <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:gap-10">
            <div className="flex items-end gap-4 sm:block">
              <div
                className="grade-reveal font-display pb-1 text-[6.5rem] leading-[0.82] font-extrabold tracking-[-0.04em] sm:text-[8rem]"
                style={{ color }}
              >
                <span className="sr-only">Grade </span>
                {result.grade}
              </div>
              <div className="font-mono text-sm text-muted sm:mt-2">
                <span className="sr-only">Score {result.overallScore} out of 100</span>
                <Ticker value={result.overallScore} delay={200} duration={1100} className="text-foreground" />
                <span aria-hidden> / 100</span>
              </div>
            </div>
            <div className="min-w-0 sm:pt-1">
              <h1 className="font-display text-pretty text-[1.65rem] leading-[1.15] font-bold sm:text-[2.1rem]">
                {tidy(result.verdict)}
              </h1>
              {result.roast && (
                <p className="mt-4 max-w-[60ch] text-pretty border-l-2 border-foreground pl-3.5 text-[0.95rem] leading-7 text-foreground/80">
                  &ldquo;{tidy(result.roast)}&rdquo;
                </p>
              )}
            </div>
          </div>
          <GradeRule score={result.overallScore} color={color} />
        </div>
        <ScoreStrip dimensions={result.dimensions} />
      </div>

      {checkoutDim && <CheckoutCard dim={checkoutDim} checkout={result.checkout} />}

      {agent}

      <h2 className="font-display mt-16 text-2xl font-bold">The other six grades</h2>
      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-(--border) bg-(--border) md:grid-cols-2">
        {others.map((dim, idx) => (
          <DimensionCard key={dim.key} dim={dim} delay={idx * 70} />
        ))}
      </div>

      {upgrade}

      <div className="mt-12 flex flex-col gap-3 border-t border-(--border) pt-8 sm:flex-row sm:items-center">
        <button onClick={onReset} className="press btn-ink rounded-lg px-5 py-2.5 text-sm font-semibold">
          Grade another page
        </button>
        <button
          onClick={onShare}
          aria-live="polite"
          className="press inline-flex items-center justify-center gap-1.5 rounded-lg border border-(--border-strong) bg-surface px-5 py-2.5 text-sm font-medium hover:border-foreground/40"
        >
          {copied && <Icon icon={I.tick} size={14} className="text-grade-excellent" />}
          {copied ? "Copied with link" : "Copy result"}
        </button>
      </div>
    </section>
  );
}

function ScoreHead({ label, score, delay = 0, as: H = "h3" }: { label: string; score: number; delay?: number; as?: "h2" | "h3" }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-baseline justify-between gap-3">
      <H className="font-display text-lg font-bold">{label}</H>
      <span className="flex items-baseline gap-0.5">
        <span className="sr-only">{score} out of 100</span>
        <Ticker value={score} delay={delay} duration={850} className="font-mono text-2xl font-semibold" style={{ color }} />
        <span aria-hidden className="font-mono text-xs text-muted">/100</span>
      </span>
    </div>
  );
}

function DimensionCard({ dim, delay }: { dim: DimensionResult; delay: number }) {
  const color = scoreColor(dim.score);
  return (
    <article id={`dim-${dim.key}`} className="scroll-mt-24 bg-surface p-5 sm:p-6">
      <ScoreHead label={dim.label} score={dim.score} delay={delay} />
      <p className="mt-1 text-sm leading-6 text-muted">{dim.blurb}</p>
      <MiniRule score={dim.score} color={color} />
      <ul className="mt-5 space-y-3">
        {dim.findings.map((f, i) => (
          <FindingRow key={i} finding={f} />
        ))}
      </ul>
    </article>
  );
}

function CheckoutCard({ dim, checkout }: { dim: DimensionResult; checkout: MonetizationSignals }) {
  const color = scoreColor(dim.score);
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
      className="animate-fade-up mt-6 scroll-mt-20 overflow-hidden rounded-xl border border-(--border-strong) bg-surface"
    >
      <div className="grid lg:grid-cols-[1.15fr_1fr]">
        <div className="p-5 sm:p-8">
          <p className="font-mono text-xs text-muted">Graded first</p>
          <div className="mt-1.5">
            <ScoreHead label={dim.label} score={dim.score} delay={200} as="h2" />
          </div>
          <p className="mt-1 text-sm leading-6 text-muted">{dim.blurb}</p>
          <MiniRule score={dim.score} color={color} />

          {dim.explanation && (
            <div className="mt-6 border-l-2 border-foreground pl-4">
              <p className="text-pretty text-[0.95rem] leading-7 text-foreground/90">{tidy(dim.explanation)}</p>
              <p className="mt-1.5 font-mono text-[11px] text-muted">
                {dim.explanationByAI ? "Explained by AI" : "Rule engine"}
              </p>
            </div>
          )}

          <ul className="mt-6 space-y-3">
            {dim.findings.map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
          </ul>
        </div>

        <div className="border-t border-(--border) bg-background/70 p-5 sm:p-8 lg:border-t-0 lg:border-l">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">What buyers see</h3>
            {checkout.pricingSource === "linked" && checkout.pricingUrl && (
              <a
                href={checkout.pricingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="link-mark inline-flex items-center gap-0.5 rounded-sm font-mono text-xs text-muted hover:text-foreground"
              >
                {hostPath(checkout.pricingUrl)}
                <Icon icon={I.arrowUpRight} size={11} />
              </a>
            )}
          </div>

          <div className="mt-4 rounded-lg border border-(--border) bg-surface px-4 py-2 font-mono text-[13px]">
            {checkout.tiers.length > 0 ? (
              <ul>
                {checkout.tiers.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2 py-2">
                    <span className="min-w-0 truncate font-sans text-sm font-medium">{t.name}</span>
                    {t.ctaText && (
                      <span className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted sm:inline">
                        &ldquo;{t.ctaText}&rdquo;
                      </span>
                    )}
                    <span aria-hidden className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-(--border-strong)" />
                    <span className="tabular shrink-0 font-semibold">{formatTierPrice(t)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 font-sans text-sm text-muted">
                {checkout.hasPricingSection
                  ? "A pricing section, but no readable plan names and prices."
                  : "No pricing section or /pricing page found. Try grading the pricing page directly."}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-(--border-strong) py-2.5 text-xs">
              <span className="text-muted">Pay with</span>
              {checkout.providers.length ? (
                checkout.providers.map((p) => (
                  <span key={p} className={p === "PayPal" ? "font-semibold" : ""}>
                    {p}
                  </span>
                ))
              ) : (
                <span className="font-semibold text-grade-poor">No payment provider detected</span>
              )}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="mt-0.5 font-medium">{v}</dd>
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
    <li className="grid grid-cols-[1.25rem_1fr] gap-2 text-sm leading-6">
      <span
        className={`mt-[3px] grid h-[18px] w-[18px] place-items-center rounded-[5px] ${
          isWin ? "bg-grade-excellent/10 text-grade-excellent" : "bg-mark text-foreground"
        }`}
      >
        {isWin ? (
          <Icon icon={I.tick} aria-label="Working" size={11} />
        ) : (
          <Icon icon={I.arrowRight} aria-label="Fix" size={11} />
        )}
      </span>
      <span className="text-pretty text-foreground/85">{tidy(finding.text)}</span>
    </li>
  );
}
