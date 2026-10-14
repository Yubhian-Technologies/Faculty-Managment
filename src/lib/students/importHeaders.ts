// Reading the College Office's own admission sheet as a student import file.
//
// The importer's template is generated from ROSTER_FIELDS, but the sheet a
// college already keeps (Sl.No, Roll.No, Admission.No, Student Name ... Mother
// Mobile.No) is worded and shaped differently in three ways matchHeaders alone
// cannot settle - handled here, in one pure place the page and tests share:
//   1. it has a serial-number column, which is not student data;
//   2. it has BOTH "Category" (OC / BC-A / SC ...) and "Caste" (the community's
//      name), where the roster calls those Caste and Sub Caste;
//   3. its dates are typed day-first (31-08-2026), not YYYY-MM-DD.

import { matchHeaders, normalizeHeader } from "@/lib/utils/csv";
import { CASTE_OPTIONS } from "@/lib/import/fieldConstraints";

/** Headers that only number the rows - dropped, never reported as unknown. */
const SERIAL_HEADERS = new Set(["sl no", "s no", "sno", "slno", "sr no", "serial no", "serial number"]);

/**
 * matchHeaders, plus the admission sheet's two quirks. Returns the column-index
 * -> field-key map and the headers that matched nothing (serial columns left out).
 */
export function resolveStudentImportHeaders(
  headers: string[],
  columns: { key: string; label: string; aliases?: string[] }[]
): { keyMap: Record<number, string>; unmatched: string[] } {
  const keyMap = matchHeaders(headers, columns);
  const normalized = headers.map((h) => normalizeHeader(h));

  // "Category" + "Caste" side by side: the category is the roster's Caste, and
  // the sheet's Caste is the roster's Sub Caste. Left alone when the sheet has
  // a Sub Caste column of its own (then its Caste already means the category).
  const categoryAt = normalized.indexOf("category");
  const casteAt = normalized.indexOf("caste");
  const hasSubCaste = Object.values(keyMap).includes("subCaste");
  if (categoryAt !== -1 && casteAt !== -1 && !hasSubCaste && columns.some((c) => c.key === "subCaste")) {
    keyMap[categoryAt] = "caste";
    keyMap[casteAt] = "subCaste";
  }

  const unmatched = headers
    .map((h, i) => (h.trim() && !keyMap[i] && !SERIAL_HEADERS.has(normalized[i]) ? h.trim() : null))
    .filter((h): h is string => h !== null);
  return { keyMap, unmatched };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null; // 31-02 and the like
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A date cell as YYYY-MM-DD. Reads YYYY-MM-DD (kept), day-first numeric dates
 * (31-08-2026, 31/08/2026, 31.08.2026) and day-month-name dates (31-Aug-2026).
 * Anything it cannot read is returned unchanged, as the importer always stored it.
 */
export function normalizeImportDate(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(v);
  if (ymd) return isoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])) ?? v;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v);
  if (dmy) return isoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) ?? v;
  const dMonY = /^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.,\s]+(\d{4})$/.exec(v);
  if (dMonY) {
    const m = MONTHS.indexOf(dMonY[2].slice(0, 3).toLowerCase()) + 1;
    return (m ? isoDate(Number(dMonY[3]), m, Number(dMonY[1])) : null) ?? v;
  }
  return v;
}

/**
 * The reservation category as the roster spells it ("bc_a", "BC A", "BCA" ->
 * "BC-A"; "oc" -> "OC"). A value that is not one of the roster's categories is
 * returned as typed.
 */
export function normalizeCasteCategory(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const upper = v.toUpperCase().replace(/[\s_.]+/g, "-").replace(/^BC-?([A-E])$/, "BC-$1");
  return (CASTE_OPTIONS as readonly string[]).includes(upper) ? upper : v;
}

/** The roster's date fields. */
const DATE_KEYS = ["dateOfBirth", "dateOfAdmission", "dateOfJoining"];

/** One parsed row with its dates and category put into the roster's own form. */
export function normalizeStudentImportRow(row: Record<string, string>): Record<string, string> {
  const out = { ...row };
  for (const k of DATE_KEYS) if (out[k]) out[k] = normalizeImportDate(out[k]);
  if (out.caste) out.caste = normalizeCasteCategory(out.caste);
  return out;
}
