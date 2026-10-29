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

      <footer className="overflow-hidden border-t border-(--border)">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 pt-12 pb-8 text-sm sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Mark />
              <span className="font-display text-[1.05rem] font-bold">Shipgrade</span>
            </div>
            <p className="mt-3 max-w-[34ch] leading-6 text-muted">
              Grade your product page. Then ship the checkout. Built for the PayPal AI Hackathon; payments run in the
              PayPal sandbox, so no real money moves.
            </p>
          </div>
          <nav aria-label="Product">
            <h2 className="text-xs font-semibold">Product</h2>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <Link href={DEMO_HREF} className="rounded-sm hover:text-foreground">
                  Run the demo
                </Link>
              </li>
              <li>
                <a href="#main" className="rounded-sm hover:text-foreground">
                  Grade a page
                </a>
              </li>
              <li>
                <a href={SOURCE_HREF} target="_blank" rel="noopener noreferrer" className="rounded-sm hover:text-foreground">
                  Source on GitHub
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Built with">
            <h2 className="text-xs font-semibold">Built with</h2>
            <ul className="mt-3 space-y-2 text-muted">
              <li>
                <a
                  href="https://github.com/paypal/agent-toolkit"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm hover:text-foreground"
                >
                  PayPal Agent Toolkit
                </a>
              </li>
              <li>
                <a
                  href="https://developer.paypal.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-sm hover:text-foreground"
                >
                  PayPal JS SDK v6
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div aria-hidden className="mx-auto w-full max-w-6xl px-5">
          <div className="font-display -mb-[0.22em] text-[clamp(4.5rem,17.5vw,15.5rem)] leading-none font-extrabold tracking-[-0.045em] text-[#e2e5ea] select-none">
            Shipgrade
          </div>
        </div>
      </footer>
    </>
  );
}
