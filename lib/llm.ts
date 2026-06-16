// Optional LLM enhancement. Completely env-gated: with no API key the app
// runs on deterministic heuristics alone. With a key, we layer a sharper,
// human verdict and a one-line roast on top. Any failure degrades silently.

import type { AnalysisResult } from "./analyze";

export interface LlmEnhancement {
  verdict: string;
  roast: string;
}

interface LlmInput {
  site: string;
  title: string | null;
  description: string | null;
  grade: string;
  overallScore: number;
  scores: Record<string, number>;
  biggestWeakness: { area: string; issue: string };
}

export function isLlmEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const SYSTEM_PROMPT = `You are a witty, sharp product leader reviewing the first impression of a product or SaaS landing page, in the spirit of a Mind the Product judge. You're honest and specific, never generic, never mean. You write like a human, not a marketer.

Judge the page the way a potential customer would on their first visit: in five seconds, can they tell what it is, who it's for, and why it beats the alternatives? Speak to that buyer, and always point at the actual page, never filler like "clarity is lacking" or "could be improved".

Respond with ONLY a JSON object: {"verdict": string, "roast": string}

- "verdict": ONE punchy sentence (max 18 words) on whether a first-time visitor instantly gets this product and why it matters to them.
- "roast": ONE funny-but-fair line (max 16 words) the founder would screenshot and share, aimed at the page's biggest weakness. Punchy beats polite.

Voice examples (match this energy, do not copy):
{"verdict":"Crisp promise, obvious who it's for, this one earns the click.","roast":"Gorgeous page that guards what it actually does like a state secret."}
{"verdict":"Looks sharp, but that headline could describe ten different products.","roast":"'Empower your workflow', my toaster could've written that headline."}
{"verdict":"Clear what it does, but nothing says why you over the incumbent.","roast":"Five testimonials, zero numbers, all vibes and no receipts."}`;

export async function enhanceWithLlm(
  result: AnalysisResult,
): Promise<LlmEnhancement | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const weakest = [...result.dimensions].sort((a, b) => a.score - b.score)[0];
  const issue =
    weakest.findings.find((f) => f.type === "fix")?.text ?? weakest.summary;
  const scores: Record<string, number> = {};
  for (const d of result.dimensions) scores[d.label] = d.score;

  const input: LlmInput = {
    site: hostFromUrl(result.finalUrl),
    title: result.title,
    description: result.description,
    grade: result.grade,
    overallScore: result.overallScore,
    scores,
    biggestWeakness: { area: weakest.label, issue },
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
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
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
