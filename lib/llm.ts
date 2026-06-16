// Optional LLM enhancement. Completely env-gated: with no API key the app
// runs on deterministic heuristics alone. With a key, we layer a sharper,
// human verdict and a one-line roast on top. Any failure degrades silently.

import type { AnalysisResult } from "./analyze";

export interface LlmEnhancement {
  verdict: string;
  roast: string;
}

interface LlmInput {
  url: string;
  title: string | null;
  description: string | null;
  grade: string;
  overallScore: number;
  weakest: { label: string; score: number };
  strongest: { label: string; score: number };
}

export function isLlmEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function enhanceWithLlm(
  result: AnalysisResult,
): Promise<LlmEnhancement | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const sorted = [...result.dimensions].sort((a, b) => a.score - b.score);
  const input: LlmInput = {
    url: result.finalUrl,
    title: result.title,
    description: result.description,
    grade: result.grade,
    overallScore: result.overallScore,
    weakest: { label: sorted[0].label, score: sorted[0].score },
    strongest: {
      label: sorted[sorted.length - 1].label,
      score: sorted[sorted.length - 1].score,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a sharp, witty product leader reviewing a landing page. " +
              "You are honest but never cruel, and always specific. " +
              "Respond ONLY with JSON: {\"verdict\": string, \"roast\": string}. " +
              "verdict: one punchy sentence (max 22 words) summarizing the page's product clarity. " +
              "roast: one funny-but-fair line (max 22 words) a founder would screenshot and share.",
          },
          {
            role: "user",
            content: JSON.stringify(input),
          },
        ],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as Partial<LlmEnhancement>;
    if (!parsed.verdict || !parsed.roast) return null;

    return {
      verdict: String(parsed.verdict).slice(0, 240),
      roast: String(parsed.roast).slice(0, 240),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
