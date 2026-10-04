// OpenAI-compatible Chat Completions client with tool calling. Uses the same
// OPENAI_* env vars as the verdict layer (lib/llm.ts), so Groq, OpenAI, or any
// compatible endpoint works. Injectable for tests.

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

export function createChatClient(env: Record<string, string | undefined> = process.env): ChatClient | null {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = env.OPENAI_AGENT_MODEL ?? env.OPENAI_MODEL ?? "gpt-4o-mini";
  return {
    model,
    async complete(messages, opts = {}) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25_000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: opts.temperature ?? 0.2,
            messages,
            ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
            ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          }),
        });
        if (!res.ok) throw new Error(`LLM request failed (${res.status})`);
        const data = await res.json();
        const msg = data?.choices?.[0]?.message ?? {};
        return { content: msg.content ?? null, toolCalls: (msg.tool_calls as ToolCall[]) ?? [] };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
