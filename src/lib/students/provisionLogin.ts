import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { rollNumberUpperOf, studentLoginEmailForRoll, studentRollDocId, studentRollKey } from "@/lib/students/loginDefaults";
import { studentPasswordError } from "@/lib/students/passwordPolicy";
import { REGISTRY_COLLECTION, claimStudentRoll, registryRef, releaseStudentRoll, rollTakenMessage } from "@/lib/students/rollIdentity";
import type { StudentRecord } from "@/types";

export class StudentLoginError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export interface ProvisionResult {
  uid: string;
  loginEmail: string;
  alreadyExisted: boolean;
}

function isAuthError(err: unknown, code: string): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === code;
}

// Creates (or, if already created, returns) a Firebase Auth login for one
// student and links it back onto the student's own roster doc, plus the thin
// colleges/{collegeId}/users/{uid} profile doc every other COLLEGE-scoped role
// resolves a session against (see api/auth/session/route.ts).
//
// Identity (see loginDefaults.ts): the normalised Roll Number alone - roll numbers
// are globally unique, so there is no college in it and case/format variants of a
// roll can never become two accounts. The password is the one the college office
// supplies; it is handed to Firebase Auth and goes nowhere else (never stored,
// logged or returned).
//
// Safely re-runnable, and never leaves a half-created account behind: if
// anything after the Auth user is created fails, an Auth user THIS call created
// is deleted again. An Auth user that already existed for this exact email with
// no profile anywhere (an orphan from an older failed run) is reused rather than
// failing, and kept if the work then fails (it was not ours to remove).
export async function provisionStudentLogin(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  studentDocId: string,
  student: StudentRecord,
  performedByUid: string,
  password: string
): Promise<ProvisionResult> {
  if (student.uid && student.loginEmail) {
    return { uid: student.uid, loginEmail: student.loginEmail, alreadyExisted: true };
  }
  if (!student.rollNumber?.trim()) {
    throw new StudentLoginError("Student has no Roll Number on file - set one before creating a login", 400);
  }
  if (student.status !== "REGULAR") {
    throw new StudentLoginError("Only REGULAR students can be issued a login", 400);
  }
  const key = studentRollKey(student.rollNumber);
  if (!key) {
    throw new StudentLoginError("This Roll Number has no letters or digits - correct it before creating a login", 400);
  }
  const passwordProblem = studentPasswordError(password);
  if (passwordProblem) throw new StudentLoginError(passwordProblem, 400);

  const rollNumberUpper = rollNumberUpperOf(student.rollNumber);
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Two students of this college holding the same roll with a login already
  // (data from before roll uniqueness was enforced) - refuse a second login.
  const dupSnap = await collegeRef.collection("students").where("rollNumberUpper", "==", rollNumberUpper).get();
  if (dupSnap.docs.some((doc) => doc.id !== studentDocId && Boolean(doc.data().uid))) {
    throw new StudentLoginError("Another student with this Roll Number already has a login - set a unique Roll Number first", 400);
  }

  // The global registry: this roll must be this student's. (A student written
  // before the registry existed gets their entry here.)
  const claim = await claimStudentRoll(db, { roll: student.rollNumber, collegeId, studentDocId, name: student.name });
  if (!claim.ok) {
    throw new StudentLoginError(
      claim.code === "TAKEN" ? rollTakenMessage(student.rollNumber, claim.holder) : "This Roll Number has no letters or digits",
      claim.code === "TAKEN" ? 409 : 400
    );
  }
  const usernameRef = registryRef(db, student.rollNumber);

  const loginEmail = studentLoginEmailForRoll(student.rollNumber);

  let uid: string;
  let createdByThisCall = false;
  try {
    const created = await adminAuth.createUser({ email: loginEmail, password, displayName: student.name });
    uid = created.uid;
    createdByThisCall = true;
  } catch (err) {
    if (!isAuthError(err, "auth/email-already-exists")) throw err;
    const existing = await adminAuth.getUserByEmail(loginEmail);
    // Whoever holds this Auth user must not be another student/person with a
    // profile - only an orphan (no profile document anywhere) is safe to reuse.
    const [byUid, profile, system, registered] = await Promise.all([
      collegeRef.collection("students").where("uid", "==", existing.uid).get(),
      collegeRef.collection("users").doc(existing.uid).get(),
      db.collection("systemUsers").doc(existing.uid).get(),
      db.collection(REGISTRY_COLLECTION).where("uid", "==", existing.uid).get(),
    ]);
    const heldByOther =
      byUid.docs.some((d) => d.id !== studentDocId) ||
      profile.exists ||
      system.exists ||
      registered.docs.some((d) => d.id !== studentRollDocId(student.rollNumber));
    if (heldByOther) {
      throw new StudentLoginError("A login with this identity already exists - contact your administrator", 409);
    }
    await adminAuth.updateUser(existing.uid, { password, disabled: false, displayName: student.name });
    uid = existing.uid;
  }

  try {
    await adminAuth.setCustomUserClaims(uid, { role: "STUDENT", collegeId });

    const now = new Date();
    const batch = db.batch();
    batch.set(collegeRef.collection("users").doc(uid), {
      uid,
      collegeId,
      name: student.name,
      email: loginEmail,
      role: "STUDENT",
      isActive: true,
      createdAt: now,
    });
    batch.set(db.collection("systemUsers").doc(uid), {
      uid,
      collegeId,
      role: "STUDENT",
      email: loginEmail,
      name: student.name,
      createdAt: now,
    });
    batch.set(
      usernameRef,
      { uid, loginEmail, collegeId, studentDocId, rollNumber: student.rollNumber.trim(), rollNumberUpper, rollKey: key, active: true },
      { merge: true }
    );
    batch.update(collegeRef.collection("students").doc(studentDocId), {
      uid,
      loginEmail,
      rollNumberUpper,
      loginCreatedAt: now,
      loginCreatedBy: performedByUid,
    });
    await batch.commit();
  } catch (err) {
    if (createdByThisCall) {
      try {
        await adminAuth.deleteUser(uid);
      } catch (cleanupErr) {
        console.error("[provisionStudentLogin] could not remove the Auth user after a failed write", uid, cleanupErr);
      }
    }
    throw err;
  }

  return { uid, loginEmail, alreadyExisted: false };
}

// Sets a student's login to a password the college office chose - the recovery
// path (their login email is synthetic, so Firebase's own reset mail can't reach
// them). The password goes to Firebase Auth only. Does not re-enable a disabled
// (graduated / archived) login: that is a separate decision.
export async function resetStudentLoginPassword(adminAuth: Auth, uid: string, password: string): Promise<void> {
  const problem = studentPasswordError(password);
  if (problem) throw new StudentLoginError(problem, 400);
  await adminAuth.updateUser(uid, { password });
}

// Clears the "must change password" hold. Nothing sets that hold for new logins
// any more (the office chooses the password and students may change it whenever
// they like), but a record that still carries the flag from the earlier one-time-
// password scheme is honoured, and this is how a held student leaves it.
export async function clearMustChangePassword(
  db: Firestore,
  collegeId: string,
  studentDocId: string,
  uid: string
): Promise<void> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const now = new Date();
  const batch = db.batch();
  batch.update(collegeRef.collection("students").doc(studentDocId), { mustChangePassword: false, passwordChangedAt: now });
  const userRef = collegeRef.collection("users").doc(uid);
  if ((await userRef.get()).exists) batch.update(userRef, { mustChangePassword: false, passwordChangedAt: now });
  await batch.commit();
}

// Enables or disables a student's login without removing anything: Firebase
// Auth's `disabled` flag blocks sign-in and the profile is only flagged. Used when
// a student graduates (off) or a graduation is undone (on). The student still
// holds their roll number either way, so the registry is not touched.
export async function setStudentLoginActive(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  uid: string,
  active: boolean
): Promise<void> {
  try {
    await adminAuth.updateUser(uid, { disabled: !active });
  } catch (err) {
    if (!isAuthError(err, "auth/user-not-found")) throw err;
  }
  const userRef = db.collection("colleges").doc(collegeId).collection("users").doc(uid);
  if ((await userRef.get()).exists) await userRef.update({ isActive: active });
}

// A changed roll number keeps the login in step: the student keeps their Auth
// account but its email moves to the new roll's address, the NEW roll now
// resolves to it, the OLD roll's registry entry is retired (so another student can
// have that number, with no stale email left in Auth), and the student document's
// rollNumberUpper moves too. Order, so a failure part-way is undone:
//   1. claim the new roll globally (refused if another student holds it);
//   2. change the Auth email;
//   3. one Firestore batch for everything else;
// and a failure at step 3 puts the Auth email back and releases the claim.
// Safe on a student with no login (only the document and registry change).
export async function syncStudentRollChange(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  studentDocId: string,
  before: Pick<StudentRecord, "rollNumber" | "uid" | "loginEmail" | "name">,
  newRoll: string,
  // Other fields to write on the student document in the SAME atomic batch
  // (e.g. a status or lab-batch edit that arrived with the roll change).
  extraStudentFields: Record<string, unknown> = {}
): Promise<void> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const studentRef = collegeRef.collection("students").doc(studentDocId);
  const roll = newRoll.trim();
  const newUpper = rollNumberUpperOf(roll);

  if (!roll) {
    await studentRef.update({ ...extraStudentFields, rollNumber: "", rollNumberUpper: "" });
    return;
  }
  const newKey = studentRollKey(roll);
  if (!newKey) throw new StudentLoginError("This Roll Number has no letters or digits", 400);

  const claim = await claimStudentRoll(db, { roll, collegeId, studentDocId, name: before.name, uid: before.uid });
  if (!claim.ok) {
    throw new StudentLoginError(claim.code === "TAKEN" ? rollTakenMessage(roll, claim.holder) : "This Roll Number has no letters or digits", 400);
  }
  const undoClaim = async () => {
    if (!claim.created) return;
    try {
      await releaseStudentRoll(db, roll, collegeId, studentDocId);
    } catch (e) {
      console.error("[syncStudentRollChange] could not release the roll claim", roll, e);
    }
  };

  const uid = before.uid;
  const hasLogin = !!uid && !!before.loginEmail;
  const newEmail = hasLogin ? studentLoginEmailForRoll(roll) : undefined;
  let emailChanged = false;
  if (hasLogin && newEmail !== before.loginEmail) {
    try {
      await adminAuth.updateUser(uid as string, { email: newEmail });
      emailChanged = true;
    } catch (err) {
      await undoClaim();
      if (isAuthError(err, "auth/email-already-exists")) {
        throw new StudentLoginError("A login with this identity already exists - contact your administrator", 409);
      }
      throw err;
    }
  }

  try {
    const newRef = registryRef(db, roll);
    const now = new Date();
    const batch = db.batch();
    batch.update(studentRef, { ...extraStudentFields, rollNumber: roll, rollNumberUpper: newUpper, ...(hasLogin ? { loginEmail: newEmail } : {}) });
    if (hasLogin) {
      batch.set(newRef, { uid, loginEmail: newEmail, rollKey: newKey, active: true }, { merge: true });
      const profile = collegeRef.collection("users").doc(uid as string);
      if ((await profile.get()).exists) batch.update(profile, { email: newEmail });
      const system = db.collection("systemUsers").doc(uid as string);
      if ((await system.get()).exists) batch.update(system, { email: newEmail });
    }
    // Retire whatever pointed the OLD roll at this student - the global entry
    // and/or the legacy roll-keyed one - without deleting it.
    const oldRoll = before.rollNumber ?? "";
    const oldRefs = [
      ...(studentRollKey(oldRoll) ? [registryRef(db, oldRoll)] : []),
      ...(rollNumberUpperOf(oldRoll) && !rollNumberUpperOf(oldRoll).includes("/") ? [db.collection(REGISTRY_COLLECTION).doc(rollNumberUpperOf(oldRoll))] : []),
    ];
    const seen = new Set<string>([newRef.path]);
    for (const ref of oldRefs) {
      if (seen.has(ref.path)) continue;
      seen.add(ref.path);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const cur = snap.data() as { collegeId?: string; studentDocId?: string; uid?: string };
      const mine = (cur.collegeId === collegeId && cur.studentDocId === studentDocId) || (!!uid && cur.uid === uid);
      if (mine) batch.update(ref, { active: false, supersededAt: now });
    }
    await batch.commit();
  } catch (err) {
    if (emailChanged) {
      try {
        await adminAuth.updateUser(uid as string, { email: before.loginEmail });
      } catch (revertErr) {
        console.error("[syncStudentRollChange] could not restore the Auth email", uid, revertErr);
      }
    }
    await undoClaim();
    throw err;
  }
}
