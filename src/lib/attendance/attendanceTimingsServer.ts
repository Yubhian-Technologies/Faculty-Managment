import { cachedValue } from "@/lib/firestore/sharedReads";
import { lateAfterOf, readAttendanceTimings, type AttendanceTimings } from "./attendanceTimings";

type Db = FirebaseFirestore.Firestore;

export const attendanceTimingsRef = (db: Db, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("settings").doc("attendanceTimings");

/** The college's timings, read fresh (the settings page and every save). */
export async function loadAttendanceTimings(db: Db, collegeId: string): Promise<AttendanceTimings> {
  const snap = await attendanceTimingsRef(db, collegeId).get();
  return readAttendanceTimings(snap.exists ? snap.data() : undefined);
}

/** The college's Late cut-off ("HH:MM"), kept 60 s per server instance - check-ins read it on every request. */
export function collegeLateAfter(db: Db, collegeId: string): Promise<string> {
  return cachedValue(`attendanceLateAfter/${collegeId}`, 60_000, async () => lateAfterOf(await loadAttendanceTimings(db, collegeId)));
}
