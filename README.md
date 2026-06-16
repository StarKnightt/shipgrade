# Shipgrade

**Grade your product page before your users do.**

Paste any product URL and get a ruthless, specific, dimension-by-dimension
product critique in about 30 seconds — the same questions a sharp product
reviewer would ask in the first five seconds.

Built for **World Product Day 2026 — Everyone Ships Now**. Measured with
**Novus**.

## What it grades

Shipgrade scores six dimensions that decide whether a stranger "gets it":

| Dimension | The question it answers |
| --- | --- |
| **Value Proposition** | Can a stranger tell what this is in five seconds? |
| **Audience Clarity** | Is it obvious who this is for? |
| **Differentiation** | Does it say why you over the alternatives? |
| **Call to Action** | Is there one clear next step? |
| **Trust & Proof** | Is there any reason to believe you? |
| **Messaging Craft** | Is the copy tight, or a wall of jargon? |

Each dimension gets a 0–100 score and specific, actionable findings — wins to
keep and fixes to make. The six roll up into an overall grade (A+ to F).

## How it works

The server fetches the page and extracts the signals a product reviewer reads
first: the headline, meta description, headings, calls-to-action, social proof,
and the shape of the copy. A **deterministic scoring engine** turns those
signals into grades — no API key, no per-request cost, no rate limits.

An **optional LLM layer** sharpens the verdict and adds a shareable one-liner
when an OpenAI-compatible API key is present. The app is fully functional
without it.

## Tech

- **Next.js 16** (App Router) + **React 19**
- **Tailwind CSS v4**
- **TypeScript**
- Deployed on **Vercel**, instrumented with **Novus**

## Local development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Optional: AI-enhanced critique

Copy `.env.example` to `.env.local` and add an OpenAI-compatible key. Without
one, Shipgrade runs entirely on its built-in heuristic engine.

```bash
cp .env.example .env.local
```
