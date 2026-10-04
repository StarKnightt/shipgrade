# Shipgrade

**Grade your product page before your users do. Then ship the checkout fix.**

Paste any product URL and get a ruthless, specific, dimension-by-dimension
product critique in about 30 seconds. The same questions a sharp product
reviewer would ask in the first five seconds, plus the one most pages fail
quietly: can a ready buyer actually pay?

Originally built for **World Product Day 2026: Everyone Ships Now**. Extended
for the **PayPal AI Hackathon** (October 2026) with a Monetization & Checkout
grade and a PayPal checkout agent. See [What's new](#whats-new-for-the-paypal-ai-hackathon).

**Hackathon demo (PayPal sandbox):** https://shipgrade-checkout.vercel.app

## What it grades

Shipgrade scores seven dimensions that decide whether a stranger "gets it"
and can buy:

| Dimension | The question it answers |
| --- | --- |
| **Value Proposition** | Can a stranger tell what this is in five seconds? |
| **Audience Clarity** | Is it obvious who this is for? |
| **Differentiation** | Does it say why you over the alternatives? |
| **Call to Action** | Is there one clear next step? |
| **Trust & Proof** | Is there any reason to believe you? |
| **Messaging Craft** | Is the copy tight, or a wall of jargon? |
| **Monetization & Checkout** | Can a ready buyer see the price and pay in seconds? |

Each dimension gets a 0–100 score and specific, actionable findings: wins to
keep and fixes to make. The seven roll up into an overall grade (A+ to F).

## What's new for the PayPal AI Hackathon

Everything below was added after October 1, 2026 on the `paypal-checkout`
branch. The original six-dimension grader is unchanged in spirit.

- **Monetization & Checkout grade.** Shipgrade finds the pricing (on the page,
  or by following its pricing link), extracts the plans, detects payment
  providers, billing model, currencies, Pay Later messaging, trust signals
  near the price, and sign-up walls, then scores how fast intent turns into
  payment. An LLM explains the result in plain language when a key is set;
  otherwise the rule engine writes the explanation.
- **PayPal checkout agent.** From the report, the agent drafts a PayPal
  catalog that mirrors the site's real prices. **Nothing is created until a
  human approves it.** It then uses the
  [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) to create the
  catalog product and subscription plans (or one-time orders) in the PayPal
  **sandbox**, and returns:
  - a live preview of the site's pricing with PayPal JS SDK v6 buttons, and
  - drop-in v6 button code wired to the new plan ids.
  A guard checks every tool call against the approved catalog, so the model
  cannot invent prices or plans.
- **Fix-it invoice (draft).** Turn the report's fixes into a draft PayPal
  invoice.
- **Shipgrade's own checkout.** A one-time **Deep Audit** (PayPal Orders v2)
  and a monthly **Shipgrade Watch** subscription, with server-side capture and
  verification and signature-verified webhooks.
- **Sandbox only.** The server refuses any `PAYPAL_ENVIRONMENT` other than
  `sandbox`. Without credentials, every PayPal surface shows a clear "not
  configured" state, and `PAYPAL_DRY_RUN=true` simulates the agent end to end.

## How it works

The server fetches the page and extracts the signals a product reviewer reads
first: the headline, meta description, headings, calls-to-action, social proof,
pricing, and the shape of the copy. A **deterministic scoring engine** turns
those signals into grades. No API key, no per-request cost, no rate limits.

An **optional LLM layer** sharpens the verdict, explains the checkout grade,
and drives the checkout agent's tool calls when an OpenAI-compatible API key is
present. The app is fully functional without it.

## Tech

- **Next.js 16** (App Router) + **React 19**
- **Tailwind CSS v4**
- **TypeScript**, **Vitest**
- **PayPal Agent Toolkit**, **PayPal JS SDK v6**, PayPal REST (Orders v2,
  Catalog Products, Subscriptions, Invoicing, Webhooks)
- Deployed on **Vercel**

## Local development

```bash
pnpm install
cp .env.example .env.local   # optional: AI key and PayPal sandbox credentials
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm test        # unit tests (PayPal is mocked)
pnpm typecheck
pnpm lint
pnpm build
```

### PayPal sandbox

1. Create a sandbox REST app at
   [developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)
   and put its client ID and secret in `.env.local` as `PAYPAL_CLIENT_ID` and
   `PAYPAL_CLIENT_SECRET`. Keep `PAYPAL_ENVIRONMENT=sandbox`.
2. Run `pnpm paypal:setup` once to create the Shipgrade Watch plan, and copy the
   printed `SHIPGRADE_WATCH_PLAN_ID` into `.env.local`.
3. Optional: add a webhook pointing at `/api/paypal/webhook` and set
   `PAYPAL_WEBHOOK_ID`.

No credentials yet? Set `PAYPAL_DRY_RUN=true` to try the agent with simulated
PayPal responses.

## License

[MIT](LICENSE)
