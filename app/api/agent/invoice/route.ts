import { NextResponse } from "next/server";
import { createFixInvoiceArgs } from "@/lib/paypal/catalog";
import { readPayPalConfig } from "@/lib/paypal/config";
import { agentExecutor, badRequest, notConfigured, readJson, upstreamError } from "@/lib/paypal/server";

// Stretch: scope Shipgrade's fixes into a DRAFT PayPal invoice via the
// Agent Toolkit's create_invoice tool. It is never sent automatically.
export async function POST(request: Request) {
  const body = await readJson(request);
  const site = typeof body?.site === "string" ? body.site.slice(0, 200) : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const fixes = Array.isArray(body?.fixes) ? (body.fixes as unknown[]) : [];
  if (!site || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fixes.length === 0) {
    return badRequest("Send { site, email, fixes: [{ title, hours }] }.");
  }
  const items = fixes
    .map((f) => f as { title?: unknown; hours?: unknown })
    .filter((f) => typeof f.title === "string" && Number(f.hours) > 0)
    .map((f) => ({ title: String(f.title), hours: Math.min(40, Number(f.hours)) }));
  if (!items.length) return badRequest("Each fix needs a title and positive hours.");

  const cfg = readPayPalConfig();
  const executor = await agentExecutor(cfg);
  if (!executor) return notConfigured(cfg);

  const rate = Number(process.env.SHIPGRADE_FIX_HOURLY_RATE ?? "60");
  const args = createFixInvoiceArgs({
    site,
    recipientEmail: email,
    hourlyRate: Number.isFinite(rate) && rate > 0 ? rate : 60,
    fixes: items,
    invoicerBusinessName: cfg.offers.brandName,
  });
  try {
    const invoice = await executor.call("create_invoice", args);
    // The toolkit reports PayPal failures as { ok: false, ... } instead of throwing.
    if (invoice.ok === false) {
      const status = typeof invoice.status === "number" ? invoice.status : null;
      const message = typeof invoice.message === "string" ? invoice.message : "PayPal rejected the invoice";
      return NextResponse.json(
        {
          error:
            status === 403
              ? "This PayPal app lacks the Invoicing permission. Enable Invoicing for the app in the PayPal developer dashboard."
              : message,
          paypalStatus: status,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ status: "draft", simulated: executor.simulated, invoice });
  } catch (err) {
    return upstreamError(err);
  }
}
