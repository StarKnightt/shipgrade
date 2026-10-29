import Link from "next/link";
import { Suspense } from "react";
import Shipgrade from "./components/Shipgrade";

const DEMO_HREF = "/?demo=linear.app";
const SOURCE_HREF = "https://github.com/StarKnightt/shipgrade/tree/paypal-checkout";

function Mark() {
  return (
    <span aria-hidden className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-[7px] bg-ink">
      <span className="absolute inset-x-[5px] bottom-[5px] h-[5px] rounded-[1px] bg-mark" />
      <span className="relative -mt-0.5 font-display text-[15px] font-extrabold leading-none text-ink-fg">S</span>
    </span>
  );
}

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-30 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink-fg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-(--border) bg-background/90 backdrop-blur-md">
        <nav aria-label="Main" className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg">
            <Mark />
            <span className="font-display text-[1.15rem] font-bold tracking-tight">Shipgrade</span>
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <a
              href={SOURCE_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="press hidden rounded-lg px-3 py-1.5 text-muted hover:text-foreground sm:inline-block"
            >
              Source
            </a>
            <Link
              href={DEMO_HREF}
              className="press rounded-lg border border-(--border-strong) bg-surface px-3 py-1.5 font-medium hover:border-foreground/40"
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
        <div className="mx-auto grid w-full max-w-6xl gap-4 px-5 py-8 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="text-muted">Grade your product page. Then ship the checkout.</span>
          </div>
          <p className="text-xs leading-5 text-muted sm:text-right">
            Built for the PayPal AI Hackathon.
            <br className="hidden sm:block" /> Payments run in the PayPal sandbox, so no real money moves.
          </p>
        </div>
      </footer>
    </>
  );
}
