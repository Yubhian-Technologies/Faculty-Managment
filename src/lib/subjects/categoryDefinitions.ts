import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Subject categories a college defines for itself (Academics > Categories):
// a short code and its full form, e.g. "PC" -> "Professional Core". A subject
// stores the code in `category`, so everything that already reads
// Subject.category keeps working; the full form is the readable name.
//
// The standard set (SUBJECT_CATEGORY_LABELS) is always available; a college
// can relabel one (stored the same way as a custom category - a
// subjectCategories doc whose code happens to be a standard one, see
// subject-categories/route.ts PATCH/DELETE) or add its own on top, but
// cannot invent a NEW code or full form that collides with the standard
// set's own text. Pure, so the settings page, its API and the Course
// Structure import all apply the same rules.

export const CATEGORY_CODE_MAX = 12;
export const CATEGORY_FULL_FORM_MIN = 2;
export const CATEGORY_FULL_FORM_MAX = 80;

export interface CategoryDefinition {
  code: string;
  fullForm: string;
}

// Lower-case words only, so "BS&H", "bs&h" and "BS H" are the same category.
export function categoryKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Firestore document id for a category code ("BS&H" -> "BS_H").
export function categoryDocId(code: string): string {
  return categoryKey(code).replace(/ /g, "_").toUpperCase();
}

const BUILT_IN: CategoryDefinition[] = Object.entries(SUBJECT_CATEGORY_LABELS)
  .filter(([code]) => code !== "OTHER")
  .map(([code, label]) => ({ code, fullForm: label.replace(/\s*\([^)]*\)\s*$/, "").trim() }));

export function builtInCategories(): CategoryDefinition[] {
  return BUILT_IN.map((c) => ({ ...c }));
}

const STANDARD_BY_KEY = new Map(BUILT_IN.map((c) => [categoryKey(c.code), c]));

/** Whether `code` names one of the standard (AICTE) categories - editable in place, never a "new category" collision. */
export function isStandardCategoryCode(code: string): boolean {
  return STANDARD_BY_KEY.has(categoryKey(code));
}

// Reserved for a BRAND NEW code/full form (one that doesn't already name a
// standard category) - "other" itself, plus every standard category's own
// text, so a new custom code can't duplicate what a standard one already
// means. A standard code relabeling ITSELF is handled separately below, not
// through this set.
const RESERVED_KEYS = new Set<string>([
  "other",
  ...BUILT_IN.flatMap((c) => [categoryKey(c.fullForm), categoryKey(SUBJECT_CATEGORY_LABELS[c.code])]),
]);

export type CategoryCheck = { ok: true; code: string; fullForm: string } | { ok: false; error: string };

// Validates one definition. `existing` are the college's own definitions
// (custom ones, and any standard category already relabeled); pass the one
// being edited's code in `ignoreCode` so it doesn't collide with itself.
export function checkCategoryDefinition(
  input: { code?: unknown; fullForm?: unknown },
  existing: CategoryDefinition[],
  ignoreCode?: string
): CategoryCheck {
  const code = String(input.code ?? "").trim().toUpperCase();
  const fullForm = String(input.fullForm ?? "").trim().replace(/\s+/g, " ");
  if (!code) return { ok: false, error: "Enter a short code." };
  if (code.length > CATEGORY_CODE_MAX) return { ok: false, error: `The short code "${code}" is longer than ${CATEGORY_CODE_MAX} characters.` };
  if (!/^[A-Z0-9][A-Z0-9&\-/.]*$/.test(code)) {
    return { ok: false, error: `The short code "${code}" may only contain letters, digits and & - / . and must start with a letter or digit.` };
  }
  if (fullForm.length < CATEGORY_FULL_FORM_MIN) return { ok: false, error: `Enter the full form for ${code}.` };
  if (fullForm.length > CATEGORY_FULL_FORM_MAX) return { ok: false, error: `The full form for ${code} is longer than ${CATEGORY_FULL_FORM_MAX} characters.` };

  const key = categoryKey(code);
  const fullFormKey = categoryKey(fullForm);
  // A standard category relabeling ITSELF is exempt from its own reserved
  // text (so it can keep, or return to, its own default) - but not from any
  // OTHER standard category's text, which would be impersonation.
  const standard = STANDARD_BY_KEY.get(key);
  const ownReservedKeys = standard ? new Set([categoryKey(standard.fullForm), categoryKey(SUBJECT_CATEGORY_LABELS[standard.code])]) : null;
  if (RESERVED_KEYS.has(key) || (RESERVED_KEYS.has(fullFormKey) && !ownReservedKeys?.has(fullFormKey))) {
    return { ok: false, error: `${code} or its full form is already a standard category.` };
  }
  const ignore = ignoreCode ? categoryKey(ignoreCode) : null;
  for (const other of existing) {
    if (ignore && categoryKey(other.code) === ignore) continue;
    if (categoryKey(other.code) === key) return { ok: false, error: `${code} is already defined as "${other.fullForm}".` };
    if (categoryKey(other.fullForm) === categoryKey(fullForm)) return { ok: false, error: `"${fullForm}" is already defined with the code ${other.code}.` };
  }
  return { ok: true, code, fullForm };
}

// "PC: Professional Core" lines (also "PC = ..." or a tab, as pasted from a
// spreadsheet) -> definitions. Splits on the first separator, so codes may
// contain "-" (PE-I).
export function parseCategoryLines(text: string): { entries: CategoryDefinition[]; errors: string[] } {
  const entries: CategoryDefinition[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^([^:=\t]+)[:=\t]\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`Line ${i + 1}: write it as CODE: Full form.`);
      return;
    }
    entries.push({ code: m[1].trim(), fullForm: m[2].trim() });
  });
  return { entries, errors };
}
