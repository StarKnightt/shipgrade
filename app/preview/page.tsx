import type { Metadata } from "next";
import Link from "next/link";
import { publicStatus, readPayPalConfig } from "@/lib/paypal/config";
import { tokenSecret } from "@/lib/paypal/server";
import { verifyToken, type PreviewPayload } from "@/lib/paypal/token";
import PreviewPricing from "./PreviewPricing";

export const metadata: Metadata = { title: "Pricing preview with PayPal · Shipgrade", robots: { index: false } };

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  const cfg = readPayPalConfig();
  const payload = token ? verifyToken<PreviewPayload>(token, tokenSecret(cfg)) : null;

  if (!payload || payload.kind !== "preview") {
    return (
      <main className="grid min-h-screen place-items-center p-8 text-center">
        <div>
          <h1 className="font-serif text-2xl font-semibold">This preview link has expired.</h1>
          <p className="mt-2 text-sm text-muted">Run the checkout agent again from your Shipgrade report.</p>
          <Link
            href="/"
            className="press mt-5 inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Back to Shipgrade
          </Link>
        </div>
      </main>
    );
  }

  return <PreviewPricing payload={payload} token={token} status={publicStatus(cfg)} />;
}
