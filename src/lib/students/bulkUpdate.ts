import { CASTE_OPTIONS } from "@/lib/import/fieldConstraints";
import { EMAIL_REGEX, PHONE_REGEX } from "@/lib/validations";
import { ROSTER_DETAIL_GROUPS, ROSTER_FIELDS, type RosterField } from "./rosterFields";
import { normalizeStudentMobile, studentMobileProblem } from "./studentMobile";

// "Update student data": the College Office picks WHICH detail fields to change, downloads a template holding Student
// Mobile No + those columns, fills it in and uploads it. Each row finds its student by Student Mobile No (the same key
// the Roll No mapping uses) and updates only the picked fields. This file is the pure rules; the server resolves the
// students (bulkUpdateResolve.ts) and writes (api/college/students/bulk-update). It does not touch the Roll No mapping.
//
// Per field, for a non-blank cell (a blank cell NEVER changes anything):
//   student blank        -> FILL
//   same value           -> left alone (SAME)
//   different value      -> OVERWRITE (unless "fill blanks only" is on, then it is held back)
// One bad cell skips that student's whole row, so a student is never half-updated.
//
// Not copied from the student self-edit rules, on purpose: self-edit clears dependent details when an answer flips
// (Handicapped Type when "No") and mirrors Permanent Address. Both erase data, so here they only raise a WARNING.

/** Mobile is the key; Roll No lives in the Map roll numbers tab; identity/academic fields have their own flows. */
export const BULK_UPDATE_FIELDS: string[] = ROSTER_DETAIL_GROUPS.flatMap((g) => g.keys).filter((k) => k !== "mobileNo");
const ALLOWED = new Set(BULK_UPDATE_FIELDS);

/** The detail groups restricted to what this import may change (empty groups dropped) - the picker's sections. */
export const BULK_UPDATE_GROUPS = ROSTER_DETAIL_GROUPS
  .map((g) => ({ title: g.title, keys: g.keys.filter((k) => ALLOWED.has(k)) }))
  .filter((g) => g.keys.length > 0);

const FIELD_BY_KEY = new Map<string, RosterField>(ROSTER_FIELDS.map((f) => [f.key, f]));
export const bulkFieldLabel = (key: string) => FIELD_BY_KEY.get(key)?.label ?? key;
export const isBulkUpdateField = (key: string) => ALLOWED.has(key);

export type BulkUpdateOutcome =
  | "WILL_UPDATE"
  | "NO_CHANGE"
  | "NO_MATCH"
  | "MOBILE_SHARED"
  | "DUPLICATE_IN_FILE"
  | "BAD_MOBILE"
  | "BAD_VALUE";

/** Outcomes that mean "a write may happen". */
export const BULK_APPLIED_OUTCOMES: BulkUpdateOutcome[] = ["WILL_UPDATE"];

export interface BulkUpdateRow {
  /** The row's number in the uploaded sheet, for the results table. */
  rowNumber: number;
  /** Student Mobile No as typed. */
  mobile: string;
  /** Field key -> the cell text (picked fields only; blanks may be omitted or ""). */
  values: Record<string, string>;
}

/** What the classifier needs to know about a student. `data` is the stored record. */
export interface BulkStudent {
  id: string;
  data: Record<string, unknown>;
}

export interface BulkFieldChange {
  key: string;
  label: string;
  mode: "FILL" | "OVERWRITE";
  /** Display text of the stored value ("" when it was blank). */
  before: string;
  /** Display text of the new value. */
  after: string;
  /** Stored form of the old value (null when blank) - kept for the backup. */
  beforeValue: unknown;
  /** Stored form of the new value - what is written. */
  afterValue: string | number | boolean;
}

export interface BulkUpdateResult {
  rowNumber: number;
  mobile: string;
  mobileNormalized: string;
  outcome: BulkUpdateOutcome;
  message: string;
  studentId?: string;
  studentName?: string;
  rollNumber?: string;
  /** Fields that will be written (FILL / OVERWRITE). */
  changes: BulkFieldChange[];
  /** Overwrites not applied because "fill blanks only" is on. */
  held: BulkFieldChange[];
  /** Fields whose cell already equals what is stored. */
  sameCount: number;
  warnings: string[];
}

// ── cell rules ────────────────────────────────────────────────────────────────────────────────────────────────

const PHONE_KEYS = new Set(["fatherContactNo", "motherContactNo", "guardianContact"]);
const DIGIT_KEYS = new Set([...PHONE_KEYS, "aadharNo", "bankAccountNo"]);
const ADDRESS_KEYS = new Set(["temporaryAddress", "permanentAddress", "studiedOutsideAPDetails", "familyIdLinkedOtherStateDetails", "parentsWorkingOutsideDetails", "identificationMarks"]);
const SHORT_TEXT_MAX = 200;
const ADDRESS_MAX = 500;
const SCIENTIFIC = /^[+-]?\d+(\.\d+)?e[+-]?\d+$/i;
const GENDERS = ["Male", "Female", "Other"];

/** `lossy`: Excel had already cut the digits off (e.g. 6.6806E+11), so the real number is gone from the file. */
type CellResult = { ok: true; value: string | number | boolean } | { ok: false; error: string; lossy?: boolean };

/**
 * Turns Excel's scientific notation back into plain digits - but ONLY when that is exact, i.e. the mantissa still holds
 * every digit ("1.23456789012E+11" -> 123456789012). "6.6806E+11" has lost its trailing digits; padding it with zeros
 * would invent a number, so it is returned as null and the caller refuses it.
 */
export function expandScientific(raw: string): string | null {
  const m = raw.trim().match(/^\+?(\d+)(?:\.(\d+))?e\+?(\d+)$/i);
  if (!m) return null;
  const digits = m[1] + (m[2] ?? "");
  const intLen = m[1].length + Number(m[3]);
  return digits.length === intLen ? digits : null;
}

/** A real calendar date as YYYY-MM-DD, accepting DD-MM-YYYY and DD/MM/YYYY too; null when it isn't one. */
export function normalizeBulkDate(raw: string): string | null {
  const t = raw.trim();
  let y: number, m: number, d: number;
  let hit = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (hit) { y = +hit[1]; m = +hit[2]; d = +hit[3]; }
  else if ((hit = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) { d = +hit[1]; m = +hit[2]; y = +hit[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Validates one non-blank cell and returns it in stored form. */
export function normalizeBulkCell(key: string, rawIn: string): CellResult {
  const field = FIELD_BY_KEY.get(key);
  const label = bulkFieldLabel(key);
  let raw = rawIn.trim();
  const bad = (error: string): CellResult => ({ ok: false, error: `${label}: ${error}` });

  if (DIGIT_KEYS.has(key) && SCIENTIFIC.test(raw)) {
    const exact = expandScientific(raw);
    if (exact === null) {
      return {
        ok: false, lossy: true,
        error: `Excel had shortened "${raw}" so the real number is no longer in the file - not changed; re-enter it as Text`,
      };
    }
    raw = exact;
  }

  if (field?.kind === "yesno") {
    const t = raw.toUpperCase();
    if (t === "YES" || t === "Y" || t === "TRUE") return { ok: true, value: true };
    if (t === "NO" || t === "N" || t === "FALSE") return { ok: true, value: false };
    return bad("must be Yes or No");
  }
  if (field?.kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 5000) return bad("must be a number of kilometres between 0 and 5000");
    return { ok: true, value: n };
  }
  if (field?.kind === "date") {
    const d = normalizeBulkDate(raw);
    return d ? { ok: true, value: d } : bad("must be a valid date as YYYY-MM-DD (DD-MM-YYYY also works)");
  }
  if (key === "gender") {
    const hit = GENDERS.find((g) => g.toLowerCase() === raw.toLowerCase());
    return hit ? { ok: true, value: hit } : bad("must be Male, Female or Other");
  }
  if (key === "caste") {
    const hit = (CASTE_OPTIONS as readonly string[]).find((c) => c.toLowerCase() === raw.toLowerCase());
    return hit ? { ok: true, value: hit } : bad(`must be one of ${CASTE_OPTIONS.join(", ")}`);
  }
  if (key === "handicappedType") {
    const t = raw.toUpperCase();
    return t === "H" || t === "V" || t === "O" ? { ok: true, value: t } : bad("must be H (Hearing), V (Visual) or O (Other)");
  }
  if (PHONE_KEYS.has(key)) {
    const digits = normalizeStudentMobile(raw);
    return PHONE_REGEX.test(digits) ? { ok: true, value: digits } : bad("must be exactly 10 digits, starting with 6, 7, 8 or 9");
  }
  if (key === "landLineNo") {
    return /^[\d\s+\-()]{6,15}$/.test(raw) ? { ok: true, value: raw } : bad("can only contain digits, spaces, +, - and brackets (6-15 characters)");
  }
  if (key === "email") {
    const e = raw.toLowerCase();
    return EMAIL_REGEX.test(e) ? { ok: true, value: e } : bad("enter a valid email address");
  }
  if (key === "ifscCode") {
    const c = raw.toUpperCase();
    return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(c) ? { ok: true, value: c } : bad("must be 11 characters: 4 letters, a 0, then 6 letters/digits (e.g. SBIN0001234)");
  }
  if (key === "bankAccountNo") {
    const a = raw.replace(/[\s-]/g, "");
    return /^\d{9,18}$/.test(a) ? { ok: true, value: a } : bad("must be 9 to 18 digits");
  }
  if (key === "aadharNo") {
    const a = raw.replace(/[\s-]/g, "");
    return /^\d{12}$/.test(a) ? { ok: true, value: a } : bad("must be 12 digits");
  }
  const max = ADDRESS_KEYS.has(key) ? ADDRESS_MAX : SHORT_TEXT_MAX;
  if (raw.length > max) return bad(`is too long (max ${max} characters)`);
  return { ok: true, value: raw };
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** A stored value reduced to a form comparable with a normalised cell (so "98765 43210" equals 9876543210). */
function comparable(key: string, stored: unknown): unknown {
  if (typeof stored === "boolean" || typeof stored === "number") return stored;
  const s = String(stored ?? "").trim();
  if (PHONE_KEYS.has(key)) return normalizeStudentMobile(s);
  if (key === "aadharNo" || key === "bankAccountNo") return s.replace(/[\s-]/g, "");
  if (key === "email") return s.toLowerCase();
  if (key === "ifscCode" || key === "handicappedType") return s.toUpperCase();
  if (FIELD_BY_KEY.get(key)?.kind === "date") return normalizeBulkDate(s) ?? s;
  if (FIELD_BY_KEY.get(key)?.kind === "number") { const n = Number(s); return Number.isFinite(n) && s !== "" ? n : s; }
  return s;
}

function display(key: string, v: unknown): string {
  if (isBlank(v)) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Dependent answers that would be left inconsistent - reported, never "fixed" by erasing something. */
function dependencyWarnings(merged: Record<string, unknown>, touched: Set<string>): string[] {
  const out: string[] = [];
  const has = (k: string) => !isBlank(merged[k]);
  if ((touched.has("physicallyHandicapped") || touched.has("handicappedType")) && merged.physicallyHandicapped === false && has("handicappedType")) {
    out.push("Physically Handicapped is No but a Handicapped Type is on file - check this student");
  }
  if ((touched.has("studiedOutsideAP") || touched.has("studiedOutsideAPDetails")) && merged.studiedOutsideAP === false && has("studiedOutsideAPDetails")) {
    out.push("Studied Outside AP is No but details are on file - check this student");
  }
  if ((touched.has("familyIdLinkedOtherState") || touched.has("familyIdLinkedOtherStateDetails")) && merged.familyIdLinkedOtherState === false && has("familyIdLinkedOtherStateDetails")) {
    out.push("Family ID Linked to Another State is No but details are on file - check this student");
  }
  if ((touched.has("parentsWorkingOutside") || touched.has("parentsWorkingOutsideDetails")) && merged.parentsWorkingOutside === false && has("parentsWorkingOutsideDetails")) {
    out.push("Parents Working in Other States/Country is No but details are on file - check this student");
  }
  if ((touched.has("permanentAddressSameAsTemporary") || touched.has("permanentAddress") || touched.has("temporaryAddress")) &&
      merged.permanentAddressSameAsTemporary === true && has("permanentAddress") &&
      String(merged.permanentAddress).trim() !== String(merged.temporaryAddress ?? "").trim()) {
    out.push("Permanent Address is marked 'same as temporary' but the two addresses differ - check this student");
  }
  return out;
}

export interface ClassifyOneOptions {
  fields: string[];
  /** When true an OVERWRITE is held back and only blanks are filled. */
  fillOnly: boolean;
}

/** The field-level result for ONE row against ONE student's stored record. Used by the batch classifier AND by apply. */
export function classifyRowAgainstStudent(
  row: BulkUpdateRow,
  student: BulkStudent,
  opts: ClassifyOneOptions
): Pick<BulkUpdateResult, "outcome" | "message" | "changes" | "held" | "sameCount" | "warnings"> {
  const none = { changes: [] as BulkFieldChange[], held: [] as BulkFieldChange[], sameCount: 0, warnings: [] as string[] };
  const errors: string[] = [];
  const parsed: { key: string; value: string | number | boolean }[] = [];
  const lossy: string[] = []; // cells Excel had already damaged: that one field is skipped, the student's other fields still apply
  let provided = 0;

  for (const key of opts.fields) {
    if (!ALLOWED.has(key)) continue;
    const raw = row.values[key];
    if (raw === undefined || raw === null || !String(raw).trim()) continue; // blank never changes anything
    provided++;
    const cell = normalizeBulkCell(key, String(raw));
    if (cell.ok) parsed.push({ key, value: cell.value });
    else if (cell.lossy) lossy.push(`${bulkFieldLabel(key)}: ${cell.error}`);
    else errors.push(cell.error);
  }
  if (errors.length > 0) {
    return { ...none, outcome: "BAD_VALUE", message: `${errors.join("; ")} - this student was not changed` };
  }
  none.warnings.push(...lossy);
  if (provided === 0) return { ...none, outcome: "NO_CHANGE", message: "No values in this row for the chosen fields" };
  if (parsed.length === 0) return { ...none, outcome: "NO_CHANGE", message: "Nothing to change - the only value(s) in this row were damaged by Excel" };

  const changes: BulkFieldChange[] = [];
  const held: BulkFieldChange[] = [];
  let sameCount = 0;
  for (const { key, value } of parsed) {
    const stored = student.data[key];
    if (isBlank(stored)) {
      changes.push({ key, label: bulkFieldLabel(key), mode: "FILL", before: "", after: display(key, value), beforeValue: null, afterValue: value });
      continue;
    }
    if (comparable(key, stored) === comparable(key, value)) { sameCount++; continue; }
    const change: BulkFieldChange = {
      key, label: bulkFieldLabel(key), mode: "OVERWRITE", before: display(key, stored), after: display(key, value), beforeValue: stored, afterValue: value,
    };
    if (opts.fillOnly) held.push(change); else changes.push(change);
  }

  if (changes.length === 0) {
    return {
      ...none, held, sameCount, outcome: "NO_CHANGE",
      message: held.length > 0
        ? `Existing value${held.length === 1 ? "" : "s"} kept for ${held.map((h) => h.label).join(", ")} (fill blanks only is on)`
        : "Already up to date",
    };
  }

  const merged = { ...student.data };
  for (const c of changes) merged[c.key] = c.afterValue;
  const warnings = [...lossy, ...dependencyWarnings(merged, new Set(changes.map((c) => c.key)))];

  const fills = changes.filter((c) => c.mode === "FILL").length;
  const overwrites = changes.length - fills;
  const parts = [fills > 0 ? `fill ${fills}` : "", overwrites > 0 ? `overwrite ${overwrites}` : ""].filter(Boolean).join(" and ");
  return { outcome: "WILL_UPDATE", message: `Will ${parts} field${changes.length === 1 ? "" : "s"}`, changes, held, sameCount, warnings };
}

/** The Firestore update for a WILL_UPDATE result: only the fields that change. */
export function bulkUpdatesOf(changes: BulkFieldChange[]): Record<string, string | number | boolean> {
  return Object.fromEntries(changes.map((c) => [c.key, c.afterValue]));
}

// ── whole-file classification ─────────────────────────────────────────────────────────────────────────────────

export interface ClassifyBulkInput {
  rows: BulkUpdateRow[];
  /** Normalised 10-digit mobile -> the college's students holding it. */
  studentsByMobile: Map<string, BulkStudent[]>;
  /** Mobiles with no student here but registered to a student of another college. */
  otherCollegeMobiles?: Set<string>;
  fields: string[];
  fillOnly: boolean;
}

const emptyResult = (row: BulkUpdateRow, mobileNormalized: string) => ({
  rowNumber: row.rowNumber, mobile: row.mobile, mobileNormalized,
  changes: [] as BulkFieldChange[], held: [] as BulkFieldChange[], sameCount: 0, warnings: [] as string[],
});

export function classifyBulkUpdate(input: ClassifyBulkInput): BulkUpdateResult[] {
  const seen = new Map<string, number>();
  for (const r of input.rows) {
    const m = normalizeStudentMobile(r.mobile);
    if (!studentMobileProblem(r.mobile)) seen.set(m, (seen.get(m) ?? 0) + 1);
  }

  return input.rows.map((row): BulkUpdateResult => {
    const m = normalizeStudentMobile(row.mobile);
    const problem = studentMobileProblem(row.mobile);
    if (problem) return { ...emptyResult(row, m), outcome: "BAD_MOBILE", message: problem };

    if ((seen.get(m) ?? 0) > 1) {
      return { ...emptyResult(row, m), outcome: "DUPLICATE_IN_FILE", message: "This mobile number appears more than once in the file - none of its rows was applied" };
    }

    const holders = input.studentsByMobile.get(m) ?? [];
    if (holders.length === 0) {
      return {
        ...emptyResult(row, m), outcome: "NO_MATCH",
        message: input.otherCollegeMobiles?.has(m)
          ? "This number belongs to a student of another college - it can't be updated from here"
          : "No student on your roster has this mobile number",
      };
    }
    if (holders.length > 1) {
      return { ...emptyResult(row, m), outcome: "MOBILE_SHARED", message: `${holders.length} students on your roster share this mobile number - fix that first; nothing was guessed` };
    }

    const student = holders[0];
    const res = classifyRowAgainstStudent(row, student, { fields: input.fields, fillOnly: input.fillOnly });
    return {
      ...emptyResult(row, m), ...res,
      studentId: student.id,
      studentName: typeof student.data.name === "string" ? student.data.name : undefined,
      rollNumber: typeof student.data.rollNumber === "string" ? student.data.rollNumber : undefined,
    };
  });
}

export function summarizeBulkUpdate(results: BulkUpdateResult[]): Record<BulkUpdateOutcome, number> {
  const counts: Record<BulkUpdateOutcome, number> = {
    WILL_UPDATE: 0, NO_CHANGE: 0, NO_MATCH: 0, MOBILE_SHARED: 0, DUPLICATE_IN_FILE: 0, BAD_MOBILE: 0, BAD_VALUE: 0,
  };
  for (const r of results) counts[r.outcome]++;
  return counts;
}
