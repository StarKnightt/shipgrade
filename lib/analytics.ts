// Tiny client-side event helper. Novus auto-instruments the codebase, but we
// also emit explicit, semantic product events so the key behaviors
// (grading, viewing results, sharing) are unmistakably trackable.

type EventName =
  | "analyze_submitted"
  | "analyze_succeeded"
  | "analyze_failed"
  | "example_clicked"
  | "result_shared"
  | "analyze_reset";

type Props = Record<string, string | number | boolean | null | undefined>;

interface NovusGlobal {
  track?: (event: string, props?: Props) => void;
}

interface PendoGlobal {
  track?: (event: string, props?: Props) => void;
}

declare global {
  interface Window {
    novus?: NovusGlobal;
    Novus?: NovusGlobal;
    pendo?: PendoGlobal;
  }
}

export function track(event: EventName, props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload = { ...props, ts: Date.now() };
  try {
    const novus = window.novus ?? window.Novus;
    novus?.track?.(event, payload);
  } catch {
    // never let analytics break the app
  }
  try {
    window.pendo?.track?.(event, props);
  } catch {
    // never let analytics break the app
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[shipgrade:event]", event, payload);
  }
}
