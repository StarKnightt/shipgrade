// HMAC-signed, stateless tokens. The preview page and checkout routes trust
// prices and plan ids only from a token Shipgrade signed, never from the
// browser, so no database is needed for the demo.

import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf: Buffer) => buf.toString("base64url");

export function signToken<T extends object>(payload: T, secret: string, ttlSeconds = 60 * 60 * 24): string {
  const body = b64url(
    Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken<T>(token: string, secret: string): (T & { exp: number }) | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export interface PreviewPlan {
  tierId: string;
  name: string;
  description: string;
  amount: string;
  currency: "USD";
  interval: "MONTH" | "YEAR" | "ONE_TIME";
  paypalPlanId: string | null;
}

export interface PreviewPayload {
  kind: "preview";
  site: string;
  productName: string;
  simulated: boolean;
  plans: PreviewPlan[];
}
