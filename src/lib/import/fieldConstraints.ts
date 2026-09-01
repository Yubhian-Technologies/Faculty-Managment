// The constraints the import templates state per column, enforced on the way
// in. The template's guidance row is the contract ("Optional: Ratified / Not
// Ratified", "Optional; number"), but nothing checked it: enum cells were
// stored as whatever text the spreadsheet held, and Employment Type/Status
// silently fell back to Permanent/Active when unrecognised, so a typo became a
// real value rather than an error.
//
// Two shapes of problem this handles:
//
//  - Excel's own mangling. A phone column formatted as a number and exported
//    to CSV comes out as "9E+09"; stored verbatim that is not a phone number,
//    and no amount of care in the sheet prevents it.
//  - Values outside the stated set. "yes" in a Ratified / Not Ratified column
//    is a guess about intent, not data - it is rejected rather than mapped.

/** Case- and punctuation-insensitive key for comparing a cell to an option. */
function optionKey(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
}

/**
 * Expands the scientific notation Excel produces for long numbers - "9E+09",
 * "9.87654321E+9" - back to plain digits. Returns the input unchanged when it
 * isn't in that form, so ordinary text passes through untouched.
 *
 * A value like "9E+09" has genuinely lost precision in the sheet (it is 9
 * followed by nine zeroes, not the original number), so it cannot be recovered
 * - callers should treat the expanded value as suspect. It is expanded rather
 * than dropped so the row still imports with something dialable-shaped, and
 * reported as a warning by the caller.
 */
export function expandScientificNotation(raw: string): string {
  const v = raw.trim();
  if (!/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(v)) return raw;
  const n = Number(v);
  if (!Number.isFinite(n)) return raw;
  return BigInt(Math.round(n)).toString();
}

/** True when a cell arrived in Excel's exponential form - worth warning about. */
export function isScientificNotation(raw: string | undefined): boolean {
  return !!raw && /^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(raw.trim());
}

/**
 * A phone/Aadhaar-style value: scientific notation expanded, then separators
 * and a leading apostrophe (Excel's "keep as text" marker) stripped. Keeps a
 * leading "+" for international numbers.
 */
export function normalizeDigits(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const expanded = expandScientificNotation(String(raw)).trim().replace(/^'/, "");
  const cleaned = expanded.replace(/[\s()\-.]/g, "");
  return cleaned || undefined;
}

/**
 * The matching option, or undefined when the cell names none of them.
 * Deliberately strict: only the stated options match (ignoring case, spacing
 * and punctuation). A near-miss is reported, never guessed at.
 */
export function matchOption(raw: string | undefined, options: readonly string[]): string | undefined {
  const key = optionKey(String(raw ?? ""));
  if (!key) return undefined;
  return options.find((o) => optionKey(o) === key);
}

/** Strict Yes/No. Anything else is undefined, for the caller to report. */
export function parseYesNoStrict(raw: string | undefined): boolean | undefined {
  const key = optionKey(String(raw ?? ""));
  if (key === "yes" || key === "y" || key === "true") return true;
  if (key === "no" || key === "n" || key === "false") return false;
  return undefined;
}

/**
 * A whole number within an optional range, or undefined. Rejects anything that
 * isn't purely numeric - "5 years" is a value the sheet author should fix, not
 * something to silently read as 5.
 */
export function parseWholeNumber(
  raw: string | undefined,
  opts: { min?: number; max?: number } = {}
): number | undefined {
  const v = expandScientificNotation(String(raw ?? "")).trim();
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  if (opts.min !== undefined && n < opts.min) return undefined;
  if (opts.max !== undefined && n > opts.max) return undefined;
  return n;
}

/** An email must contain "@" - the only shape the templates state. */
export function isValidEmail(raw: string | undefined): boolean {
  const v = raw?.trim() ?? "";
  return v.includes("@") && !/\s/.test(v);
}

// ─── The option sets the templates state ────────────────────────────────────
// Kept here beside the checks so the guidance row, the Add/Edit form dropdowns
// and the importer can't state three different things.

export const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;
export const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const MARITAL_STATUS_OPTIONS = ["Single", "Married"] as const;
export const RATIFICATION_STATUS_OPTIONS = ["Ratified", "Not Ratified"] as const;
export const RELIGION_OPTIONS = [
  "Hindu", "Muslim", "Christian", "Sikh", "Jain", "Parsi", "Buddhist", "Other",
] as const;
export const CASTE_OPTIONS = ["OC", "EBC", "EPC", "BC", "SC", "ST", "OTHER"] as const;
