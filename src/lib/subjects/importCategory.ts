// A category named in an import file must be defined: one of the standard set, or one the college
// defined under Academics > Categories.
import { SUBJECT_CATEGORY_LABELS, type SubjectCategory } from "@/types";
import { categoryKey, type CategoryDefinition } from "./categoryDefinitions";

function normalizeWords(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ── Category ────────────────────────────────────────────────────────────
const CATEGORY_LOOKUP = new Map<string, SubjectCategory>();
for (const [key, label] of Object.entries(SUBJECT_CATEGORY_LABELS)) {
  CATEGORY_LOOKUP.set(normalizeWords(key), key);
  CATEGORY_LOOKUP.set(normalizeWords(label), key);
  // "Professional Core (PCC)" is also typed as just "Professional Core".
  CATEGORY_LOOKUP.set(normalizeWords(label.replace(/\([^)]*\)/g, "")), key);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export type CategoryResolution =
  | { kind: "known"; category: SubjectCategory }
  | { kind: "unknown"; suggestion?: SubjectCategory };

// A category the file names must be defined: one of the standard set, or one
// the college defined on Academics > Categories, matched by short code or full
// form. Anything else is unknown, with a suggestion when it looks like a typo
// of, or a numbered variant of ("Professional Elective-II"), a defined one.
export function resolveImportCategory(raw: string, custom: CategoryDefinition[] = []): CategoryResolution {
  const norm = normalizeWords(raw);
  const known = CATEGORY_LOOKUP.get(norm);
  if (known) return { kind: "known", category: known };
  for (const c of custom) {
    if (categoryKey(c.code) === norm || categoryKey(c.fullForm) === norm) return { kind: "known", category: c.code };
  }

  const candidates = new Map(CATEGORY_LOOKUP);
  for (const c of custom) {
    candidates.set(categoryKey(c.code), c.code);
    candidates.set(categoryKey(c.fullForm), c.code);
  }
  const base = norm.replace(/(?: (?:[ivx]+|\d+))+$/, "");
  if (base && base !== norm && candidates.has(base)) return { kind: "unknown", suggestion: candidates.get(base) };
  for (const [candidate, key] of candidates) {
    if (candidate.length <= 4) {
      // Short codes: only a dropped/doubled letter ("PCCC", "PC") counts as a
      // typo. A same-length substitution is usually a real, different code
      // ("SEC" - Skill Enhancement Course - is not a typo of "BSC").
      if (Math.abs(candidate.length - norm.length) === 1 && editDistance(candidate, norm) === 1) {
        return { kind: "unknown", suggestion: key };
      }
    } else if (Math.abs(candidate.length - norm.length) <= 2 && editDistance(candidate, norm) <= 2) {
      return { kind: "unknown", suggestion: key };
    }
  }
  return { kind: "unknown" };
}


// The categories a college defined under Academics > Categories, from the raw subjectCategories docs.
export function customCategoriesFrom(docs: FirebaseFirestore.DocumentData[]): CategoryDefinition[] {
  return docs
    .filter((d): d is CategoryDefinition => typeof d.code === "string" && typeof d.fullForm === "string")
    .map((d) => ({ code: d.code, fullForm: d.fullForm }));
}
