// One-time sandbox setup for Shipgrade's own Watch subscription.
// Creates the "Shipgrade Watch" catalog product and monthly plan, then prints
// SHIPGRADE_WATCH_PLAN_ID for .env.local.
//
//   pnpm paypal:setup
//
// Reads PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET from .env.local.

import { readPayPalConfig } from "../lib/paypal/config";
import { PayPalRest } from "../lib/paypal/rest";

async function main() {
  const cfg = readPayPalConfig();
  if (!cfg.configured) {
    console.error(cfg.reason, cfg.missing.join(", "));
    process.exit(1);
  }
  if (cfg.offers.watchPlanId) {
    console.log(`SHIPGRADE_WATCH_PLAN_ID is already set (${cfg.offers.watchPlanId}). Nothing to do.`);
    return;
  }
  const rest = new PayPalRest(cfg);
  const product = await rest.createProduct({
    name: `${cfg.offers.brandName} Watch`,
    description: "Weekly re-grade of your landing page and checkout, with change alerts.",
    type: "SERVICE",
    homeUrl: "https://shipgrade.vercel.app",
  });
  const plan = await rest.createMonthlyPlan({
    productId: product.id,
    name: `${cfg.offers.brandName} Watch (monthly)`,
    price: cfg.offers.watchPrice,
    currency: cfg.offers.currency,
    description: "Weekly re-grades and email alerts",
  });
  console.log(`Created product ${product.id} and plan ${plan.id} (${plan.status}).`);
  console.log(`\nAdd to .env.local:\nSHIPGRADE_WATCH_PLAN_ID=${plan.id}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
