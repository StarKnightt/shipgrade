// Resolves the OpenAI-compatible endpoint used by every LLM call. Groq works
// either through OPENAI_* (with a Groq OPENAI_BASE_URL) or via GROQ_API_KEY
// alone; model defaults follow the provider so a Groq key never gets sent an
// OpenAI model name.

type Env = Record<string, string | undefined>;

export interface LlmConfig {
  provider: "openai" | "groq" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  agentModel: string;
}

const OPENAI_URL = "https://api.openai.com/v1";
const GROQ_URL = "https://api.groq.com/openai/v1";

const DEFAULTS = {
  openai: { model: "gpt-4o-mini", agentModel: "gpt-4o-mini" },
  // Separate models give the verdict and the agent separate Groq rate-limit buckets.
  groq: { model: "openai/gpt-oss-120b", agentModel: "qwen/qwen3.8-27b" },
} as const;

export function resolveLlm(env: Env = process.env): LlmConfig | null {
  const explicitKey = env.OPENAI_API_KEY?.trim();
  const groqKey = env.GROQ_API_KEY?.trim();
  const apiKey = explicitKey || groqKey;
  if (!apiKey) return null;

  const baseUrl = (env.OPENAI_BASE_URL?.trim() || (explicitKey ? OPENAI_URL : GROQ_URL)).replace(/\/+$/, "");
  const provider = /groq\.com/.test(baseUrl) ? "groq" : baseUrl === OPENAI_URL ? "openai" : "custom";
  const defaults = provider === "groq" ? DEFAULTS.groq : DEFAULTS.openai;
  const model = env.OPENAI_MODEL?.trim() || defaults.model;
  const agentModel = env.OPENAI_AGENT_MODEL?.trim() || env.OPENAI_MODEL?.trim() || defaults.agentModel;
  return { provider, apiKey, baseUrl, model, agentModel };
}
