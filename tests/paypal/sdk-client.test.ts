import { describe, expect, it, vi } from "vitest";
import { createSubscriptionSession, type PayPalInstance } from "@/lib/paypal/sdk-client";
const base = {
  findEligibleMethods: vi.fn(),
  createPayPalOneTimePaymentSession: vi.fn(),
};

describe("createSubscriptionSession", () => {
  it("uses createPayPalSubscriptionPaymentSession, the name the live v6 SDK exposes", () => {
    const session = { start: vi.fn() };
    const factory = vi.fn().mockReturnValue(session);
    const instance = { ...base, createPayPalSubscriptionPaymentSession: factory } as unknown as PayPalInstance;
    const callbacks = { onApprove: vi.fn() };
    expect(createSubscriptionSession(instance, callbacks)).toBe(session);
    expect(factory).toHaveBeenCalledWith(callbacks);
  });

  it("fails clearly when the SDK build lacks subscriptions", () => {
    expect(() => createSubscriptionSession(base as unknown as PayPalInstance, { onApprove: vi.fn() })).toThrow(
      /no subscription session/,
    );
  });
});
