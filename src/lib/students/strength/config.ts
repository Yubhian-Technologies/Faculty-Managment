// The ONE place that decides what "strength" means. Adding a status, a year
// label or a program never touches the counting code - only this file (and,
// for programs/departments/sections, the ordinary Course/Department/Section
// configuration screens, which the engine reads on every request).

import type { StatusMeta } from "./types";

/**
 * Status rules. A student is counted in college strength exactly once, and
 * only when their status is listed here with `countsInStrength: true`.
 *
 * REGULAR and DETAINED are the two statuses StudentRecord.status can hold
 * today for a student still on the rolls (a detained student is still a
 * student of the college, just held back a year). GRADUATED is an alumnus.
 * The last three aren't settable in the app yet; they are registered so the
 * day a "left the college" status is introduced it is already excluded from
 * strength and labelled properly instead of being counted by accident.
 *
 * Any status NOT listed here is treated as "does not count" (fail-safe: an
 * unknown status never inflates strength) and is reported on the Data Checks
 * panel so someone notices it.
 */
export const STATUS_RULES: readonly StatusMeta[] = [
  { key: "REGULAR", label: "Regular", countsInStrength: true },
  { key: "DETAINED", label: "Detained", countsInStrength: true },
  { key: "GRADUATED", label: "Graduated", countsInStrength: false },
  { key: "DISCONTINUED", label: "Discontinued", countsInStrength: false },
  { key: "TRANSFERRED", label: "Transferred out", countsInStrength: false },
  { key: "LEFT", label: "Left", countsInStrength: false },
];

/** A student document with no status is treated as this - matches the default students/route.ts POST writes. */
export const DEFAULT_STATUS = "REGULAR";

/** Case/space-insensitive comparison key. "" for anything that isn't a non-blank string. */
export function normKey(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/** Trimmed, whitespace-collapsed display text (original casing kept). */
export function cleanLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

/** Canonical status key: upper-case, underscores; blank -> DEFAULT_STATUS. */
export function normStatus(value: unknown): string {
  const s = typeof value === "string" ? value.trim().replace(/[\s-]+/g, "_").toUpperCase() : "";
  return s || DEFAULT_STATUS;
}

const KNOWN_STATUS = new Map(STATUS_RULES.map((s) => [s.key, s]));

/** Rule for a status key; unknown statuses get a fail-safe "does not count" rule. */
export function statusRule(key: string): StatusMeta {
  return (
    KNOWN_STATUS.get(key) ?? {
      key,
      label: key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, " "),
      countsInStrength: false,
    }
  );
}

export function isKnownStatus(key: string): boolean {
  return KNOWN_STATUS.has(key);
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** 1 -> "I", 2 -> "II" (the spreadsheet's column headings). 0 -> "-" (year not set). */
export function romanYear(year: number): string {
  if (!year) return "-";
  return ROMAN[year] ?? String(year);
}

export const UNSET_LABELS = {
  program: "Course not set",
  branch: "Department not set",
  section: "No section",
  batch: "No batch",
} as const;
