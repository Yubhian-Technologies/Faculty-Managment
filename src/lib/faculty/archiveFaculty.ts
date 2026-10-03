import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";

// "Deleting" a faculty member archives them; nothing is erased.
//
// Their leave, attendance, payroll, research and appraisal records all point at
// them by id, and the faculty register / pickers all read `facultyMembers`, so
// the record is COPIED to colleges/{id}/archivedFacultyMembers/{facultyId} (with
// the login profile documents embedded) and only then taken out of the live
// collections. Every live query stays correct, and every record that refers to
// the person can still be traced to who they were. (scripts/restore-archived-
// faculty.mjs puts a record back.)
//
// A faculty member is NOT archived while the college still depends on them:
//  - teaching assignments / timetable slots name them (reassign first, or set
//    their status to Resigned/Retired, which keeps them on the register);
//  - they hold a role seat (Principal / HOD / ...), or are a section's faculty
//    in-charge, or a course-year's timetable in-charge - the seat or duty must be
//    handed over first, otherwise it would silently point at nobody.
//
// The login is DISABLED and its email moved to a tombstone (original kept in the
// archive): the real college email becomes free to reuse, the account stays
// restorable, and the person can no longer sign in. Ordered so a failure part-way
// is safe to run again: archive copy first (idempotent), Auth change before any
// live document is removed, the live documents removed last in one batch.

export interface ArchiveActor {
  uid: string;
  name?: string;
}

export type FacultyArchiveBlocker = "ASSIGNMENTS" | "ROLE_SEAT" | "SECTION_INCHARGE" | "TIMETABLE_INCHARGE";

export type ArchiveFacultyResult =
  | { ok: true }
  | { ok: false; code: "NOT_FOUND"; reason: string }
  | { ok: false; code: "BLOCKED"; blocker: FacultyArchiveBlocker; reason: string };

export function archivedFacultyEmail(uid: string): string {
  return `archived.${uid.toLowerCase()}@archived.invalid`;
}

export async function archiveFaculty(
  db: Firestore,
  adminAuth: Auth,
  collegeId: string,
  facultyId: string,
  actor: ArchiveActor,
  reason: string
): Promise<ArchiveFacultyResult> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const facultyRef = collegeRef.collection("facultyMembers").doc(facultyId);
  const snap = await facultyRef.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND", reason: "Not found" };
  const data = snap.data() as Record<string, unknown> & { userUid?: string; collegeEmail?: string };
  const uid = data.userUid;

  const [assignment, slot] = await Promise.all([
    collegeRef.collection("teachingAssignments").where("facultyId", "==", facultyId).limit(1).get(),
    collegeRef.collection("timetableSlots").where("facultyId", "==", facultyId).limit(1).get(),
  ]);
  if (!assignment.empty || !slot.empty) {
    return {
      ok: false,
      code: "BLOCKED",
      blocker: "ASSIGNMENTS",
      reason:
        "This faculty member still has active teaching assignments or timetable slots. Remove/reassign those first, or set their status to Resigned/Retired instead of deleting the record.",
    };
  }

  if (uid) {
    const [seats, incharge, tt] = await Promise.all([
      collegeRef.collection("roleSeats").where("holderUid", "==", uid).limit(1).get(),
      // Section.facultyInchargeUid holds the login uid, but some historical rows
      // stored the faculty record's own id (see getFacultyIdCandidates) - match both.
      collegeRef.collection("sections").where("facultyInchargeUid", "in", [uid, facultyId]).limit(1).get(),
      collegeRef.collection("timetableIncharges").where("uid", "==", uid).limit(1).get(),
    ]);
    if (!seats.empty) {
      const role = (seats.docs[0].data() as { role?: string }).role;
      return { ok: false, code: "BLOCKED", blocker: "ROLE_SEAT", reason: `This person holds a role seat${role ? ` (${role})` : ""} - hand the seat over before removing them.` };
    }
    if (!incharge.empty) {
      return { ok: false, code: "BLOCKED", blocker: "SECTION_INCHARGE", reason: "This person is a section's faculty in-charge - assign someone else to that section first." };
    }
    if (!tt.empty) {
      return { ok: false, code: "BLOCKED", blocker: "TIMETABLE_INCHARGE", reason: "This person is a timetable in-charge for a course/year - reassign that first." };
    }
  }

  const userRef = uid ? collegeRef.collection("users").doc(uid) : null;
  const systemRef = uid ? db.collection("systemUsers").doc(uid) : null;
  const [userSnap, systemSnap] = await Promise.all([userRef?.get(), systemRef?.get()]);

  const now = new Date();
  await collegeRef.collection("archivedFacultyMembers").doc(facultyId).set({
    ...data,
    archivedAt: now,
    archivedBy: actor.uid,
    ...(actor.name ? { archivedByName: actor.name } : {}),
    archiveReason: reason,
    archiveVersion: 1,
    archivedLogin: uid
      ? { uid, loginEmail: data.collegeEmail ?? "", userDoc: userSnap?.data() ?? null, systemUserDoc: systemSnap?.data() ?? null }
      : null,
  });

  if (uid) {
    try {
      await adminAuth.updateUser(uid, { disabled: true, email: archivedFacultyEmail(uid) });
    } catch (err) {
      if ((err as { code?: string })?.code !== "auth/user-not-found") throw err;
    }
  }

  const batch = db.batch();
  batch.delete(facultyRef);
  if (userRef && userSnap?.exists) batch.delete(userRef);
  if (systemRef && systemSnap?.exists) batch.delete(systemRef);
  await batch.commit();

  return { ok: true };
}
