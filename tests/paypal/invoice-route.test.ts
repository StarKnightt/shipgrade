import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();

vi.mock("@/lib/paypal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paypal/server")>();
  return { ...actual, agentExecutor: vi.fn(async () => ({ simulated: false, tools: () => [], call })) };
});

const { POST } = await import("@/app/api/agent/invoice/route");

const request = () =>
  new Request("http://localhost/api/agent/invoice", {
    method: "POST",
    body: JSON.stringify({ site: "acme.dev", email: "buyer@example.com", fixes: [{ title: "Add PayPal", hours: 2 }] }),
  });

describe("POST /api/agent/invoice", () => {
  beforeEach(() => call.mockReset());

  it("returns the draft invoice", async () => {
    call.mockResolvedValue({ id: "INV2-AAAA", status: "DRAFT" });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "draft", invoice: { id: "INV2-AAAA" } });
  });

  it("surfaces a toolkit failure instead of calling it a draft", async () => {
    call.mockResolvedValue({ ok: false, status: 403, message: "Authorization failed due to insufficient permissions." });
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Invoicing permission/);
  });
});
