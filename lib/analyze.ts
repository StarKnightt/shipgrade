// Shipgrade analyzer: deterministic, dependency-free product critique.
// Fetches a page, extracts the signals a product person would read in the
// first five seconds, and grades it across six dimensions.

export type DimensionKey =
  | "valueProp"
  | "audience"
  | "differentiation"
  | "cta"
  | "trust"
  | "craft";

export type FindingType = "win" | "fix";

export interface Finding {
  type: FindingType;
  text: string;
}

export interface DimensionResult {
  key: DimensionKey;
  label: string;
  blurb: string;
  score: number; // 0-100
  summary: string;
  findings: Finding[];
}

export interface AnalysisResult {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  title: string | null;
  description: string | null;
  overallScore: number;
  grade: string;
  band: "excellent" | "good" | "mixed" | "poor";
  verdict: string;
  roast: string | null;
  dimensions: DimensionResult[];
  meta: {
    wordCount: number;
    headingCount: number;
    usedLLM: boolean;
  };
}

const DIMENSION_META: Record<DimensionKey, { label: string; blurb: string }> = {
  valueProp: {
    label: "Value Proposition",
    blurb: "Can a stranger tell what this is in five seconds?",
  },
  audience: {
    label: "Audience Clarity",
    blurb: "Is it obvious who this is for?",
  },
  differentiation: {
    label: "Differentiation",
    blurb: "Does it say why you over the alternatives?",
  },
  cta: {
    label: "Call to Action",
    blurb: "Is there one clear next step?",
  },
  trust: {
    label: "Trust & Proof",
    blurb: "Is there any reason to believe you?",
  },
  craft: {
    label: "Messaging Craft",
    blurb: "Is the copy tight, or a wall of jargon?",
  },
};

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export function normalizeUrl(input: string): string {
  let url = input.trim();
  if (!url) throw new Error("Enter a URL to grade.");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) {
      throw new Error("That doesn't look like a real URL.");
    }
    return parsed.toString();
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }
}

interface FetchedPage {
  html: string;
  finalUrl: string;
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Shipgrade/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      throw new Error(
        `The page responded with ${res.status}. Is it public and live?`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      throw new Error("That URL didn't return a web page (no HTML found).");
    }
    const html = (await res.text()).slice(0, 1_500_000);
    return { html, finalUrl: res.url || url };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "AbortError") {
        throw new Error("The page took too long to respond (12s timeout).");
      }
      if (err.message.startsWith("The page") || err.message.startsWith("That")) {
        throw err;
      }
    }
    throw new Error("Couldn't reach that URL. Double-check it and try again.");
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getTagContents(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = stripTags(m[1]);
    if (text) out.push(text);
  }
  return out;
}

function getMeta(html: string, key: string): string | null {
  for (const attr of ["name", "property"]) {
    const re = new RegExp(`<meta\\b[^>]*${attr}=["']${key}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    if (tag) {
      const content = tag.match(/content=["']([\s\S]*?)["']/i)?.[1];
      if (content) return decodeEntities(content).replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

interface Extracted {
  title: string | null;
  description: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  links: string[];
  bodyText: string;
  wordCount: number;
  imageCount: number;
  hasForm: boolean;
}

export function extract(html: string): Extracted {
  const title =
    getTagContents(html, "title")[0] ??
    getMeta(html, "og:title") ??
    null;
  const description =
    getMeta(html, "description") ?? getMeta(html, "og:description") ?? null;
  const h1 = getTagContents(html, "h1");
  const h2 = getTagContents(html, "h2");
  const h3 = getTagContents(html, "h3");
  const links = [
    ...getTagContents(html, "a"),
    ...getTagContents(html, "button"),
  ].filter((t) => t.length < 60);
  const bodyText = stripTags(html);
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const hasForm = /<form\b/i.test(html) || /<input\b/i.test(html);
  return {
    title,
    description,
    h1,
    h2,
    h3,
    links,
    bodyText,
    wordCount,
    imageCount,
    hasForm,
  };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const BUZZWORDS = [
  "revolutionary",
  "seamless",
  "seamlessly",
  "cutting-edge",
  "cutting edge",
  "next-gen",
  "next generation",
  "synergy",
  "leverage",
  "empower",
  "unlock",
  "transform",
  "disrupt",
  "world-class",
  "best-in-class",
  "state-of-the-art",
  "game-changing",
  "game changer",
  "innovative",
  "robust",
  "holistic",
  "frictionless",
  "turnkey",
  "paradigm",
  "supercharge",
  "elevate",
  "reimagine",
];

function countMatches(haystack: string, needles: string[]): number {
  const lower = haystack.toLowerCase();
  let count = 0;
  for (const n of needles) {
    if (lower.includes(n)) count += 1;
  }
  return count;
}

function buildDimension(
  key: DimensionKey,
  score: number,
  findings: Finding[],
): DimensionResult {
  const s = clamp(score);
  const summary =
    s >= 80
      ? "Strong — this is working."
      : s >= 60
        ? "Decent, with room to sharpen."
        : s >= 40
          ? "Shaky. Worth a rewrite."
          : "This is costing you visitors.";
  return {
    key,
    label: DIMENSION_META[key].label,
    blurb: DIMENSION_META[key].blurb,
    score: s,
    summary,
    findings: findings.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// Individual scorers
// ---------------------------------------------------------------------------

function scoreValueProp(x: Extracted): DimensionResult {
  let score = 55;
  const findings: Finding[] = [];
  const h1 = x.h1[0];

  if (!h1) {
    score -= 35;
    findings.push({
      type: "fix",
      text: "No <h1> headline found. Visitors can't tell what this is at a glance — lead with one bold sentence that says what you do.",
    });
  } else {
    const words = h1.split(/\s+/).length;
    if (words >= 3 && words <= 12) {
      score += 18;
      findings.push({
        type: "win",
        text: `Your headline is a punchy ${words} words — easy to read in one breath.`,
      });
    } else if (words > 12) {
      score -= 12;
      findings.push({
        type: "fix",
        text: `Your headline runs ${words} words. Cut it to under 12 — a hero line should be a hook, not a paragraph.`,
      });
    } else {
      score -= 6;
      findings.push({
        type: "fix",
        text: "Your headline is very short. Make sure it actually states the value, not just a brand word.",
      });
    }

    const buzz = countMatches(h1, BUZZWORDS);
    if (buzz >= 2) {
      score -= 16;
      findings.push({
        type: "fix",
        text: "Your headline leans on buzzwords but never says what the product concretely does. Swap 'seamless / revolutionary' for the real outcome.",
      });
    }
  }

  if (x.description && x.description.length > 20) {
    score += 12;
  } else {
    score -= 10;
    findings.push({
      type: "fix",
      text: "No meta description. That's the line Google and social shares show — write one clear sentence about what you do.",
    });
  }

  if (x.h2.length >= 2 && x.h2.length <= 8) {
    score += 8;
  }

  if (findings.length === 0) {
    findings.push({
      type: "win",
      text: "The page communicates its purpose quickly and cleanly.",
    });
  }
  return buildDimension("valueProp", score, findings);
}

function scoreAudience(x: Extracted): DimensionResult {
  let score = 48;
  const findings: Finding[] = [];
  const corpus = [x.title, x.description, ...x.h1, ...x.h2]
    .filter(Boolean)
    .join(" ");

  const audienceMarkers = [
    "for teams",
    "for developers",
    "for engineers",
    "for designers",
    "for marketers",
    "for product",
    "for startups",
    "for founders",
    "for businesses",
    "for agencies",
    "for creators",
    "for sales",
    "for finance",
    "for hr",
    "for students",
    "built for",
    "designed for",
    "made for",
    "for small business",
  ];
  const markerHits = countMatches(corpus, audienceMarkers);
  if (markerHits > 0) {
    score += 28;
    findings.push({
      type: "win",
      text: "You name who this is for. Spelling out the audience makes the right person feel instantly seen.",
    });
  } else {
    score -= 14;
    findings.push({
      type: "fix",
      text: "The copy never says who this is for. 'Built for [specific role]' beats 'for everyone' every time — name your person.",
    });
  }

  const youHits = countMatches(corpus, ["you", "your", "you're"]);
  if (youHits >= 2) {
    score += 16;
  } else {
    score -= 6;
    findings.push({
      type: "fix",
      text: "Talk to the reader directly. Second person ('you / your') outperforms describing yourself in the third person.",
    });
  }

  if (findings.length === 0) {
    findings.push({
      type: "win",
      text: "It's clear who should care about this.",
    });
  }
  return buildDimension("audience", score, findings);
}

function scoreDifferentiation(x: Extracted): DimensionResult {
  let score = 50;
  const findings: Finding[] = [];
  const corpus = [x.title, x.description, ...x.h1, ...x.h2, ...x.h3]
    .filter(Boolean)
    .join(" ");

  const diffMarkers = [
    "unlike",
    "the only",
    "first",
    "without the",
    "no more",
    "faster than",
    "compared to",
    "vs ",
    "versus",
    "what makes",
    "why we",
    "10x",
    "2x",
    "5x",
    "instead of",
  ];
  const hits = countMatches(corpus, diffMarkers);
  const hasNumbers = /\b\d{2,}%|\b\d+x\b|\$\d|\b\d{3,}\b/.test(corpus);

  if (hits >= 1) {
    score += 22;
    findings.push({
      type: "win",
      text: "You position against alternatives. Contrast ('unlike X…') is one of the fastest ways to feel different.",
    });
  } else {
    score -= 14;
    findings.push({
      type: "fix",
      text: "Nothing says why you over the obvious alternative. Add one sharp contrast line — 'Unlike spreadsheets, …'.",
    });
  }

  if (hasNumbers) {
    score += 14;
    findings.push({
      type: "win",
      text: "Concrete numbers show up in your copy — specificity reads as credibility.",
    });
  } else {
    score -= 8;
    findings.push({
      type: "fix",
      text: "No specifics or numbers. '10x faster' or 'in under 60 seconds' lands harder than 'fast and powerful'.",
    });
  }

  return buildDimension("differentiation", score, findings);
}

function scoreCta(x: Extracted): DimensionResult {
  let score = 50;
  const findings: Finding[] = [];
  const ctaPhrases = [
    "get started",
    "start free",
    "start now",
    "sign up",
    "signup",
    "try it",
    "try for free",
    "try free",
    "book a demo",
    "request a demo",
    "get a demo",
    "request access",
    "download",
    "buy now",
    "subscribe",
    "join",
    "contact sales",
    "create account",
    "get early access",
    "join waitlist",
    "start building",
    "add to cart",
  ];
  const linkText = x.links.join(" | ").toLowerCase();
  const ctaHits = ctaPhrases.filter((p) => linkText.includes(p));

  if (ctaHits.length === 0) {
    score -= 28;
    findings.push({
      type: "fix",
      text: "No clear call-to-action found. What do you want visitors to do next? Make one obvious primary button.",
    });
  } else if (ctaHits.length <= 3) {
    score += 26;
    findings.push({
      type: "win",
      text: `Clear next step detected ("${ctaHits[0]}"). A single obvious action beats a page full of links.`,
    });
  } else {
    score += 8;
    findings.push({
      type: "fix",
      text: `You have several competing CTAs (${ctaHits.length}). Pick one primary action and make the rest secondary.`,
    });
  }

  if (x.hasForm) {
    score += 10;
  }

  return buildDimension("cta", score, findings);
}

function scoreTrust(x: Extracted): DimensionResult {
  let score = 45;
  const findings: Finding[] = [];
  const corpus = x.bodyText.toLowerCase();

  const trustMarkers = [
    "trusted by",
    "testimonial",
    "reviews",
    "rating",
    "stars",
    "g2",
    "soc 2",
    "soc2",
    "gdpr",
    "iso 27001",
    "hipaa",
    "guarantee",
    "money-back",
    "as featured",
    "as seen",
    "case study",
    "case studies",
    "loved by",
    "used by",
    "join thousands",
    "join millions",
    "backed by",
    "customers",
    "5-star",
  ];
  const hits = countMatches(corpus, trustMarkers);
  const hasSocialNumbers = /\b\d[\d,]{2,}\+?\s?(users|customers|teams|companies|developers|downloads)/i.test(
    x.bodyText,
  );

  if (hits >= 2 || hasSocialNumbers) {
    score += 30;
    findings.push({
      type: "win",
      text: "There's social proof on the page. Testimonials, logos, and real numbers do the convincing for you.",
    });
  } else if (hits === 1) {
    score += 8;
    findings.push({
      type: "fix",
      text: "A hint of social proof, but thin. Add a customer logo row or one specific testimonial with a name and role.",
    });
  } else {
    score -= 16;
    findings.push({
      type: "fix",
      text: "No social proof anywhere. Even one real testimonial or a 'trusted by' row builds instant credibility.",
    });
  }

  return buildDimension("trust", score, findings);
}

function scoreCraft(x: Extracted): DimensionResult {
  let score = 60;
  const findings: Finding[] = [];

  if (!x.title) {
    score -= 18;
    findings.push({
      type: "fix",
      text: "Missing <title> tag — the browser tab and search result have nothing to show.",
    });
  } else if (x.title.length > 65) {
    score -= 6;
    findings.push({
      type: "fix",
      text: `Your page title is ${x.title.length} characters; it'll get truncated in search. Aim for under 60.`,
    });
  }

  if (x.description) {
    const len = x.description.length;
    if (len >= 50 && len <= 160) {
      score += 12;
      findings.push({
        type: "win",
        text: "Meta description is a well-sized, share-ready sentence.",
      });
    } else if (len > 160) {
      score -= 6;
      findings.push({
        type: "fix",
        text: "Your meta description is too long and will be cut off. Trim it to ~155 characters.",
      });
    }
  }

  const buzz = countMatches(x.bodyText, BUZZWORDS);
  if (buzz >= 5) {
    score -= 16;
    findings.push({
      type: "fix",
      text: `The page is heavy on buzzwords (${buzz} spotted). Trade abstract hype for concrete, human language.`,
    });
  } else if (buzz <= 1) {
    score += 8;
  }

  if (x.wordCount > 0 && x.wordCount < 60) {
    score -= 10;
    findings.push({
      type: "fix",
      text: "There's very little copy here. Give visitors enough to understand and trust what you've built.",
    });
  }

  if (x.h1.length > 1) {
    score -= 8;
    findings.push({
      type: "fix",
      text: `Multiple <h1> tags (${x.h1.length}). Use exactly one top-level headline so the hierarchy is clear.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      type: "win",
      text: "Clean structure and tight copy — the fundamentals are in place.",
    });
  }
  return buildDimension("craft", score, findings);
}

// ---------------------------------------------------------------------------
// Grade + verdict
// ---------------------------------------------------------------------------

function gradeFromScore(score: number): {
  grade: string;
  band: AnalysisResult["band"];
} {
  if (score >= 90) return { grade: "A+", band: "excellent" };
  if (score >= 85) return { grade: "A", band: "excellent" };
  if (score >= 80) return { grade: "A-", band: "excellent" };
  if (score >= 75) return { grade: "B+", band: "good" };
  if (score >= 70) return { grade: "B", band: "good" };
  if (score >= 65) return { grade: "B-", band: "good" };
  if (score >= 60) return { grade: "C+", band: "mixed" };
  if (score >= 55) return { grade: "C", band: "mixed" };
  if (score >= 50) return { grade: "C-", band: "mixed" };
  if (score >= 45) return { grade: "D+", band: "poor" };
  if (score >= 40) return { grade: "D", band: "poor" };
  return { grade: "F", band: "poor" };
}

const VERDICTS: Record<AnalysisResult["band"], string> = {
  excellent:
    "Sharp. A stranger lands here and gets it in five seconds — that's the whole game.",
  good: "There's a real product here. Tighten a couple of things and it sings.",
  mixed:
    "The bones are good, but the message is hiding. Right now visitors have to work to understand you.",
  poor: "Right now this ships vibes, not value. The good news: every fix below is quick.",
};

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export function scoreExtracted(
  x: Extracted,
  source: { url: string; finalUrl: string },
): AnalysisResult {
  const dimensions = [
    scoreValueProp(x),
    scoreAudience(x),
    scoreDifferentiation(x),
    scoreCta(x),
    scoreTrust(x),
    scoreCraft(x),
  ];

  const overallScore = clamp(
    dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length,
  );
  const { grade, band } = gradeFromScore(overallScore);

  return {
    url: source.url,
    finalUrl: source.finalUrl,
    fetchedAt: new Date().toISOString(),
    title: x.title,
    description: x.description,
    overallScore,
    grade,
    band,
    verdict: VERDICTS[band],
    roast: null,
    dimensions,
    meta: {
      wordCount: x.wordCount,
      headingCount: x.h1.length + x.h2.length + x.h3.length,
      usedLLM: false,
    },
  };
}

export async function analyzeUrl(input: string): Promise<AnalysisResult> {
  const url = normalizeUrl(input);
  const { html, finalUrl } = await fetchPage(url);
  const extracted = extract(html);
  return scoreExtracted(extracted, { url, finalUrl });
}
