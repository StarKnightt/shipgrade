import { describe, expect, it, vi } from "vitest";
import { createChatClient, retryDelayMs } from "@/lib/paypal/chat";
import { compactTools, type ToolDefinition } from "@/lib/paypal/toolkit";

const headers = (h: Record<string, string> = {}) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const env = { GROQ_API_KEY: "test-key", OPENAI_MODEL: "openai/gpt-oss-20b" };

describe("retryDelayMs", () => {
  it("prefers retry-after, then the body hint, then a default", () => {
    expect(retryDelayMs({ headers: headers({ "retry-after": "3" }) }, "")).toBe(3250);
    expect(retryDelayMs({ headers: headers() }, "Please try again in 1.5s.")).toBe(1750);
    expect(retryDelayMs({ headers: headers() }, "Please try again in 420ms")).toBe(670);
    expect(retryDelayMs({ headers: headers() }, "")).toBe(2250);
  });

  it("gives up on waits too long to hold a request open", () => {
    expect(retryDelayMs({ headers: headers({ "retry-after": "60" }) }, "")).toBeNull();
  });
});

describe("createChatClient", () => {
  const ok = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "hi", tool_calls: [] } }] }), { status: 200 });
  const limited = () =>
    new Response(JSON.stringify({ error: { message: "Rate limit reached. Please try again in 10ms." } }), {
      status: 429,
    });

  it("retries a 429 and sends low reasoning effort for gpt-oss", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(limited()).mockResolvedValueOnce(ok());
    const client = createChatClient(env, fetchImpl as unknown as typeof fetch)!;
    const res = await client.complete([{ role: "user", content: "x" }]);
    expect(res.content).toBe("hi");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "openai/gpt-oss-20b", reasoning_effort: "low" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("surfaces the provider message after retries run out", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => limited());
    const client = createChatClient(env, fetchImpl as unknown as typeof fetch)!;
    await expect(client.complete([{ role: "user", content: "x" }])).rejects.toThrow(/429.*Rate limit reached/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("returns null without a key", () => {
    expect(createChatClient({})).toBeNull();
  });
});

describe("compactTools", () => {
  const tool = (name: string): ToolDefinition => ({
    type: "function",
    function: {
      name,
      description: "x".repeat(1000),
      parameters: {
        type: "object",
        properties: { amount: { type: "string", description: "long nested docs" } },
      },
    },
  });

  it("keeps only named tools and strips nested descriptions", () => {
    const out = compactTools([tool("create_product"), tool("create_refund")], ["create_product"]);
    expect(out.map((t) => t.function.name)).toEqual(["create_product"]);
    expect(out[0].function.description!.length).toBeLessThanOrEqual(400);
    expect(JSON.stringify(out[0].function.parameters)).not.toContain("long nested docs");
    expect(JSON.stringify(out[0].function.parameters)).toContain('"amount"');
  });
});
