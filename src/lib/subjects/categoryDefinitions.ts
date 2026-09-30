import { SUBJECT_CATEGORY_LABELS } from "@/types";

// Subject categories a college defines for itself (Academics > Categories):
// a short code and its full form, e.g. "PC" -> "Professional Core". A subject
// stores the code in `category`, so everything that already reads
// Subject.category keeps working; the full form is the readable name.
//
// The standard set (SUBJECT_CATEGORY_LABELS) is always available and can't be
// redefined; a college adds its own on top. Pure, so the settings page, its
// API and the Course Structure import all apply the same rules.

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

const RESERVED_KEYS = new Set<string>([
  "other",
  ...BUILT_IN.flatMap((c) => [categoryKey(c.code), categoryKey(c.fullForm), categoryKey(SUBJECT_CATEGORY_LABELS[c.code])]),
]);

export type CategoryCheck = { ok: true; code: string; fullForm: string } | { ok: false; error: string };

// Validates one definition. `existing` are the college's own definitions (not
// the standard set, which is checked here); pass the one being edited's code in
// `ignoreCode` so it doesn't collide with itself.
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
  if (RESERVED_KEYS.has(key) || RESERVED_KEYS.has(categoryKey(fullForm))) {
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
