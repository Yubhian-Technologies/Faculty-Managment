import type { Firestore } from "firebase-admin/firestore";
import { isReadOnlyFacultyCollege, isReadOnlyFacultyStatus, READ_ONLY_FACULTY_STATUSES } from "@/lib/auth/readOnlyAccess";

/**
 * Whether this login's linked faculty record (facultyMembers.userUid == uid) is
 * RESIGNED or RETIRED. facultyMembers.status is the only source of truth.
 *
 * One single-field equality query (served by the automatic index), limit 1 - one
 * document read. Throws if Firestore fails; the caller decides the fail-closed
 * behaviour (see liveRoles.ts). A login with no linked faculty record is simply
 * not read-only.
 */
export async function isFacultyExited(db: Firestore, collegeId: string, uid: string): Promise<boolean> {
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("facultyMembers")
    .where("userUid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return false;
  return isReadOnlyFacultyStatus((snap.docs[0].data() as { status?: unknown }).status);
}

/**
 * Logins of every RESIGNED/RETIRED faculty member in the college - for the "who can I pick?" lists only
 * (Department Office, Sub-HOD, Leave Handover, Role Assignments), which must not offer someone who can no
 * longer be given a post. Switch-gated: an empty set and ZERO reads unless this college has read-only faculty
 * access switched on. One query (status in [...]), never a per-person read. Throws if Firestore fails.
 */
export async function exitedFacultyUids(db: Firestore, collegeId: string): Promise<Set<string>> {
  if (!isReadOnlyFacultyCollege(collegeId)) return new Set();
  const snap = await db
    .collection("colleges").doc(collegeId)
    .collection("facultyMembers")
    .where("status", "in", [...READ_ONLY_FACULTY_STATUSES])
    .get();
  const uids = new Set<string>();
  for (const d of snap.docs) {
    const uid = (d.data() as { userUid?: unknown }).userUid;
    if (typeof uid === "string" && uid) uids.add(uid);
  }
  return uids;
}

/**
 * exitedFacultyUids, but a lookup failure means "exclude nobody": a picker would rather show everyone (the
 * server still refuses the appointment itself - see lib/roles/seatEligibility.ts) than hide people by mistake.
 */
export async function exitedFacultyUidsOrNone(db: Firestore, collegeId: string): Promise<Set<string>> {
  try { return await exitedFacultyUids(db, collegeId); }
  catch (e) { console.error("[exitedFacultyUids] lookup failed - not filtering the picker:", e); return new Set(); }
}
