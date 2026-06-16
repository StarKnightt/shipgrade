import Shipgrade from "./components/Shipgrade";

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-(--border) bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3.5">
          <a href="/" className="group flex items-center gap-2.5">
            <span className="grid h-8 w-8 -rotate-3 place-items-center rounded-full border-2 border-accent transition-transform group-hover:rotate-0">
              <span className="font-serif text-base font-semibold leading-none text-accent">
                S
              </span>
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">
              Shipgrade
            </span>
          </a>
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-muted sm:block">
            Product report cards
          </span>
        </div>
      </header>

      <main className="flex-1">
        <Shipgrade />
      </main>

      <footer className="border-t border-(--border)">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-5 py-9 text-center sm:flex-row sm:justify-between sm:gap-6 sm:text-left">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 -rotate-3 place-items-center rounded-full border-2 border-accent">
              <span className="font-serif text-base font-semibold leading-none text-accent">
                S
              </span>
            </span>
            <div>
              <div className="font-serif text-base font-semibold tracking-tight">
                Shipgrade
              </div>
              <div className="text-xs text-muted">
                Grade your product page before your users do.
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 sm:items-end">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              World Product Day 2026 — Everyone Ships Now
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Measured with Novus
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}
