import { NextResponse } from "next/server";
import { analyzeUrl } from "@/lib/analyze";
import { enhanceWithLlm } from "@/lib/llm";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send a JSON body with a `url` field." },
      { status: 400 },
    );
  }

  const url =
    typeof body === "object" && body !== null && "url" in body
      ? String((body as { url: unknown }).url ?? "")
      : "";

  if (!url.trim()) {
    return NextResponse.json({ error: "Enter a URL to grade." }, { status: 400 });
  }

  try {
    const result = await analyzeUrl(url);

    const enhancement = await enhanceWithLlm(result);
    if (enhancement) {
      result.verdict = enhancement.verdict;
      result.roast = enhancement.roast;
      result.meta.usedLLM = true;
    }

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Something went wrong grading that page.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
