import { normalizeStudentMobile } from "@/lib/students/studentMobile";
import { PHONE_REGEX } from "@/lib/validations";
import type { StudentRecord } from "@/types";

// A student's parent / guardian details - kept on the student's own record (the one copy every screen reads).
// Students can't change them (they are not in STUDENT_SELF_EDITABLE_KEYS); a correction is made by the student's
// mentor, their HOD, the Principal / Vice Principal (mentoring record) or the College Office (Students page).

export const PARENT_DETAIL_KEYS = [
  "fatherName", "fatherOccupation", "fatherContactNo",
  "motherName", "motherOccupation", "motherContactNo",
  "guardianName", "guardianContact",
] as const;
export type ParentDetailKey = (typeof PARENT_DETAIL_KEYS)[number];

export const PARENT_DETAIL_LABELS: Record<ParentDetailKey, string> = {
  fatherName: "Father's name", fatherOccupation: "Father's occupation", fatherContactNo: "Father's mobile number",
  motherName: "Mother's name", motherOccupation: "Mother's occupation", motherContactNo: "Mother's mobile number",
  guardianName: "Guardian's name", guardianContact: "Guardian's mobile number",
};

const PHONE_KEYS = new Set<ParentDetailKey>(["fatherContactNo", "motherContactNo", "guardianContact"]);
const KEYS = new Set<string>(PARENT_DETAIL_KEYS);
const TEXT_MAX = 200;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

/** The stored values, as text (blank when missing). */
export function parentDetailsOf(student: Partial<StudentRecord> | Record<string, unknown>): Record<ParentDetailKey, string> {
  const s = student as Record<string, unknown>;
  return Object.fromEntries(PARENT_DETAIL_KEYS.map((k) => [k, str(s[k])])) as Record<ParentDetailKey, string>;
}

export type ParentDetailsResult =
  | { ok: true; updates: Partial<Record<ParentDetailKey, string | null>> }
  | { ok: false; error: string };

/**
 * Validates a correction against the stored record and returns only what CHANGES (blank clears, as null; mobiles
 * stored as 10 digits). Anything that is not a parent / guardian detail is refused.
 */
export function buildParentDetailsUpdate(student: Partial<StudentRecord> | Record<string, unknown>, details: unknown): ParentDetailsResult {
  if (!details || typeof details !== "object" || Array.isArray(details)) return { ok: false, error: "details is required" };
  const input = details as Record<string, unknown>;
  const other = Object.keys(input).filter((k) => !KEYS.has(k));
  if (other.length) return { ok: false, error: `Only parent and guardian details can be changed here: ${other.join(", ")}` };
  const stored = parentDetailsOf(student);
  const updates: Partial<Record<ParentDetailKey, string | null>> = {};
  for (const key of PARENT_DETAIL_KEYS) {
    if (!(key in input)) continue;
    let value = str(input[key]);
    if (PHONE_KEYS.has(key) && value) {
      value = normalizeStudentMobile(value);
      if (!PHONE_REGEX.test(value)) return { ok: false, error: `${PARENT_DETAIL_LABELS[key]} must be exactly 10 digits, starting with 6, 7, 8 or 9` };
    }
    if (value.length > TEXT_MAX) return { ok: false, error: `${PARENT_DETAIL_LABELS[key]} is too long (at most ${TEXT_MAX} characters)` };
    const before = PHONE_KEYS.has(key) ? normalizeStudentMobile(stored[key]) || stored[key] : stored[key];
    if (value === before) continue;
    updates[key] = value || null;
  }
  return { ok: true, updates };
}
