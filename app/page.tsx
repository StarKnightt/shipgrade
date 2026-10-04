import Link from "next/link";
import { Suspense } from "react";
import Shipgrade from "./components/Shipgrade";

const DEMO_HREF = "/?demo=linear.app";
const SOURCE_HREF = "https://github.com/StarKnightt/shipgrade/tree/paypal-checkout";

function Mark({ size = "h-8 w-8" }: { size?: string }) {
  return (
    <span
      className={`grid ${size} -rotate-3 place-items-center rounded-full border-2 border-accent transition-transform duration-300 group-hover:rotate-0`}
    >
      <span className="font-serif text-base font-semibold leading-none text-accent">S</span>
    </span>
  );
}

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-(--border) bg-background/85 backdrop-blur">
        <nav
          aria-label="Main"
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5"
        >
          <Link href="/" className="group flex items-center gap-2.5 rounded-lg">
            <Mark />
            <span className="font-serif text-lg font-semibold tracking-tight">Shipgrade</span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <a
              href={SOURCE_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="press hidden rounded-lg px-3 py-2 text-muted hover:text-foreground sm:inline-block"
            >
              Source
            </a>
            <Link
              href={DEMO_HREF}
              className="press rounded-lg border border-(--border-strong) bg-surface px-3.5 py-2 font-medium hover:border-accent hover:text-accent"
            >
              Run the demo
            </Link>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        <Suspense>
          <Shipgrade />
        </Suspense>
      </main>

      <footer className="border-t border-(--border)">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 px-5 py-9 text-center sm:flex-row sm:justify-between sm:gap-6 sm:text-left">
          <div className="flex items-center gap-3">
            <Mark size="h-9 w-9" />
            <div>
              <div className="font-serif text-base font-semibold tracking-tight">Shipgrade</div>
              <div className="text-xs text-muted">Grade your product page. Then ship the checkout.</div>
            </div>
          </div>
          <p className="max-w-sm text-xs leading-5 text-muted sm:text-right">
            Built for the PayPal AI Hackathon. Payments run in the PayPal sandbox, so no real money moves.
          </p>
        </div>
      </footer>
    </>
  );
}
