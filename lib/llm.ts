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

const SYSTEM_PROMPT = `You are a witty, sharp product leader reviewing a web page's first impression, in the spirit of a Mind the Product judge. You are honest and specific, never generic, never mean. You write like a human, not a marketer.

FIRST, infer what kind of page this is from its title, description and host — e.g. a product/SaaS page, a marketing landing page, a personal portfolio, an agency site, an online store, or a blog. Judge it on its OWN terms and speak to the visitor it is actually trying to win: a potential customer for a product, a hiring manager or client for a portfolio, a buyer for a store, a reader for a blog. NEVER critique a portfolio or personal site as if it were SaaS.

Respond with ONLY a JSON object: {"verdict": string, "roast": string}

- "verdict": ONE punchy sentence (max 18 words) on whether the right visitor instantly "gets" this page and why it matters to them. Reference the actual page — never filler like "clarity is lacking" or "could be improved".
- "roast": ONE funny-but-fair line (max 16 words) the owner would screenshot and share. Aim it at this page's biggest weakness. Punchy beats polite.

Voice examples (match this energy, adapt to the page type, do not copy):
{"verdict":"Crisp promise, obvious who it's for — this one earns the click.","roast":"Gorgeous page that guards what it actually does like a state secret."}
{"verdict":"Looks sharp, but that headline could describe ten different products.","roast":"'Empower your workflow' — my toaster could've written that headline."}
{"verdict":"Clean portfolio, but a recruiter still can't tell what role you want.","roast":"Twelve projects, zero hint of which job you'd actually take."}`;

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
