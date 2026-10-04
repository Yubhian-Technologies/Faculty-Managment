import type { Firestore } from "firebase-admin/firestore";
import { isReadOnlyFacultyStatus } from "@/lib/auth/readOnlyAccess";

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
