/**
 * Display-only cleanup for model-written text: no em or en dashes on the page.
 * A dash between numbers becomes a hyphen (10–20 -> 10-20); a dash used as a
 * pause becomes a comma.
 */
export function tidy(text: string): string;
export function tidy(text: string | null | undefined): string | null | undefined;
export function tidy(text: string | null | undefined) {
  if (!text) return text;
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*([.,;:!?)])/g, "$1")
    .replace(/^\s*[—–]\s*/, "")
    .replace(/\s*[—–]\s*$/, "")
    .replace(/\s*[—–]+\s*/g, ", ")
    .replace(/,\s*,/g, ",");
}
