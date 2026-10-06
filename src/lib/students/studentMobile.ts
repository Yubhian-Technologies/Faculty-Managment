import type { Firestore } from "firebase-admin/firestore";

// Student Mobile No - REQUIRED, and unique across ALL students of ALL colleges.
//
// The Office enrols students before roll numbers exist, so the student's own mobile number is the reference that
// later maps a Roll No onto the right student. That only works if every student has one, no two students (in any
// college) share one, and the same number typed two ways ("98765 43210", "+91 9876543210") counts as the same number.
//
// ENFORCEMENT
//  - Required on add and import. On edit it can be changed but never cleared; a legacy student saved with none stays
//    editable (like a legacy roll-less student) until one is entered.
//  - Format: exactly 10 digits starting 6-9, after dropping a leading +91 / 91 / 0 and any spaces or dashes. Checked
//    only when a value is being set or changed - a saved number that is re-sent unchanged is never re-judged.
//  - Stored value: the 10 digits (so what is on file is always comparable).
//  - Uniqueness: `studentMobileKeys/{10 digits}` claim documents (one global collection, like the roll registry
//    `studentUsernames`) taken in a transaction - two imports or adds at the same moment, in the same college or in
//    different ones, cannot both win - plus a lookup of this college's students already saved with that exact number.
//  - A claim is "live" only while its student exists AND still holds that number; otherwise it is stale and may be
//    taken over. That is why nothing has to be released when a student is deleted or their number is changed - and a
//    claim for a student document that does not exist yet (the write is still being made) counts as live for
//    PENDING_MS only, exactly like the employee-ID locks (lib/firestore/employeeIdKeys.ts).
//  - LIMIT (same as the roll registry): a student of ANOTHER college saved before the claim documents existed has none
//    until scripts/backfill-student-mobile-keys.mjs has run, so their number is not seen from here until then.
//  - The roll number stays what it was: optional, and unique across ALL colleges when given (rollIdentity.ts).

export const STUDENT_MOBILE_KEYS = "studentMobileKeys";
const PENDING_MS = 2 * 60 * 1000;
const VALID = /^[6-9]\d{9}$/;

/** The 10-digit form of whatever was typed ("" when nothing usable). */
export function normalizeStudentMobile(raw: unknown): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export const STUDENT_MOBILE_REQUIRED_MESSAGE = "Student Mobile No is required";
export const STUDENT_MOBILE_FORMAT_MESSAGE = "Student Mobile No must be exactly 10 digits, starting with 6, 7, 8 or 9";
export const STUDENT_MOBILE_CLEAR_MESSAGE = "A student's Student Mobile No can't be removed - change it to the correct number instead";

/** A human-readable problem with a Student Mobile No being saved, or null. A blank value IS a problem: it is required. */
export function studentMobileProblem(raw: unknown): string | null {
  const typed = String(raw ?? "").trim();
  if (!typed) return STUDENT_MOBILE_REQUIRED_MESSAGE;
  return VALID.test(normalizeStudentMobile(typed)) ? null : STUDENT_MOBILE_FORMAT_MESSAGE;
}

export interface StudentMobileHolder {
  id: string;
  name?: string;
  rollNumber?: string;
  /** Held by a student of the caller's own college (so the name may be shown). */
  sameCollege: boolean;
}

/** Names the holder only when they are in the caller's own college - never reveals another college's student. */
export function studentMobileTakenMessage(mobile: string, holder: { name?: string; rollNumber?: string; sameCollege?: boolean }): string {
  if (holder.sameCollege === false) return `Student Mobile No ${mobile} is already used by a student of another college`;
  const who = [holder.name?.trim(), holder.rollNumber?.trim() ? `Roll No ${holder.rollNumber.trim()}` : ""].filter(Boolean).join(", ");
  return `Student Mobile No ${mobile} is already used by another student${who ? ` (${who})` : ""}`;
}

export const STUDENT_MOBILE_TAKEN = "STUDENT_MOBILE_TAKEN";
export class StudentMobileTakenError extends Error {
  constructor(public mobile: string, public holder: { name?: string; rollNumber?: string; sameCollege: boolean }) {
    super(STUDENT_MOBILE_TAKEN);
  }
  get userMessage() { return studentMobileTakenMessage(this.mobile, this.holder); }
}
export const isStudentMobileTaken = (e: unknown): e is StudentMobileTakenError => e instanceof StudentMobileTakenError;

const studentsOf = (db: Firestore, collegeId: string) => db.collection("colleges").doc(collegeId).collection("students");
const keyRef = (db: Firestore, mobile: string) => db.collection(STUDENT_MOBILE_KEYS).doc(mobile);

/**
 * Another saved student of this college holding this number (by the stored value), or null. Covers students written
 * before the claim documents existed; `exceptStudentId` is the student being edited.
 */
export async function findStudentMobileHolder(db: Firestore, collegeId: string, mobile: string, exceptStudentId?: string): Promise<StudentMobileHolder | null> {
  const snap = await studentsOf(db, collegeId).where("mobileNo", "==", mobile).limit(3).get();
  const hit = snap.docs.find((d) => d.id !== exceptStudentId);
  if (!hit) return null;
  const data = hit.data() as { name?: string; rollNumber?: string };
  return { id: hit.id, name: data.name, rollNumber: data.rollNumber, sameCollege: true };
}

/**
 * Takes the number for this student. Throws StudentMobileTakenError when another student - in this or any other college -
 * holds it (a saved student of this college with that number, or a live claim). Idempotent for the same student. Give
 * it back with releaseStudentMobile when the write that needed it fails.
 */
export async function reserveStudentMobile(db: Firestore, collegeId: string, mobile: string, studentId: string): Promise<void> {
  const saved = await findStudentMobileHolder(db, collegeId, mobile, studentId);
  if (saved) throw new StudentMobileTakenError(mobile, saved);

  const ref = keyRef(db, mobile);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data() as { studentId?: string; collegeId?: string; reservedAt?: { toMillis?: () => number } | Date };
      const holderCollege = d.collegeId ?? collegeId;
      const mine = d.studentId === studentId && holderCollege === collegeId;
      if (d.studentId && !mine) {
        const owner = await tx.get(studentsOf(db, holderCollege).doc(d.studentId));
        const reservedAt = d.reservedAt instanceof Date ? d.reservedAt.getTime() : d.reservedAt?.toMillis?.() ?? 0;
        const live = owner.exists
          ? normalizeStudentMobile(owner.get("mobileNo")) === mobile
          : Date.now() - reservedAt < PENDING_MS;
        if (live) {
          const sameCollege = holderCollege === collegeId;
          throw new StudentMobileTakenError(mobile, {
            sameCollege,
            ...(sameCollege ? { name: owner.get("name") as string | undefined, rollNumber: owner.get("rollNumber") as string | undefined } : {}),
          });
        }
      }
    }
    tx.set(ref, { studentId, collegeId, reservedAt: new Date() });
  });
}

/** Best effort: removes this student's claim (a failed write that had reserved it). Never throws. */
export async function releaseStudentMobile(db: Firestore, collegeId: string, mobile: string, studentId: string): Promise<void> {
  try {
    const ref = keyRef(db, mobile);
    const snap = await ref.get();
    if (snap.exists && snap.get("studentId") === studentId && (snap.get("collegeId") ?? collegeId) === collegeId) await ref.delete();
  } catch {
    // The claim goes stale on its own after PENDING_MS.
  }
}
