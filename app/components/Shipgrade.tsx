"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AnalysisResult,
  DimensionKey,
  DimensionResult,
  Finding,
} from "@/lib/analyze";
import { track } from "@/lib/analytics";

const EXAMPLES = ["stripe.com", "linear.app", "notion.so", "figma.com"];

const GRADED_DIMENSIONS = [
  "Value Prop",
  "Audience",
  "Differentiation",
  "Call to Action",
  "Trust",
  "Craft",
];

const LOADING_STEPS = [
  "Fetching the page",
  "Reading your headline",
  "Checking who it's for",
  "Hunting for proof",
  "Weighing your call-to-action",
  "Tallying the grade",
];

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
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function useCountUp(target: number, duration = 900, delay = 0): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
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
  }, [target, duration, delay]);
  return value;
}

export default function Shipgrade() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const stepTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearInterval(stepTimer.current), []);

  async function run(target: string) {
    const trimmed = target.trim();
    if (!trimmed || status === "loading") return;

    setStatus("loading");
    setError("");
    setResult(null);
    setStep(0);
    track("analyze_submitted", { url: trimmed });

    let i = 0;
    clearInterval(stepTimer.current);
    stepTimer.current = setInterval(() => {
      i = Math.min(i + 1, LOADING_STEPS.length - 1);
      setStep(i);
    }, 850);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't grade that page.");
      setResult(data as AnalysisResult);
      setStatus("done");
      track("analyze_succeeded", {
        url: data.finalUrl,
        grade: data.grade,
        score: data.overallScore,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
      track("analyze_failed", { url: trimmed });
    } finally {
      clearInterval(stepTimer.current);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(url);
  }

  function useExample(example: string) {
    setUrl(example);
    track("example_clicked", { url: example });
    run(example);
  }

  function reset() {
    setStatus("idle");
    setResult(null);
    setError("");
    setUrl("");
    track("analyze_reset", {});
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function share() {
    if (!result) return;
    const text = `${result.grade} (${result.overallScore}/100) for ${hostOf(
      result.finalUrl,
    )} — graded by Shipgrade.\n${result.verdict}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; ignore
    }
    track("result_shared", { grade: result.grade });
  }

  const showHero = status === "idle" || status === "error";

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-20">
      {showHero && (
        <section className="animate-fade-up text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-(--border-strong) bg-surface px-3.5 py-1.5 text-xs font-medium tracking-wide text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            World Product Day · Everyone Ships Now
          </span>

          <h1 className="text-balance mx-auto mt-7 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Grade your product page
            <br className="hidden sm:block" /> before your users do.
          </h1>

          <p className="text-pretty mx-auto mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
            Paste any product URL. Get a brutally specific, dimension-by-dimension
            critique in about 30 seconds — the same questions a sharp product
            reviewer would ask.
          </p>

          <form
            onSubmit={onSubmit}
            className="mx-auto mt-9 flex max-w-xl flex-col gap-3 sm:flex-row"
          >
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-(--border-strong) bg-surface px-4 transition-colors focus-within:border-accent">
              <span className="select-none font-mono text-sm text-muted">
                https://
              </span>
              <input
                ref={inputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Product URL to grade"
                placeholder="yourproduct.com"
                className="h-13 w-full bg-transparent py-3.5 text-base text-foreground outline-none placeholder:text-muted/60"
              />
            </div>
            <button
              type="submit"
              className="h-13 shrink-0 rounded-xl bg-accent px-6 py-3.5 text-base font-semibold text-accent-ink transition-transform hover:scale-[1.02] active:scale-95"
            >
              Grade it
            </button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
            <span>Try</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => useExample(ex)}
                className="rounded-full border border-(--border) bg-surface px-3 py-1 font-mono text-xs text-foreground transition-colors hover:border-accent hover:text-accent"
              >
                {ex}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted">
            No sign-up. Works on any public URL.
          </p>

          <div className="mx-auto mt-12 flex max-w-3xl flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-(--border) pt-6 text-xs text-muted">
            <span className="font-mono uppercase tracking-widest">
              Grades 6 things
            </span>
            {GRADED_DIMENSIONS.map((d) => (
              <span key={d} className="inline-flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-accent" />
                {d}
              </span>
            ))}
          </div>

          {status === "error" && (
            <p
              role="alert"
              className="mx-auto mt-6 max-w-xl rounded-lg border border-grade-poor/40 bg-grade-poor/10 px-4 py-3 text-sm text-grade-poor"
            >
              {error}
            </p>
          )}
        </section>
      )}

      {status === "loading" && <LoadingState step={step} url={url} />}

      {status === "done" && result && (
        <Scorecard
          result={result}
          onReset={reset}
          onShare={share}
          copied={copied}
        />
      )}
    </div>
  );
}

function LoadingState({ step, url }: { step: number; url: string }) {
  return (
    <section className="animate-fade-up mx-auto max-w-xl py-16 text-center">
      <div
        className="mx-auto h-12 w-12 rounded-full border-2 border-(--border-strong) animate-spin-slow"
        style={{ borderTopColor: "var(--accent)" }}
      />
      <p className="mt-6 font-mono text-sm text-muted">
        {hostOf(url || "your page")}
      </p>
      <p className="mt-2 text-lg font-medium text-foreground">
        {LOADING_STEPS[step]}…
      </p>
      <div className="mx-auto mt-6 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-all duration-700"
          style={{ width: `${((step + 1) / LOADING_STEPS.length) * 100}%` }}
        />
      </div>
    </section>
  );
}

function GradeGauge({ result }: { result: AnalysisResult }) {
  const color = bandColor(result.band);
  const count = useCountUp(result.overallScore, 1100, 150);
  const angle = count * 3.6;
  return (
    <div
      className="relative grid h-36 w-36 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(${color} ${angle}deg, var(--surface-2) ${angle}deg)`,
      }}
    >
      <div className="absolute inset-[10px] rounded-full bg-background" />
      <div className="relative text-center">
        <div
          className="font-mono text-5xl font-bold leading-none"
          style={{ color }}
        >
          {result.grade}
        </div>
        <div className="mt-1.5 font-mono text-xs text-muted">{count}/100</div>
      </div>
    </div>
  );
}

function Scorecard({
  result,
  onReset,
  onShare,
  copied,
}: {
  result: AnalysisResult;
  onReset: () => void;
  onShare: () => void;
  copied: boolean;
}) {
  return (
    <section className="animate-fade-up">
      <div className="overflow-hidden rounded-2xl border border-(--border-strong) bg-surface">
        <div className="flex flex-col items-center gap-6 p-6 text-center sm:flex-row sm:items-center sm:gap-8 sm:p-8 sm:text-left">
          <GradeGauge result={result} />

          <div className="flex flex-col">
            <a
              href={result.finalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-muted transition-colors hover:text-accent"
            >
              {hostOf(result.finalUrl)} ↗
            </a>
            <p className="text-pretty mt-2 text-xl font-medium leading-8 sm:text-2xl">
              {result.verdict}
            </p>

            {result.roast && (
              <p className="text-pretty mt-3 border-l-2 border-accent pl-3 text-sm italic text-muted">
                “{result.roast}”
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted sm:justify-start">
              <Chip>{result.meta.wordCount.toLocaleString()} words</Chip>
              <Chip>{result.meta.headingCount} headings</Chip>
              <Chip accent>
                {result.meta.usedLLM ? "AI-enhanced" : "Heuristic engine"}
              </Chip>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {result.dimensions.map((dim, idx) => (
          <DimensionCard key={dim.key} dim={dim} delay={idx * 70} />
        ))}
      </div>

      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button
          onClick={onReset}
          className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-ink transition-transform hover:scale-[1.02] active:scale-95"
        >
          Grade another page
        </button>
        <button
          onClick={onShare}
          className="rounded-xl border border-(--border-strong) bg-surface px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-accent"
        >
          {copied ? "Copied to clipboard" : "Copy result"}
        </button>
      </div>
    </section>
  );
}

function Chip({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono ${
        accent ? "border-accent text-accent" : "border-(--border)"
      }`}
    >
      {children}
    </span>
  );
}

function DimensionCard({ dim, delay }: { dim: DimensionResult; delay: number }) {
  const color = scoreColor(dim.score);
  const count = useCountUp(dim.score, 850, delay);

  return (
    <div className="rounded-2xl border border-(--border) bg-surface p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-(--border-strong)">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2"
            style={{ color }}
          >
            <DimensionIcon dimension={dim.key} />
          </span>
          <h3 className="text-base font-semibold">{dim.label}</h3>
        </div>
        <span className="font-mono text-lg font-bold" style={{ color }}>
          {count}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{dim.blurb}</p>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${count}%`, background: color }}
        />
      </div>

      <ul className="mt-4 space-y-2.5">
        {dim.findings.map((f, i) => (
          <FindingRow key={i} finding={f} />
        ))}
      </ul>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const isWin = finding.type === "win";
  return (
    <li className="flex gap-2.5 text-sm leading-6">
      <span
        aria-hidden
        className="mt-0.5 shrink-0 font-mono text-xs"
        style={{
          color: isWin ? "var(--grade-excellent)" : "var(--grade-mixed)",
        }}
      >
        {isWin ? "✓" : "→"}
      </span>
      <span className="text-pretty text-foreground/85">{finding.text}</span>
    </li>
  );
}

function DimensionIcon({ dimension }: { dimension: DimensionKey }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (dimension) {
    case "valueProp":
      return (
        <svg {...common}>
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "audience":
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "differentiation":
      return (
        <svg {...common}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case "cta":
      return (
        <svg {...common}>
          <path d="M3 3l7.07 17 2.51-7.42L20 10.07z" />
        </svg>
      );
    case "trust":
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "craft":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      );
  }
}
