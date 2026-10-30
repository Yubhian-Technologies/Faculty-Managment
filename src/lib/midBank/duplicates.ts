// Duplicate questions in a bank. Two parts are the SAME question when their
// text matches after normalising (case, spacing, punctuation, LaTeX spacing
// commands) - that is refused. Parts sharing most of their words are only
// SIMILAR - a warning, since "Explain X" and "Explain X with an example" are
// both legitimate.

export const SIMILARITY_WARN = 0.8;

/** The comparison key of one part's text ("" = nothing to compare, e.g. empty). */
export function textKey(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\\[,;:!]|\\q?quad/g, " ") // LaTeX spacing commands
    .replace(/\$+/g, " ")
    .replace(/[^\p{L}\p{N}\\^_{}+\-*/=<>()]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(key: string): Set<string> {
  return new Set(key.split(" ").filter((t) => t.length > 1));
}

/** Jaccard similarity of the two keys' word sets (0..1). */
export function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export interface OtherQuestion { id: string; unit: number; slot: number; textKeys: string[] }
export interface DuplicateHit { id: string; unit: number; slot: number; part: number }

/**
 * Compares a question's part keys with the bank's other questions (never with
 * itself, and not one part against its own sibling part).
 */
export function findDuplicates(keys: string[], others: OtherQuestion[]): { exact: DuplicateHit[]; similar: DuplicateHit[] } {
  const exact: DuplicateHit[] = [];
  const similar: DuplicateHit[] = [];
  keys.forEach((k, part) => {
    if (!k) return;
    for (const o of others) {
      if (o.textKeys.some((ok) => ok === k)) exact.push({ id: o.id, unit: o.unit, slot: o.slot, part });
      else if (o.textKeys.some((ok) => ok && similarity(k, ok) >= SIMILARITY_WARN)) similar.push({ id: o.id, unit: o.unit, slot: o.slot, part });
    }
  });
  // The two parts of one question must differ too.
  if (keys.length > 1 && keys[0] && keys[0] === keys[1]) exact.push({ id: "", unit: 0, slot: 0, part: 1 });
  return { exact, similar };
}
