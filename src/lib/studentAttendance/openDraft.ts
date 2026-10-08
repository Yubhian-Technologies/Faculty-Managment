import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";

// Deleting a teaching assignment or a timetable slot while a faculty member has TODAY's period
// open (a DRAFT, not yet submitted) leaves that DRAFT unsavable: its slot is gone, so the save
// is refused as "not on your timetable". Delete routes ask this first and refuse with a clear
// message. Equality-only query (served by single-field indexes); older DRAFTs are stale and
// never block.

export async function hasOpenDraftToday(
  db: Firestore, collegeId: string, assignmentId: string, periodNumber?: number, now: Date = new Date()
): Promise<boolean> {
  let q: FirebaseFirestore.Query = db.collection("colleges").doc(collegeId).collection("studentAttendance")
    .where("assignmentId", "==", assignmentId)
    .where("status", "==", "DRAFT")
    .where("date", "==", istDateKey(now));
  if (periodNumber != null) q = q.where("periodNumber", "==", periodNumber);
  return !(await q.limit(1).get()).empty;
}

export const OPEN_DRAFT_DELETE_MESSAGE =
  "Attendance is open for this class today and has not been submitted. Ask the faculty to submit it (or have the Dept Office post it) before removing this.";
