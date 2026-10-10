import { migrateDegree } from "@/lib/faculty/fieldRenames";
import type { DegreeDetail } from "@/types";

// Which qualification slot an entry belongs to (same union DegreeFields/DegreeView use).
export type DegreeSlot = "UG" | "PG" | "DOCTORAL" | "POST_DOCTORAL" | "INTERMEDIATE" | "HIGH_SCHOOL";

// Keys that hold free text - a value is real only once it has a non-blank character.
const TEXT_KEYS = [
  "course", "branch", "specialization", "institutionName", "place", "percentageCgpa",
  "hallTicketNumber", "certificateUrl", "domain", "board", "institutionType",
  "affiliatedUniversity", "status", "mode", "degreeType",
] as const;

function hasText(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
}

// A year is only real when it is a positive number: the edit form's number box
// stores 0 for a cleared field, which must never read back as "this entry has data".
export function isRealYear(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/**
 * True when a qualification entry has anything the read-only views would actually
 * show - checked on the RAW stored value (no placeholder defaults), and only on
 * the keys that apply to this entry's own slot/status (e.g. a Ph.D. entry that is
 * "Pursuing" never shows a Year of Award, so a leftover one doesn't count).
 * `slot` is optional: without it every key is counted.
 * Read-only - nothing stored is changed or dropped.
 */
export function degreeHasData(degree: DegreeDetail | undefined | null, slot?: DegreeSlot): boolean {
  if (!degree) return false;
  const doctoralSlot = slot === "DOCTORAL" || slot === "POST_DOCTORAL";
  // Lift legacy key names first, so data still under an old key isn't missed.
  const d = migrateDegree(degree as unknown as Record<string, unknown>, doctoralSlot) as Record<string, unknown>;
  if (TEXT_KEYS.some((k) => hasText(d[k]))) return true;

  if (slot === undefined || slot === "DOCTORAL") {
    if (hasText(d.departmentName) || hasText(d.thesisTitle)) return true;
  }
  if (slot === undefined) {
    return hasText(d.nameOfTheGuideSupervisor) || isRealYear(d.yearOfRegistration) || isRealYear(d.yearOfAward) || isRealYear(d.yearOfPassing);
  }
  if (doctoralSlot) {
    if (isRealYear(d.yearOfRegistration)) return true;
    if (d.status === "AWARDED" && isRealYear(d.yearOfAward)) return true;
    if (d.status === "PURSUING" && hasText(d.nameOfTheGuideSupervisor)) return true;
    return false;
  }
  return isRealYear(d.yearOfPassing);
}
