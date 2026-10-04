// Mocked PayPal sandbox responses, shaped after developer.paypal.com examples.

export const TOKEN_RESPONSE = {
  scope: "https://uri.paypal.com/services/invoicing",
  access_token: "A21AAMockToken",
  token_type: "Bearer",
  app_id: "APP-80W284485P519543T",
  expires_in: 32400,
  nonce: "2026-10-04T08:00:00Zmock",
};

export const ORDER_CREATED = {
  id: "5O190127TN364715T",
  status: "PAYER_ACTION_REQUIRED",
  payment_source: { paypal: {} },
  links: [
    { href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T", rel: "self", method: "GET" },
    { href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T", rel: "payer-action", method: "GET" },
  ],
};

export const orderCaptured = (value = "9.00", customId = "deep-audit:acme.dev") => ({
  id: "5O190127TN364715T",
  status: "COMPLETED",
  purchase_units: [
    {
      reference_id: "default",
      custom_id: customId,
      payments: {
        captures: [
          {
            id: "3C679366HH908993F",
            status: "COMPLETED",
            amount: { currency_code: "USD", value },
          },
        ],
      },
    },
  ],
});

export const SUBSCRIPTION_CREATED = {
  id: "I-BW452GLLEP1G",
  status: "APPROVAL_PENDING",
  plan_id: "P-5ML4271244454362WXNWU5NQ",
  links: [{ href: "https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-2M539689T3856352J", rel: "approve", method: "GET" }],
};

export const PRODUCT_CREATED = { id: "PROD-XXCD1234QWER65782", name: "Acme Notes", type: "SERVICE" };
export const PLAN_CREATED = { id: "P-5ML4271244454362WXNWU5NQ", product_id: PRODUCT_CREATED.id, name: "Pro", status: "ACTIVE" };

export const ERROR_UNPROCESSABLE = {
  name: "UNPROCESSABLE_ENTITY",
  details: [{ issue: "INSTRUMENT_DECLINED", description: "The instrument presented was either declined by the processor or bank." }],
  message: "The requested action could not be performed.",
  debug_id: "90957fca61718",
};

export const WEBHOOK_CAPTURE_COMPLETED = {
  id: "WH-58D329510W468432D-8HN650336L201105X",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  resource_type: "capture",
  resource: {
    id: "3C679366HH908993F",
    status: "COMPLETED",
    custom_id: "deep-audit:acme.dev",
    amount: { currency_code: "USD", value: "9.00" },
    supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
  },
};

export type MockRoute = { match: RegExp; method?: string; status?: number; body: unknown };

/** A fetch mock that replays PayPal responses and records requests. */
export function mockFetch(routes: MockRoute[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const raw = init?.body;
    let body: unknown = raw;
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const route = routes.find((r) => r.match.test(url) && (!r.method || r.method === method));
    if (!route) return new Response(JSON.stringify({ name: "NOT_FOUND" }), { status: 404 });
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json", "paypal-debug-id": "mockdebug" },
    });
  };
  return { impl, calls };
}
