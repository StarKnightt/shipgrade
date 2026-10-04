import { describe, expect, it } from "vitest";
import { resolveLlm } from "@/lib/llm-config";

describe("resolveLlm", () => {
  it("is off without any key", () => {
    expect(resolveLlm({})).toBeNull();
  });

  it("defaults to OpenAI with an OpenAI key", () => {
    expect(resolveLlm({ OPENAI_API_KEY: "sk" })).toMatchObject({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
  });

  it("uses Groq models when the base URL points at Groq", () => {
    const cfg = resolveLlm({ OPENAI_API_KEY: "gsk", OPENAI_BASE_URL: "https://api.groq.com/openai/v1/" });
    expect(cfg).toMatchObject({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1" });
    expect(cfg?.model).not.toMatch(/^gpt-4o/);
  });

  it("works with GROQ_API_KEY alone", () => {
    expect(resolveLlm({ GROQ_API_KEY: "gsk" })).toMatchObject({
      provider: "groq",
      apiKey: "gsk",
      baseUrl: "https://api.groq.com/openai/v1",
    });
  });

  it("lets explicit models win, agent model falling back to OPENAI_MODEL", () => {
    const cfg = resolveLlm({ GROQ_API_KEY: "gsk", OPENAI_MODEL: "m1" });
    expect(cfg).toMatchObject({ model: "m1", agentModel: "m1" });
    expect(resolveLlm({ GROQ_API_KEY: "gsk", OPENAI_MODEL: "m1", OPENAI_AGENT_MODEL: "m2" })?.agentModel).toBe("m2");
  });
});
