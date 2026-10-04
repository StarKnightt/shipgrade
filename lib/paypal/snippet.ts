// Generates copy-paste PayPal JS SDK v6 button code wired to the provisioned
// plan ids. Uses createInstance + <paypal-button> + payment sessions per
// https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6/paypal-checkout.

import { SANDBOX_SDK_URL } from "./config";
import type { PreviewPlan } from "./token";

const js = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
const html = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buttonSnippet(input: {
  clientId: string | null;
  plans: PreviewPlan[];
  /** Your server routes that create the order / subscription and return its id. */
  orderEndpoint?: string;
  subscriptionEndpoint?: string;
}): string {
  const clientId = input.clientId ?? "YOUR_SANDBOX_CLIENT_ID";
  const orderEndpoint = input.orderEndpoint ?? "/api/paypal/orders";
  const subscriptionEndpoint = input.subscriptionEndpoint ?? "/api/paypal/subscriptions";
  const recurring = input.plans.filter((p) => p.interval !== "ONE_TIME");
  const oneTime = input.plans.filter((p) => p.interval === "ONE_TIME");
  const components = [
    oneTime.length ? "paypal-payments" : null,
    recurring.length ? "paypal-subscriptions" : null,
  ].filter(Boolean) as string[];

  const containers = input.plans
    .map(
      (p) =>
        `<!-- ${html(p.name)}: ${p.amount} ${p.currency}${p.interval === "ONE_TIME" ? "" : ` / ${p.interval.toLowerCase()}`} -->\n<div data-paypal-tier="${html(p.tierId)}"></div>`,
    )
    .join("\n");

  const planMap = recurring.length
    ? `  // PayPal plan ids created by Shipgrade's agent\n  const PLAN_IDS = {\n${recurring
        .map((p) => `    ${js(p.tierId)}: ${js(p.paypalPlanId ?? "P-YOUR_PLAN_ID")},`)
        .join("\n")}\n  };\n`
    : "";

  const subscriptionBlock = recurring.length
    ? `
  // Subscriptions (v6 "paypal-subscriptions" component)
  const subEligible = await sdk.findEligibleMethods({ paymentFlow: "RECURRING_PAYMENT", currencyCode: "USD" });
  if (subEligible.isEligible("paypal")) {
    for (const [tier, planId] of Object.entries(PLAN_IDS)) {
      const session = sdk.createPayPalSubscriptionPaymentSession({
        onApprove: async ({ subscriptionId }) => {
          // Verify server-side (GET /v1/billing/subscriptions/{id}) before granting access.
          await fetch(${js(subscriptionEndpoint)} + "/" + subscriptionId + "/verify", { method: "POST" });
        },
        onError: (err) => console.error(err),
      });
      mountButton(tier, () =>
        session.start(
          { presentationMode: "auto" },
          fetch(${js(subscriptionEndpoint)}, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ planId }),
          }).then((r) => r.json()).then(({ id }) => ({ subscriptionId: id })),
        ),
      );
    }
  }
`
    : "";

  const orderBlock = oneTime.length
    ? `
  // One-time payments (v6 "paypal-payments" component)
  const oneTimeEligible = await sdk.findEligibleMethods({ currencyCode: "USD" });
  if (oneTimeEligible.isEligible("paypal")) {
    for (const tier of ${JSON.stringify(oneTime.map((p) => p.tierId))}) {
      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          await fetch(${js(orderEndpoint)} + "/" + orderId + "/capture", { method: "POST" });
        },
        onError: (err) => console.error(err),
      });
      mountButton(tier, () =>
        session.start(
          { presentationMode: "auto" },
          // Your server looks up the price for this tier; never send amounts from the browser.
          fetch(${js(orderEndpoint)}, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tier }),
          }).then((r) => r.json()).then(({ id }) => ({ orderId: id })),
        ),
      );
    }
  }
`
    : "";

  return `${containers}

<script>
async function onPayPalWebSdkLoaded() {
  const sdk = await window.paypal.createInstance({
    clientId: ${js(clientId)},
    components: ${JSON.stringify(components)},
    pageType: "checkout",
  });

  function mountButton(tier, start) {
    const button = document.createElement("paypal-button");
    button.setAttribute("type", "pay");
    // Don't await work before start(): it must run inside the click gesture.
    button.addEventListener("click", () => start());
    document.querySelector('[data-paypal-tier="' + tier + '"]').append(button);
  }
${planMap}${subscriptionBlock}${orderBlock}}
</script>
<script async src="${SANDBOX_SDK_URL}" onload="onPayPalWebSdkLoaded()"></script>`;
}
