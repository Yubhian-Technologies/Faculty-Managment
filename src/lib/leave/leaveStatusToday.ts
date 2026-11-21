import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";
import { leavePartOn, type LeaveDayPart, type LeaveSpan } from "@/lib/leave/leaveDayParts";
import { REQUESTS_COL } from "./balanceEngine";


// Is this person on an APPROVED leave that covers `today`? Feeds the
// self-attendance check-in gate (see check-in/route.ts and
// today-status/route.ts) - attendance shouldn't be markable on a day already
// covered by approved leave.
export async function isOnApprovedLeaveToday(
  db: Firestore,
  collegeId: string,
  uid: string,
  today: Date = new Date()
): Promise<boolean> {
  // Only a WHOLE day away blocks attendance: on a half-day leave the person checks in for the half they work.
  return (await approvedLeavePartOn(db, collegeId, uid, today)) === "FULL";
}

/** Which part of the day an approved leave takes: "FULL", "FN" (forenoon), "AN" (afternoon), or null (none).
 *  Two half-day leaves on one date make it FULL. The automatic late check-in CL deduction never counts. */
export async function approvedLeavePartOn(
  db: Firestore,
  collegeId: string,
  uid: string,
  day: Date = new Date()
): Promise<LeaveDayPart | null> {
  const snap = await REQUESTS_COL(collegeId, db)
    .where("uid", "==", uid)
    .where("status", "==", "APPROVED")
    .get();
  const dateISO = istDateKey(day);
  const parts = new Set<LeaveDayPart>();
  for (const doc of snap.docs) {
    const r = doc.data() as LeaveSpan & { isLateAttendancePenalty?: boolean };
    if (r.isLateAttendancePenalty) continue; // the late check-in CL deduction: not a day away
    const part = leavePartOn(r, dateISO);
    if (part) parts.add(part);
  }
  if (parts.has("FULL") || (parts.has("FN") && parts.has("AN"))) return "FULL";
  return parts.has("FN") ? "FN" : parts.has("AN") ? "AN" : null;
}
