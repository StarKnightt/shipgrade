import { describe, expect, it } from "vitest";
import { publicStatus, readPayPalConfig, requirePayPal, SANDBOX_API_BASE } from "@/lib/paypal/config";

describe("readPayPalConfig", () => {
  it("is unconfigured with no env and lists what is missing", () => {
    const cfg = readPayPalConfig({});
    expect(cfg.configured).toBe(false);
    if (!cfg.configured) {
      expect(cfg.missing).toEqual(["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"]);
      expect(cfg.reason).toMatch(/sandbox not configured/i);
    }
    expect(() => requirePayPal(cfg)).toThrow(/not configured/i);
  });

  it("refuses live mode even with credentials", () => {
    const cfg = readPayPalConfig({
      PAYPAL_ENVIRONMENT: "live",
      PAYPAL_CLIENT_ID: "id",
      PAYPAL_CLIENT_SECRET: "secret",
    });
    expect(cfg.configured).toBe(false);
    if (!cfg.configured) expect(cfg.reason).toMatch(/only runs against the PayPal sandbox/);
  });

  it("reads a full sandbox config with typed offers", () => {
    const cfg = readPayPalConfig({
      PAYPAL_CLIENT_ID: " id ",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_WEBHOOK_ID: "WH-1",
      SHIPGRADE_DEEP_AUDIT_PRICE: "12",
      SHIPGRADE_WATCH_PLAN_ID: "P-123",
      PAYPAL_DRY_RUN: "true",
    });
    expect(cfg.configured).toBe(true);
    if (cfg.configured) {
      expect(cfg.clientId).toBe("id");
      expect(cfg.apiBase).toBe(SANDBOX_API_BASE);
      expect(cfg.offers.deepAuditPrice).toBe("12.00");
      expect(cfg.offers.watchPrice).toBe("19.00");
      expect(cfg.dryRun).toBe(true);
    }
  });

  it("never exposes the secret publicly", () => {
    const status = publicStatus(
      readPayPalConfig({ PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "top-secret" }),
    );
    expect(JSON.stringify(status)).not.toContain("top-secret");
    expect(status.clientId).toBe("id");
    expect(status.offers.watch.enabled).toBe(false);
    expect(status.offers.deepAudit.enabled).toBe(true);
  });
});
