// The one place that defines what a faculty member's "Highest Qualification"
// can be, and how any free-typed / imported / legacy value is folded into it.
//
// Used by the Add/Edit Faculty dropdowns (via HIGHEST_QUALIFICATION_OPTIONS),
// by every API route that writes FacultyMember.highestQualification, and by
// scripts/standardize-vit-highest-qualification.mjs - so a spelling like
// "M.TECH", "M.Tech." and "M.Tech" can never become three different values.
//
// Keep this file dependency-free and TypeScript-erasable (no enums, no `@/`
// imports): the migration script loads it with Node's native type stripping.

// Order = the order shown in the dropdown ("Others" is appended by the forms).
export const HIGHEST_QUALIFICATION_OPTIONS = [
  "Ph.D", "M.Tech", "M.E", "M.Sc", "M.A", "M.Phil", "M.P.Ed", "MSIT", "MBA", "B.Tech", "B.Sc",
] as const;

export type HighestQualificationCategory = (typeof HIGHEST_QUALIFICATION_OPTIONS)[number];

// Compact spelling (lowercase letters/digits only, any "(...)" removed) -> category.
const ALIASES: Record<string, HighestQualificationCategory> = {
  phd: "Ph.D",
  doctorofphilosophy: "Ph.D",
  mtech: "M.Tech",
  me: "M.E",
  msc: "M.Sc",
  ma: "M.A",
  mphil: "M.Phil",
  mped: "M.P.Ed",
  msit: "MSIT",
  mba: "MBA",
  btech: "B.Tech",
  bsc: "B.Sc",
};

// When one record lists several degrees, the highest level wins; among equals
// the one listed last does (people list them in the order they earned them).
const RANK: Record<HighestQualificationCategory, number> = {
  "Ph.D": 5,
  "M.Phil": 4,
  "M.Tech": 3, "M.E": 3, "M.Sc": 3, "M.A": 3, "M.P.Ed": 3, "MSIT": 3, "MBA": 3,
  "B.Tech": 2, "B.Sc": 2,
};

function compact(token: string): string {
  return token.replace(/\(.*?\)/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function categoryOfToken(token: string): HighestQualificationCategory | undefined {
  return ALIASES[compact(token)];
}

export interface QualificationClassification {
  // What should be stored: a category, or the original (trimmed) text for
  // "Others", or "" when there was nothing to classify.
  value: string;
  // null = blank input; "Others" = no token matched a category.
  category: HighestQualificationCategory | "Others" | null;
  // Every distinct category found in the input, in the order they appeared.
  matched: HighestQualificationCategory[];
  // True when the input named more than one distinct category.
  ambiguous: boolean;
}

export function classifyHighestQualification(raw: unknown): QualificationClassification {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return { value: "", category: null, matched: [], ambiguous: false };

  const tokens = text.split(/[,;/&\n]|\band\b/i).map((t) => t.trim()).filter(Boolean);
  const found: HighestQualificationCategory[] = [];
  for (const token of tokens) {
    const category = categoryOfToken(token);
    if (category) found.push(category);
  }
  if (found.length === 0) return { value: text, category: "Others", matched: [], ambiguous: false };

  let best = found[0];
  for (const category of found) {
    if (RANK[category] >= RANK[best]) best = category;
  }
  const distinct = Array.from(new Set(found));
  return { value: best, category: best, matched: distinct, ambiguous: distinct.length > 1 };
}

// The value to store for a Highest Qualification: always exactly one category,
// or - only when nothing matches - the original text ("Others").
export function normalizeHighestQualification(raw: unknown): string {
  return classifyHighestQualification(raw).value;
}

export function isHighestQualificationCategory(value: string): value is HighestQualificationCategory {
  return (HIGHEST_QUALIFICATION_OPTIONS as readonly string[]).includes(value);
}
