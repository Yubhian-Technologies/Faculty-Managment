import type { Firestore } from "firebase-admin/firestore";

// colleges/{collegeId}/attendanceCheckInPermissions/{uid}_{dateISO} - see
// AttendanceCheckInPermission in src/types/attendance.ts for the full shape
// and why this is a distinct concept from permissionRequestId.

export const CHECKIN_PERMISSIONS_COL = (collegeId: string, db: Firestore) =>
  db.collection("colleges").doc(collegeId).collection("attendanceCheckInPermissions");

export function checkInPermissionDocId(uid: string, dateISO: string): string {
  return `${uid}_${dateISO}`;
}

// Looked up by every write path that sets a checkIn time (self check-in,
// HOD manual mark, historical import) so the permitted time gets snapshotted
// onto the attendanceRecord itself at write time - see
// AttendanceRecord.permittedCheckInTime's own doc-comment for why this is a
// snapshot, not re-resolved live on every read.
export async function resolveCheckInPermission(
  db: Firestore,
  collegeId: string,
  uid: string,
  dateISO: string,
): Promise<string | null> {
  const snap = await CHECKIN_PERMISSIONS_COL(collegeId, db).doc(checkInPermissionDocId(uid, dateISO)).get();
  const data = snap.data() as { permittedCheckInTime?: string } | undefined;
  return data?.permittedCheckInTime ?? null;
}
