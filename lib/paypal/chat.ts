// OpenAI-compatible Chat Completions client with tool calling. Uses the same
// OPENAI_* env vars as the verdict layer (lib/llm.ts), so Groq, OpenAI, or any
// compatible endpoint works. Injectable for tests.

import { resolveLlm } from "../llm-config";
import type { ToolDefinition } from "./toolkit";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

export interface ChatClient {
  readonly model: string;
  complete(
    messages: ChatMessage[],
    opts?: { tools?: ToolDefinition[]; json?: boolean; temperature?: number },
  ): Promise<ChatResult>;
}

export function createChatClient(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): ChatClient | null {
  const llm = resolveLlm(env);
  if (!llm) return null;
  const { apiKey, baseUrl, agentModel: model } = llm;
  // gpt-oss spends hidden reasoning tokens; on Groq's per-minute token budget
  // that's the difference between finishing the tool loop and a 429.
  const extra = /gpt-oss/.test(model) ? { reasoning_effort: "low", max_completion_tokens: 2048 } : {};
  return {
    model,
    async complete(messages, opts = {}) {
      const body = JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.2,
        ...extra,
        messages,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      });
      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25_000);
        try {
          const res = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body,
          });
          if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
            const wait = retryDelayMs(res, await res.text().catch(() => ""));
            if (wait !== null) {
              await sleep(wait);
              continue;
            }
          }
          if (!res.ok) {
            const detail = (await res.text().catch(() => "")).match(/"message"\s*:\s*"([^"]{0,160})/)?.[1];
            throw new Error(`LLM request failed (${res.status})${detail ? `: ${detail}` : ""}`);
          }
          const data = await res.json();
          const msg = data?.choices?.[0]?.message ?? {};
          return { content: msg.content ?? null, toolCalls: (msg.tool_calls as ToolCall[]) ?? [] };
        } finally {
          clearTimeout(timeout);
        }
      }
    },
  };
}

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a 429 asks us to wait, or null if it's too long to wait inline. */
export function retryDelayMs(res: { headers: { get(name: string): string | null } }, body: string): number | null {
  const header = Number(res.headers.get("retry-after"));
  const hinted = body.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  const ms = Number.isFinite(header) && header > 0
    ? header * 1000
    : hinted
      ? Number(hinted[1]) * (hinted[2].toLowerCase() === "ms" ? 1 : 1000)
      : 2_000;
  const padded = Math.ceil(ms) + 250;
  return padded <= MAX_RATE_LIMIT_WAIT_MS ? padded : null;
}
