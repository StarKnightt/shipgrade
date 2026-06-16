import Shipgrade from "./components/Shipgrade";

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-(--border) bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg"
              style={{ background: "var(--accent)" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent-ink)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </svg>
            </span>
            <span className="text-base font-semibold tracking-tight">
              Shipgrade
            </span>
          </div>
          <span className="font-mono text-xs text-muted">
            6 dimensions · instant
          </span>
        </div>
      </header>

      <main className="flex-1 bg-dotted">
        <Shipgrade />
      </main>

      <footer className="border-t border-(--border) py-8 text-center text-xs leading-6 text-muted">
        <p>Built during World Product Day 2026 — Everyone Ships Now.</p>
        <p className="mt-1">Measured with Novus.</p>
      </footer>
    </>
  );
}
