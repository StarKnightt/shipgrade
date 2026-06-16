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

// Novus ships as the Pendo web SDK, which exposes `window.pendo` with a
// `track(type, metadata)` method. The agent stubs `track` into a queue before
// the script loads, so calling it early is safe — events flush on init.
interface PendoGlobal {
  track?: (type: string, metadata?: Props) => void;
}

declare global {
  interface Window {
    pendo?: PendoGlobal;
  }
}

export function track(event: EventName, props: Props = {}): void {
  if (typeof window === "undefined") return;
  const payload = { ...props, ts: Date.now() };
  try {
    window.pendo?.track?.(event, payload);
  } catch {
    // never let analytics break the app
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[shipgrade:event]", event, payload);
  }
}
