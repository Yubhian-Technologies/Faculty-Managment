import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { DEFAULT_STUDENT_PASSWORD, studentLoginEmail } from "@/lib/students/loginDefaults";
import type { StudentRecord } from "@/types";

export class StudentLoginError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

// Creates (or, if already created, returns) a Firebase Auth login for one
// student, links it back onto the student's own roster doc, and writes the
// thin colleges/{collegeId}/users/{uid} profile doc every other COLLEGE-scoped
// role already resolves a session against - see api/auth/session/route.ts,
// which needs no changes for STUDENT to work once this doc exists.
//
// Safely re-runnable: if a prior call created the Firebase Auth user but
// failed before the Firestore writes below, calling this again reuses that
// same Auth user (via getUserByEmail) rather than erroring or leaving an
// orphan - same tolerance scripts/create-admin.mjs already accepts.
export async function provisionStudentLogin(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  studentDocId: string,
  student: StudentRecord,
  performedByUid: string
): Promise<{ uid: string; loginEmail: string; alreadyExisted: boolean }> {
  if (student.uid && student.loginEmail) {
    return { uid: student.uid, loginEmail: student.loginEmail, alreadyExisted: true };
  }
  if (!student.rollNumber?.trim()) {
    throw new StudentLoginError("Student has no Roll Number on file - set one before creating a login", 400);
  }
  if (student.status !== "REGULAR") {
    throw new StudentLoginError("Only REGULAR students can be issued a login", 400);
  }

  const rollNumberUpper = student.rollNumber.trim().toUpperCase();
  const collegeRef = db.collection("colleges").doc(collegeId);

  // Reject a second login for a roll number that already has one in this
  // college - this is what keeps /api/auth/resolve-student-login's own
  // "more than one match" case rare instead of routine (roll numbers are only
  // unique within one branch+year, not across the whole college - see
  // students/[id]/route.ts's own doc-comment on this).
  // Single-field query on rollNumberUpper avoids requiring a Firestore composite index.
  const dupSnap = await collegeRef
    .collection("students")
    .where("rollNumberUpper", "==", rollNumberUpper)
    .get();
  const existingLogin = dupSnap.docs.find(
    (doc) => doc.id !== studentDocId && Boolean(doc.data().uid)
  );
  if (existingLogin) {
    throw new StudentLoginError(
      "Another student with this Roll Number already has a login - set a unique Roll Number first",
      400
    );
  }

  const loginEmail = studentLoginEmail(student.rollNumber);

  let uid: string;
  try {
    const created = await adminAuth.createUser({
      email: loginEmail,
      password: DEFAULT_STUDENT_PASSWORD,
      displayName: student.name,
    });
    uid = created.uid;
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === "auth/email-already-exists") {
      const existing = await adminAuth.getUserByEmail(loginEmail);
      uid = existing.uid;
    } else {
      throw err;
    }
  }

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
  batch.set(db.collection("studentUsernames").doc(rollNumberUpper), {
    uid,
    collegeId,
    studentDocId,
    rollNumber: student.rollNumber,
    rollNumberUpper,
    loginEmail,
    createdAt: now,
  });
  batch.update(collegeRef.collection("students").doc(studentDocId), {
    uid,
    loginEmail,
    rollNumberUpper,
    loginCreatedAt: now,
    loginCreatedBy: performedByUid,
  });
  await batch.commit();

  return { uid, loginEmail, alreadyExisted: false };
}

export async function resetStudentLoginPassword(adminAuth: Auth, uid: string): Promise<void> {
  await adminAuth.updateUser(uid, { password: DEFAULT_STUDENT_PASSWORD });
}
