import type { Firestore } from "firebase-admin/firestore";
import { enumerateWorkingDates, isoDateKey, todayISODate } from "@/lib/leave/dayCounter";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import type { LeaveRequest } from "@/types/leave";

// Reflects a just-APPROVED leave onto the faculty self-attendance ledger
// (attendanceRecords, doc id `${uid}_${dateISO}` - same convention as
// check-in/route.ts and college/attendance/manual/route.ts) so monthly
// reports/exports show "On Leave" for the days it covers instead of
// synthesizing them as Absent (see fillMissingDays.ts's doc-comment - this
// was the deliberately-deferred gap it names). Only ever ADDS a record for a
// day that doesn't already have one; a real self check-in or HOD/Principal
// manual mark always wins and is never overwritten. Never removes a record
// either, so cancelling an already-approved leave (CANCEL, applications/
// [id]/route.ts) leaves any already-written ON_LEAVE day as history, same as
// every other attendance record.
export async function syncApprovedLeaveToAttendance(
  db: Firestore,
  collegeId: string,
  req: Pick<LeaveRequest, "uid" | "employeeName" | "department" | "fromDate" | "toDate">,
  leaveApplicationId: string
): Promise<void> {
  const from = (req.fromDate as unknown as { toDate(): Date }).toDate();
  const to = (req.toDate as unknown as { toDate(): Date }).toDate();
  const holidayDates = await getHolidayDateKeys(db, collegeId, from, to);
  const dates = enumerateWorkingDates(from, to, holidayDates);
  if (dates.length === 0) return;

  const col = db.collection("colleges").doc(collegeId).collection("attendanceRecords");
  const now = new Date();
  await Promise.all(dates.map(async (day) => {
    const ref = col.doc(`${req.uid}_${isoDateKey(day)}`);
    const snap = await ref.get();
    if (snap.exists) return;
    await ref.set({
      collegeId,
      facultyId: req.uid,
      facultyName: req.employeeName,
      department: req.department ?? "",
      date: day,
      dateKey: isoDateKey(day),
      status: "ON_LEAVE",
      source: "SYSTEM",
      leaveApplicationId,
      createdAt: now,
      updatedAt: now,
    });
  }));
}

// The other half of the above: cancelling an already-APPROVED leave
// (applications/[id]/route.ts CANCEL, only ever allowed while the period
// hasn't fully finished yet) must not leave the days still ahead marked
// "On Leave" for a leave that no longer exists. A day already lived through
// stays as-is - the person genuinely was on leave for it, up until this
// cancellation - and a record this sync didn't write itself (a real
// check-in, or an HOD/Principal manual mark made since) is never touched.
export async function revokeFutureLeaveFromAttendance(
  db: Firestore,
  collegeId: string,
  req: Pick<LeaveRequest, "uid" | "fromDate" | "toDate">,
  leaveApplicationId: string
): Promise<void> {
  const from = (req.fromDate as unknown as { toDate(): Date }).toDate();
  const to = (req.toDate as unknown as { toDate(): Date }).toDate();
  const holidayDates = await getHolidayDateKeys(db, collegeId, from, to);
  const dates = enumerateWorkingDates(from, to, holidayDates);
  const today = todayISODate();

  const col = db.collection("colleges").doc(collegeId).collection("attendanceRecords");
  await Promise.all(dates.map(async (day) => {
    const dateISO = isoDateKey(day);
    if (dateISO < today) return;
    const ref = col.doc(`${req.uid}_${dateISO}`);
    const snap = await ref.get();
    const data = snap.data() as { leaveApplicationId?: string; status?: string } | undefined;
    if (data?.status === "ON_LEAVE" && data.leaveApplicationId === leaveApplicationId) {
      await ref.delete();
    }
  }));
}
