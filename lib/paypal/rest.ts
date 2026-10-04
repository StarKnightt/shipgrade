// Minimal typed PayPal REST client for Shipgrade's own checkout:
// OAuth, Orders v2, Subscriptions, catalog setup, and webhook verification.
// `fetch` is injectable so tests can replay mocked PayPal responses.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RestCredentials {
  clientId: string;
  clientSecret: string;
  apiBase: string;
}

export class PayPalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalApiError";
  }
}

export interface Money {
  currency_code: string;
  value: string;
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface OrderResponse {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: {
    custom_id?: string;
    description?: string;
    amount?: Money;
    payments?: { captures?: { id: string; status: string; amount: Money }[] };
  }[];
}

export interface SubscriptionResponse {
  id: string;
  status: string;
  plan_id?: string;
  custom_id?: string;
  links?: PayPalLink[];
}

export interface ProductResponse {
  id: string;
  name: string;
}

export interface PlanResponse {
  id: string;
  product_id: string;
  name: string;
  status: string;
}

export interface CreateOrderInput {
  amount: string;
  currency: string;
  description: string;
  customId?: string;
  brandName?: string;
  requestId?: string;
}

export interface CreateSubscriptionInput {
  planId: string;
  customId?: string;
  brandName?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

export interface WebhookHeaders {
  transmissionId: string | null;
  transmissionTime: string | null;
  transmissionSig: string | null;
  certUrl: string | null;
  authAlgo: string | null;
}

export function webhookHeadersFrom(headers: Headers): WebhookHeaders {
  return {
    transmissionId: headers.get("paypal-transmission-id"),
    transmissionTime: headers.get("paypal-transmission-time"),
    transmissionSig: headers.get("paypal-transmission-sig"),
    certUrl: headers.get("paypal-cert-url"),
    authAlgo: headers.get("paypal-auth-algo"),
  };
}

export class PayPalRest {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly creds: RestCredentials,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.creds.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new PayPalApiError(
        `PayPal auth failed: ${data.error_description ?? res.status}`,
        res.status,
        res.headers.get("paypal-debug-id"),
        data,
      );
    }
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 300) * 1000,
    };
    return data.access_token;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    opts: { requestId?: string; prefer?: "return=representation" | "return=minimal" } = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    if (opts.prefer) headers.Prefer = opts.prefer;
    const res = await this.fetchImpl(`${this.creds.apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const detail = (data.details as { issue?: string; description?: string }[] | undefined)?.[0];
      throw new PayPalApiError(
        `PayPal ${method} ${path} failed (${res.status}): ${detail?.issue ?? data.name ?? "error"}${
          detail?.description ? ` - ${detail.description}` : ""
        }`,
        res.status,
        (data.debug_id as string) ?? res.headers.get("paypal-debug-id"),
        data,
      );
    }
    return data as T;
  }

  createOrder(input: CreateOrderInput): Promise<OrderResponse> {
    return this.request<OrderResponse>(
      "POST",
      "/v2/checkout/orders",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            description: input.description.slice(0, 127),
            custom_id: input.customId?.slice(0, 127),
            amount: { currency_code: input.currency, value: input.amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: input.brandName,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      },
      { requestId: input.requestId, prefer: "return=representation" },
    );
  }

  async captureOrder(orderId: string): Promise<OrderResponse> {
    assertId(orderId);
    return this.request<OrderResponse>("POST", `/v2/checkout/orders/${orderId}/capture`, {}, {
      prefer: "return=representation",
    });
  }

  async getOrder(orderId: string): Promise<OrderResponse> {
    assertId(orderId);
    return this.request<OrderResponse>("GET", `/v2/checkout/orders/${orderId}`);
  }

  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionResponse> {
    return this.request<SubscriptionResponse>("POST", "/v1/billing/subscriptions", {
      plan_id: input.planId,
      custom_id: input.customId?.slice(0, 127),
      application_context: {
        brand_name: input.brandName,
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    });
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionResponse> {
    assertId(subscriptionId);
    return this.request<SubscriptionResponse>("GET", `/v1/billing/subscriptions/${subscriptionId}`);
  }

  createProduct(input: { name: string; description?: string; type?: "SERVICE" | "DIGITAL"; homeUrl?: string }) {
    return this.request<ProductResponse>("POST", "/v1/catalogs/products", {
      name: input.name,
      description: input.description,
      type: input.type ?? "SERVICE",
      category: "SOFTWARE",
      home_url: input.homeUrl,
    });
  }

  createMonthlyPlan(input: { productId: string; name: string; price: string; currency: string; description?: string }) {
    return this.request<PlanResponse>("POST", "/v1/billing/plans", {
      product_id: input.productId,
      name: input.name,
      description: input.description,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: input.price, currency_code: input.currency } },
        },
      ],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
    });
  }

  /** Verify a webhook via PayPal's verify-webhook-signature endpoint. */
  async verifyWebhookSignature(
    headers: WebhookHeaders,
    rawBody: string,
    webhookId: string,
  ): Promise<boolean> {
    if (Object.values(headers).some((v) => !v)) return false;
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return false;
    }
    const data = await this.request<{ verification_status?: string }>(
      "POST",
      "/v1/notifications/verify-webhook-signature",
      {
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      },
    );
    return data.verification_status === "SUCCESS";
  }
}

function assertId(id: string) {
  if (!/^[A-Z0-9-]{6,64}$/i.test(id)) throw new PayPalApiError("Invalid PayPal id", 400, null, { id });
}

export function captureOf(order: OrderResponse) {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}
