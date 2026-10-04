import { describe, expect, it } from "vitest";
import { PayPalApiError, PayPalRest, captureOf } from "@/lib/paypal/rest";
import {
  ERROR_UNPROCESSABLE,
  ORDER_CREATED,
  SUBSCRIPTION_CREATED,
  TOKEN_RESPONSE,
  mockFetch,
  orderCaptured,
} from "../fixtures/paypal";

const creds = { clientId: "cid", clientSecret: "secret", apiBase: "https://api-m.sandbox.paypal.com" };

describe("PayPalRest", () => {
  it("fetches and caches an OAuth token, then creates an order", async () => {
    const { impl, calls } = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /\/v2\/checkout\/orders$/, method: "POST", status: 201, body: ORDER_CREATED },
    ]);
    const rest = new PayPalRest(creds, impl);
    const order = await rest.createOrder({ amount: "9.00", currency: "USD", description: "Deep Audit", customId: "deep-audit:x" });
    await rest.createOrder({ amount: "9.00", currency: "USD", description: "Deep Audit" });

    expect(order.id).toBe(ORDER_CREATED.id);
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    const auth = calls[0].headers.Authorization;
    expect(auth).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
    const create = calls[1];
    expect(create.headers.Authorization).toBe("Bearer A21AAMockToken");
    expect(create.body).toMatchObject({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: "9.00" }, custom_id: "deep-audit:x" }],
    });
  });

  it("surfaces PayPal error issue and debug id", async () => {
    const { impl } = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /capture$/, status: 422, body: ERROR_UNPROCESSABLE },
    ]);
    const rest = new PayPalRest(creds, impl);
    const err = await rest.captureOrder("5O190127TN364715T").catch((e) => e);
    expect(err).toBeInstanceOf(PayPalApiError);
    expect(err.message).toMatch(/INSTRUMENT_DECLINED/);
    expect(err.debugId).toBe("90957fca61718");
    expect(err.status).toBe(422);
  });

  it("rejects ids that could break the URL path", async () => {
    const rest = new PayPalRest(creds, mockFetch([]).impl);
    await expect(rest.captureOrder("../../v1/x")).rejects.toThrow(/Invalid PayPal id/);
  });

  it("reads the capture from a captured order", async () => {
    const { impl } = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /capture$/, status: 201, body: orderCaptured() },
    ]);
    const order = await new PayPalRest(creds, impl).captureOrder("5O190127TN364715T");
    expect(captureOf(order)?.id).toBe("3C679366HH908993F");
  });

  it("creates subscriptions with the plan id", async () => {
    const { impl, calls } = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /billing\/subscriptions$/, status: 201, body: SUBSCRIPTION_CREATED },
    ]);
    const sub = await new PayPalRest(creds, impl).createSubscription({ planId: "P-5ML4271244454362WXNWU5NQ" });
    expect(sub.status).toBe("APPROVAL_PENDING");
    expect(calls[1].body).toMatchObject({ plan_id: "P-5ML4271244454362WXNWU5NQ" });
  });

  it("verifies webhook signatures via PayPal and fails closed", async () => {
    const headers = {
      transmissionId: "t",
      transmissionTime: "2026-10-04T08:00:00Z",
      transmissionSig: "sig",
      certUrl: "https://api.sandbox.paypal.com/cert",
      authAlgo: "SHA256withRSA",
    };
    const ok = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /verify-webhook-signature/, body: { verification_status: "SUCCESS" } },
    ]);
    expect(await new PayPalRest(creds, ok.impl).verifyWebhookSignature(headers, '{"id":"WH-1"}', "WH-ID")).toBe(true);
    expect(ok.calls[1].body).toMatchObject({ webhook_id: "WH-ID", webhook_event: { id: "WH-1" } });

    const bad = mockFetch([
      { match: /oauth2\/token/, body: TOKEN_RESPONSE },
      { match: /verify-webhook-signature/, body: { verification_status: "FAILURE" } },
    ]);
    expect(await new PayPalRest(creds, bad.impl).verifyWebhookSignature(headers, "{}", "WH-ID")).toBe(false);
    expect(
      await new PayPalRest(creds, bad.impl).verifyWebhookSignature({ ...headers, transmissionSig: null }, "{}", "WH-ID"),
    ).toBe(false);
  });
});
