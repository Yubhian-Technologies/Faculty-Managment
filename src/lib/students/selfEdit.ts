import { normalizeRosterDetails, ROSTER_DETAIL_GROUPS } from "@/lib/students/rosterFields";
import { normalizeStudentMobile, studentMobileProblem, STUDENT_MOBILE_CLEAR_MESSAGE } from "@/lib/students/studentMobile";
import { EMAIL_REGEX, PHONE_REGEX } from "@/lib/validations";
import type { StudentRecord } from "@/types";

// What a student may change about THEIR OWN record (PATCH /api/college/student/me/profile), and the rules for it.
//
// The College Office (and, for placement, the department) owns identity and academic data - Roll No, name, course /
// department / year / section, admission and entrance details, caste / religion, Aadhar, remarks. A student owns their
// own contact, family, address and bank details. Anything not listed here is refused (403), never silently dropped, so
// a bad client cannot appear to save something it did not.

/** Fields a student may edit. Everything else on the record is office-managed. */
export const STUDENT_SELF_EDITABLE_KEYS: readonly string[] = [
  // Personal
  "bloodGroup", "nationality", "motherTongue", "hosteller", "physicallyHandicapped", "handicappedType", "identificationMarks",
  // Contact & address
  "mobileNo", "landLineNo", "email", "distanceFromResidenceKm", "temporaryAddress", "permanentAddressSameAsTemporary",
  "permanentAddress", "state", "district",
  // Family & guardian
  "fatherName", "fatherContactNo", "motherName", "motherContactNo", "guardianName", "guardianContact",
  // Bank
  "bankAccountNo", "bankName", "ifscCode",
  // Additional
  "studiedOutsideAP", "studiedOutsideAPDetails", "familyIdLinkedOtherState", "familyIdLinkedOtherStateDetails",
  "parentsWorkingOutside", "parentsWorkingOutsideDetails",
];
const EDITABLE = new Set(STUDENT_SELF_EDITABLE_KEYS);

/** The roster groups restricted to what a student can edit (empty groups dropped) - the edit form's sections. */
export const STUDENT_SELF_EDIT_GROUPS = ROSTER_DETAIL_GROUPS
  .map((g) => ({ title: g.title, keys: g.keys.filter((k) => EDITABLE.has(k)) }))
  .filter((g) => g.keys.length > 0);

export const MOBILE_LOCKED_UNTIL_ROLL_MESSAGE =
  "Your Student Mobile No can be changed once your Roll No has been assigned (until then the college uses it to match your Roll No to you)";

/** True once the student may change their own Student Mobile No. */
export function studentMobileSelfEditable(student: Partial<Pick<StudentRecord, "rollNumber">>): boolean {
  return !!(student.rollNumber ?? "").trim();
}

const PHONE_KEYS = ["fatherContactNo", "motherContactNo", "guardianContact"] as const;
const SHORT_TEXT_MAX = 200;
const ADDRESS_MAX = 500;
const ADDRESS_KEYS = new Set(["temporaryAddress", "permanentAddress", "studiedOutsideAPDetails", "familyIdLinkedOtherStateDetails", "parentsWorkingOutsideDetails", "identificationMarks"]);

export type SelfEditResult =
  | { ok: true; updates: Record<string, unknown>; mobile?: string }
  | { ok: false; status: 400 | 403; error: string; code?: string };

const sameValue = (a: unknown, b: unknown) => (a ?? "") === (b ?? "") || (a == null && b == null);

/**
 * Validates and normalises a student's own edit against their stored record. Returns only the fields that actually
 * CHANGE (a value re-sent unchanged is skipped, so a stale form can never overwrite anything the Office changed in
 * the meantime), already in stored form: phones as 10 digits, email lower-case, IFSC upper-case, a cleared field as
 * null. `mobile` is set when the Student Mobile No changed (the caller must claim it - see studentMobile.ts).
 */
export function buildStudentSelfUpdate(student: Partial<StudentRecord>, details: unknown): SelfEditResult {
  if (!details || typeof details !== "object" || Array.isArray(details)) return { ok: false, status: 400, error: "details is required" };
  const input = details as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) return { ok: false, status: 400, error: "No fields provided" };

  const locked = keys.filter((k) => !EDITABLE.has(k));
  if (locked.length > 0) {
    return { ok: false, status: 403, code: "FIELD_NOT_EDITABLE", error: `These details are managed by the College Office and can't be changed here: ${locked.join(", ")}` };
  }

  // Blank means "clear it"; the shared normaliser reads only an explicit null as a clear.
  const prepared: Record<string, unknown> = {};
  for (const k of keys) {
    const v = input[k];
    prepared[k] = v === "" || (typeof v === "string" && !v.trim()) ? null : v;
  }

  let mobile: string | undefined;
  if ("mobileNo" in prepared) {
    const stored = normalizeStudentMobile(student.mobileNo);
    if (prepared.mobileNo === null) {
      // Clearing is never allowed - but a legacy student who has none re-sending the blank is a no-op.
      if (stored) return { ok: false, status: 400, error: STUDENT_MOBILE_CLEAR_MESSAGE };
      delete prepared.mobileNo;
    } else if (normalizeStudentMobile(prepared.mobileNo) === stored && stored) {
      delete prepared.mobileNo;
    } else {
      if (!studentMobileSelfEditable(student)) return { ok: false, status: 403, code: "MOBILE_LOCKED", error: MOBILE_LOCKED_UNTIL_ROLL_MESSAGE };
      const problem = studentMobileProblem(prepared.mobileNo);
      if (problem) return { ok: false, status: 400, error: problem };
      mobile = normalizeStudentMobile(prepared.mobileNo);
      prepared.mobileNo = mobile;
    }
  }

  for (const k of PHONE_KEYS) {
    if (!(k in prepared) || prepared[k] === null) continue;
    const digits = normalizeStudentMobile(prepared[k]);
    if (digits && digits === normalizeStudentMobile(student[k])) { delete prepared[k]; continue; }
    if (!PHONE_REGEX.test(digits)) return { ok: false, status: 400, error: `${LABEL[k]} must be exactly 10 digits, starting with 6, 7, 8 or 9` };
    prepared[k] = digits;
  }
  if (typeof prepared.landLineNo === "string") {
    const t = prepared.landLineNo.trim();
    if (!/^[\d\s+\-()]{6,15}$/.test(t)) return { ok: false, status: 400, error: "Land Line No can only contain digits, spaces, +, - and brackets (6-15 characters)" };
    prepared.landLineNo = t;
  }
  if (typeof prepared.email === "string") {
    const e = prepared.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(e)) return { ok: false, status: 400, error: "Enter a valid email address" };
    prepared.email = e;
  }
  if (typeof prepared.ifscCode === "string") {
    const c = prepared.ifscCode.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(c)) return { ok: false, status: 400, error: "IFSC Code must be 11 characters: 4 letters, a 0, then 6 letters/digits (e.g. SBIN0001234)" };
    prepared.ifscCode = c;
  }
  if (typeof prepared.bankAccountNo === "string") {
    const a = prepared.bankAccountNo.replace(/[\s-]/g, "");
    if (!/^\d{9,18}$/.test(a)) return { ok: false, status: 400, error: "Bank Account No must be 9 to 18 digits" };
    prepared.bankAccountNo = a;
  }
  if ("distanceFromResidenceKm" in prepared && prepared.distanceFromResidenceKm !== null) {
    const n = Number(prepared.distanceFromResidenceKm);
    if (!Number.isFinite(n) || n < 0 || n > 5000) return { ok: false, status: 400, error: "Distance must be a number of kilometres between 0 and 5000" };
    prepared.distanceFromResidenceKm = n;
  }
  for (const k of Object.keys(prepared)) {
    const v = prepared[k];
    if (typeof v !== "string") continue;
    const max = ADDRESS_KEYS.has(k) ? ADDRESS_MAX : SHORT_TEXT_MAX;
    if (v.trim().length > max) return { ok: false, status: 400, error: `${LABEL[k] ?? k} is too long (max ${max} characters)` };
  }
  if (typeof prepared.handicappedType === "string" && !["H", "V", "O"].includes(prepared.handicappedType.trim().toUpperCase())) {
    return { ok: false, status: 400, error: "Handicapped type must be H (Hearing), V (Visual) or O (Other)" };
  }

  // Same coercions the Office forms and the importer apply (Yes/No -> boolean, trimmed text, ...).
  const normalised = normalizeRosterDetails(prepared);
  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(normalised)) {
    if (!sameValue(v, (student as Record<string, unknown>)[k])) updates[k] = v;
  }

  // Dependent details follow the answer that controls them, so the record never says "No" and still carries details.
  const merged = { ...(student as Record<string, unknown>), ...updates };
  const clear = (k: string) => { if (merged[k] != null && merged[k] !== "") updates[k] = null; };
  if (merged.physicallyHandicapped === false) clear("handicappedType");
  if (merged.studiedOutsideAP === false) clear("studiedOutsideAPDetails");
  if (merged.familyIdLinkedOtherState === false) clear("familyIdLinkedOtherStateDetails");
  if (merged.parentsWorkingOutside === false) clear("parentsWorkingOutsideDetails");
  // "Permanent address same as temporary" means exactly that - keep the two copies identical.
  if (merged.permanentAddressSameAsTemporary === true) {
    const temp = (merged.temporaryAddress as string | null | undefined) ?? null;
    if (!sameValue(merged.permanentAddress, temp)) updates.permanentAddress = temp;
  }

  if (Object.keys(updates).length === 0 && mobile === undefined) return { ok: true, updates: {} };
  return { ok: true, updates, ...(mobile !== undefined ? { mobile } : {}) };
}

const LABEL: Record<string, string> = {
  fatherContactNo: "Father Contact Number", motherContactNo: "Mother Contact Number", guardianContact: "Guardian Contact Number",
  temporaryAddress: "Temporary Address", permanentAddress: "Permanent Address",
};
