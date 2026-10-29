import { describe, expect, it } from "vitest";
import { tidy } from "@/lib/tidy";

describe("tidy", () => {
  it("turns a pause dash into a comma", () => {
    expect(tidy("Four tiers—Free, Basic and Business—but no button.")).toBe(
      "Four tiers, Free, Basic and Business, but no button.",
    );
    expect(tidy("Clear value prop — weak proof")).toBe("Clear value prop, weak proof");
  });

  it("keeps number ranges as hyphens", () => {
    expect(tidy("Cut it to 8–12 words, or 10 — 20 at most.")).toBe("Cut it to 8-12 words, or 10-20 at most.");
  });

  it("drops a dash before punctuation or at the edges", () => {
    expect(tidy("— Great headline —.")).toBe("Great headline.");
    expect(tidy("Ship it—")).toBe("Ship it");
  });

  it("leaves clean text and empty values alone", () => {
    expect(tidy("A well-sized, share-ready sentence.")).toBe("A well-sized, share-ready sentence.");
    expect(tidy(null)).toBeNull();
    expect(tidy("")).toBe("");
  });
});
