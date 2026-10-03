import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { retireStudentRoll } from "@/lib/students/rollIdentity";

// "Removing" a student archives them; nothing is erased.
//
// The roster, attendance, strength and login code all assume a student document
// in `students` is a live student, so an `archivedAt` flag on that document would
// have to be remembered by every one of those queries. Instead the whole record
// is copied to colleges/{id}/archivedStudents/{studentId} - together with its
// departmentHistory - and only then taken out of `students`, so every existing
// query stays correct and the data stays recoverable (scripts/restore-archived-
// student.mjs puts it back).
//
// What happens to the rest of what hung off the student:
//  - login: the Firebase Auth user is DISABLED and its email moved to a
//    tombstone (the original is kept in the archive), which frees the roll
//    number's login identity for a re-admission while keeping the account
//    restorable; the users/ profile is flagged inactive and the roll's global
//    registry entry is retired (so the number can be claimed again) - none deleted;
//  - library: a student with an unreturned book cannot be archived (the librarian
//    must take it back first); waiting/notified reservations are cancelled;
//  - attendance, internal marks, certificates and uploaded documents are left in
//    place untouched - attendance sessions embed the student, so the history
//    stays whole.
// Ordered so a failure part-way is safe to simply run again: the archive copy is
// written first and is idempotent, Auth is changed before the live document goes,
// and the live document is removed last.

export interface ArchiveActor {
  uid: string;
  name?: string;
}

export type ArchiveResult = { ok: true } | { ok: false; reason: string; code: "NOT_FOUND" | "ACTIVE_LOANS" };

const ACTIVE_LOAN_STATUSES = ["ACTIVE", "OVERDUE"];
const OPEN_RESERVATION_STATUSES = ["WAITING", "NOTIFIED"];

export function archivedLoginEmail(uid: string): string {
  return `${uid.toLowerCase()}.archived@students.internal`;
}

export async function archiveStudent(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  studentId: string,
  actor: ArchiveActor,
  reason: string
): Promise<ArchiveResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const studentRef = collegeRef.collection("students").doc(studentId);
  const snap = await studentRef.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND", reason: "Student not found" };
  const data = snap.data() as Record<string, unknown> & { uid?: string; loginEmail?: string };

  const loans = await collegeRef.collection("bookLoans").where("studentId", "==", studentId).get();
  if (loans.docs.some((d) => ACTIVE_LOAN_STATUSES.includes(String((d.data() as { status?: string }).status)))) {
    return { ok: false, code: "ACTIVE_LOANS", reason: "has unreturned library books - take them back first" };
  }

  const [historySnap, reservations] = await Promise.all([
    studentRef.collection("departmentHistory").get(),
    collegeRef.collection("bookReservations").where("studentId", "==", studentId).get(),
  ]);

  const now = new Date();
  await collegeRef.collection("archivedStudents").doc(studentId).set({
    ...data,
    archivedAt: now,
    archivedBy: actor.uid,
    ...(actor.name ? { archivedByName: actor.name } : {}),
    archiveReason: reason,
    archiveVersion: 1,
    departmentHistory: historySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    archivedLogin: data.uid ? { uid: data.uid, loginEmail: data.loginEmail ?? "" } : null,
  });

  if (data.uid) {
    try {
      await adminAuth.updateUser(data.uid, { disabled: true, email: archivedLoginEmail(data.uid) });
    } catch (err) {
      if ((err as { code?: string })?.code !== "auth/user-not-found") throw err;
    }
    const userRef = collegeRef.collection("users").doc(data.uid);
    if ((await userRef.get()).exists) await userRef.update({ isActive: false, archivedAt: now });
  }
  // The student no longer holds their roll number: retire its registry entry (and
  // any legacy one carrying their login) so the number can be claimed again.
  await retireStudentRoll(
    db,
    { roll: typeof data.rollNumber === "string" ? data.rollNumber : undefined, collegeId, studentDocId: studentId, uid: data.uid },
    now,
    { archivedAt: now }
  );

  const batch = db.batch();
  for (const r of reservations.docs) {
    if (OPEN_RESERVATION_STATUSES.includes(String((r.data() as { status?: string }).status))) {
      batch.update(r.ref, { status: "CANCELLED", updatedAt: now });
    }
  }
  for (const h of historySnap.docs) batch.delete(h.ref);
  batch.delete(studentRef);
  await batch.commit();

  return { ok: true };
}
