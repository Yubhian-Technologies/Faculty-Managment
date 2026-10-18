// Short label for a subject in a timetable cell: "Cryptography & Network Security" -> "CNS".
// A subject's own short code always wins; otherwise the initials of its significant words. A lab keeps its
// "Lab" ("Data Structures Lab" -> "DS Lab"), a trailing numeral stays ("Data Structures II" -> "DS II"), and a
// one-word name is already short, so it is left as it is.

const SKIP_WORDS = new Set(["&", "and", "of", "the", "to", "in", "for", "with", "on", "a", "an"]);
const LAB_WORD = /^(lab|labs|laboratory)$/i;
const NUMERAL = /^(?:[ivx]+|\d+)$/i;

export function subjectAbbreviation(name: string | undefined, shortCode?: string): string {
  const code = shortCode?.trim();
  if (code) return code;
  const full = (name ?? "").trim();
  if (!full) return "";

  const words = full.replace(/[(),:;]/g, " ").split(/\s+/).filter(Boolean);
  const isLab = words.length > 1 && LAB_WORD.test(words[words.length - 1]);
  const core = isLab ? words.slice(0, -1) : words;

  // Trailing numeral(s) are kept as written, not folded into the initials.
  let numerals: string[] = [];
  let body = core;
  while (body.length > 1 && NUMERAL.test(body[body.length - 1])) {
    numerals = [body[body.length - 1], ...numerals];
    body = body.slice(0, -1);
  }
  const significant = body.filter((w) => !SKIP_WORDS.has(w.toLowerCase()));
  if (significant.length < 2) return full;

  const initials = significant.map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w[0].toUpperCase())).join("");
  return [initials, ...numerals, ...(isLab ? ["Lab"] : [])].join(" ");
}
