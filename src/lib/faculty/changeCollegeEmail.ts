import { FieldValue } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { EMAIL_REGEX } from "@/lib/validations";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { forgetHeldRoles } from "@/lib/auth/liveRoles";

// Changing a faculty member's COLLEGE EMAIL (their login username). Done by the College Office only, keyed on the
// Employee ID (which never changes). The email lives in five places - Firebase Auth (the actual login), the faculty
// record, users/{uid}.email, users/{uid}.collegeEmail (some accounts) and systemUsers/{uid}.email - and this is the one
// function that changes all of them together, keeps the old address in `collegeEmailHistory`, and signs the person
// out everywhere (`users/{uid}.sessionsValidAfter`, see lib/auth/liveRoles.ts + api/auth/session).
//
// Write order (so a failure can always be put right):
//   1. stamp `emailChangePending {from,to}` on the record
//   2. change the email in Firebase Auth (uid, password, claims untouched)
//   3. ONE batch: record + users + systemUsers + history + clear the marker + the sign-out stamp
//   4. if (3) fails, the old email is put back in Auth and the error returned. If the process dies between 2 and 3,
//      the marker stays and submitting the same new email again finishes the change.

export type CollegeEmailErrorCode =
  | "NOT_FOUND" | "EMPLOYEE_ID_MISMATCH" | "INVALID_EMAIL" | "EMAIL_TAKEN" | "EMAIL_OUT_OF_SYNC" | "LOGIN_MISSING";

export class CollegeEmailError extends Error {
  constructor(public status: 400 | 404 | 409, public code: CollegeEmailErrorCode, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export const COLLEGE_EMAIL_CHANGE_REDIRECT_MESSAGE =
  "A faculty member's college email can only be changed by the College Office (College Office > Faculty > Change College Email) - it is their login, so every copy has to change together";

export const normalizeCollegeEmail = (raw: unknown): string => String(raw ?? "").trim().toLowerCase();

/**
 * True when an edit of a faculty-linked LOGIN (users/{uid}) carries a different email than the one stored - i.e. it would
 * change the login's address. Values re-sent unchanged (the edit pages always do) are fine. Such edits go through
 * changeFacultyCollegeEmail instead, so Firebase Auth, the record and every mirror stay in step.
 */
export function changesFacultyLoginEmail(
  stored: { email?: unknown; collegeEmail?: unknown },
  sent: { email?: unknown; collegeEmail?: unknown },
): boolean {
  if (sent.email !== undefined && normalizeCollegeEmail(sent.email) !== normalizeCollegeEmail(stored.email)) return true;
  if (sent.collegeEmail !== undefined && normalizeCollegeEmail(sent.collegeEmail) !== normalizeCollegeEmail(stored.collegeEmail)) return true;
  return false;
}

const isAuthError = (e: unknown, code: string) => !!e && typeof e === "object" && (e as { code?: string }).code === code;

export interface ChangeCollegeEmailInput {
  collegeId: string;
  facultyId: string;
  /** The Employee ID the caller is looking at - must match the record (guards against changing the wrong row). */
  expectedEmployeeId: string;
  newEmail: string;
  actor: { uid: string; name?: string };
}

export interface ChangeCollegeEmailResult {
  changed: boolean;
  oldEmail: string;
  newEmail: string;
  /** True when a login existed and was signed out everywhere. */
  signedOut: boolean;
}

/**
 * A reason this address can't be used, or null. Firebase Auth is the global authority (one login per address); the
 * college's faculty, supporting-staff and login documents are checked too. `exceptUid` / `exceptFacultyId` are the
 * person being changed.
 */
export async function collegeEmailConflict(
  db: Firestore, auth: Auth, collegeId: string, email: string, except: { uid?: string; facultyId?: string } = {},
): Promise<string | null> {
  try {
    const existing = await auth.getUserByEmail(email);
    if (existing.uid !== except.uid) return "That email address is already used by another login";
  } catch (e) {
    if (!isAuthError(e, "auth/user-not-found")) throw e;
  }
  const college = db.collection("colleges").doc(collegeId);
  const [faculty, staff, usersByEmail, usersByCollege] = await Promise.all([
    college.collection("facultyMembers").where("collegeEmail", "==", email).limit(3).get(),
    college.collection("supportingStaff").where("collegeEmail", "==", email).limit(3).get(),
    college.collection("users").where("email", "==", email).limit(3).get(),
    college.collection("users").where("collegeEmail", "==", email).limit(3).get(),
  ]);
  if (faculty.docs.some((d) => d.id !== except.facultyId)) return "That email address is already the college email of another faculty member";
  if (staff.docs.length > 0) return "That email address is already the college email of a staff member";
  if ([...usersByEmail.docs, ...usersByCollege.docs].some((d) => d.id !== except.uid)) return "That email address is already used by another account in this college";
  return null;
}

export async function changeFacultyCollegeEmail(db: Firestore, auth: Auth, input: ChangeCollegeEmailInput): Promise<ChangeCollegeEmailResult> {
  const { collegeId, facultyId, actor } = input;
  const college = db.collection("colleges").doc(collegeId);
  const ref = college.collection("facultyMembers").doc(facultyId);
  const snap = await ref.get();
  if (!snap.exists) throw new CollegeEmailError(404, "NOT_FOUND", "Faculty member not found");
  const f = snap.data() as { employeeId?: string; collegeEmail?: string; userUid?: string; legalName?: string; emailChangePending?: { from?: string; to?: string } };

  if ((f.employeeId ?? "").trim().toLowerCase() !== (input.expectedEmployeeId ?? "").trim().toLowerCase()) {
    throw new CollegeEmailError(409, "EMPLOYEE_ID_MISMATCH", "The Employee ID does not match this faculty record - reload the page and try again");
  }
  const newEmail = normalizeCollegeEmail(input.newEmail);
  if (!newEmail || !EMAIL_REGEX.test(newEmail)) throw new CollegeEmailError(400, "INVALID_EMAIL", "Enter a valid email address");

  const current = normalizeCollegeEmail(f.collegeEmail);
  const uid = f.userUid?.trim() || "";
  const pending = f.emailChangePending;
  const resuming = !!pending && normalizeCollegeEmail(pending.to) === newEmail;

  let authEmail = "";
  if (uid) {
    try {
      authEmail = normalizeCollegeEmail((await auth.getUser(uid)).email);
    } catch (e) {
      if (isAuthError(e, "auth/user-not-found")) throw new CollegeEmailError(409, "LOGIN_MISSING", "This faculty member's login account no longer exists - recreate the login first");
      throw e;
    }
    // The record and the login must agree before anything is changed - otherwise it is not clear which login is
    // being renamed. (Finishing an interrupted change is the one exception: Auth already holds the new address.)
    const finishing = resuming && authEmail === newEmail;
    if (authEmail !== current && !finishing) {
      throw new CollegeEmailError(409, "EMAIL_OUT_OF_SYNC",
        `This faculty member's login email (${authEmail || "none"}) is different from the college email on their record (${current || "none"}). It needs a manual review before it can be changed.`,
        { recordEmail: current, loginEmail: authEmail });
    }
  }

  if (newEmail === current && !resuming) return { changed: false, oldEmail: current, newEmail, signedOut: false };

  if (!(resuming && (!uid || authEmail === newEmail))) {
    const conflict = await collegeEmailConflict(db, auth, collegeId, newEmail, { uid: uid || undefined, facultyId });
    if (conflict) throw new CollegeEmailError(409, "EMAIL_TAKEN", conflict);
  }

  const now = new Date();
  const oldEmail = resuming && pending?.from ? normalizeCollegeEmail(pending.from) : current;
  await ref.update({ emailChangePending: { from: oldEmail, to: newEmail, at: now, by: actor.uid } });

  let authChanged = false;
  if (uid && authEmail !== newEmail) {
    try {
      await auth.updateUser(uid, { email: newEmail });
      authChanged = true;
    } catch (e) {
      await ref.update({ emailChangePending: FieldValue.delete() }).catch(() => undefined);
      if (isAuthError(e, "auth/email-already-exists")) throw new CollegeEmailError(409, "EMAIL_TAKEN", "That email address is already used by another login");
      if (isAuthError(e, "auth/invalid-email")) throw new CollegeEmailError(400, "INVALID_EMAIL", "Enter a valid email address");
      throw e;
    }
  }

  try {
    const batch = db.batch();
    const recordUpdate: Record<string, unknown> = { collegeEmail: newEmail, emailChangePending: FieldValue.delete(), updatedAt: now };
    if (oldEmail && oldEmail !== newEmail) recordUpdate.collegeEmailHistory = FieldValue.arrayUnion({ email: oldEmail, changedAt: now, changedBy: actor.uid });
    batch.update(ref, recordUpdate);
    if (uid) {
      const userRef = college.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        // +1: tokens issued in the same second as the change count as older too (Firebase's own revoke has second granularity).
        const userUpdate: Record<string, unknown> = { email: newEmail, updatedAt: now, sessionsValidAfter: Math.floor(now.getTime() / 1000) + 1 };
        if ((userSnap.data() as { collegeEmail?: unknown }).collegeEmail !== undefined) userUpdate.collegeEmail = newEmail;
        batch.update(userRef, userUpdate);
      }
      batch.set(db.collection("systemUsers").doc(uid), { email: newEmail }, { merge: true });
    }
    await batch.commit();
  } catch (e) {
    if (authChanged && uid) await auth.updateUser(uid, { email: authEmail }).catch((revertErr) => console.error("[changeCollegeEmail] could not restore the login email", uid, revertErr));
    await ref.update({ emailChangePending: FieldValue.delete() }).catch(() => undefined);
    throw e;
  }

  // Signed out everywhere: no new Firebase tokens (refresh tokens revoked) and every existing session cookie is refused
  // (sessionsValidAfter, checked by liveRoles + api/auth/session). The revoke is best effort - the stamp is the guard.
  if (uid) {
    forgetHeldRoles(collegeId, uid);
    await auth.revokeRefreshTokens(uid).catch((e) => console.error("[changeCollegeEmail] could not revoke refresh tokens", uid, e));
  }

  await writeAuditLogSafe(db, collegeId, {
    action: "FACULTY_COLLEGE_EMAIL_CHANGED", performedBy: actor.uid, performedByName: actor.name, targetId: facultyId,
    details: { employeeId: f.employeeId, from: oldEmail, to: newEmail, loginChanged: authChanged, signedOut: !!uid },
  });
  if (uid) {
    // In-app only (no email is sent). Shown when they sign in again.
    await notify(db, collegeId, uid, "COLLEGE_EMAIL_CHANGED", "Your college email was changed",
      `The College Office changed your college email from ${oldEmail || "(none)"} to ${newEmail}. Sign in again with your Employee ID or your new email and your existing password.`);
  }
  return { changed: true, oldEmail, newEmail, signedOut: !!uid };
}
