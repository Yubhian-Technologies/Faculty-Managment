import type { Firestore } from "firebase-admin/firestore";
import { HALF_DAY_SPLIT, leavePartOn } from "@/lib/leave/leaveDayParts";
import { lateAfterOf } from "@/lib/attendance/attendanceTimings";
import { loadAttendanceTimings } from "@/lib/attendance/attendanceTimingsServer";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { reverseLateCheckIn } from "@/lib/leave/lateAttendancePenalty";
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
  req: Pick<LeaveRequest, "uid" | "employeeName" | "department" | "fromDate" | "toDate" | "isHalfDay" | "halfDaySession" | "firstDayHalf" | "lastDayHalf" | "leaveTypeCode">,
  leaveApplicationId: string
): Promise<void> {
  const from = (req.fromDate as unknown as { toDate(): Date }).toDate();
  const to = (req.toDate as unknown as { toDate(): Date }).toDate();
  const holidayDates = await getHolidayDateKeys(db, collegeId, from, to);
  const dates = enumerateWorkingDates(from, to, holidayDates);
  if (dates.length === 0) return;

  const col = db.collection("colleges").doc(collegeId).collection("attendanceRecords");
  const now = new Date();
  await excuseLateCheckInsCoveredByLeave(db, collegeId, req, dates).catch((err) =>
    console.error("[attendanceSync] late check-in re-check failed", err));
  // Only WHOLE days are written as On Leave: on a half day (a single-date half day, or a range's half-day end) the
  // person checks in for the half they work, so that day's record is their own check-in (lib/leave/leaveDayParts.ts).
  await Promise.all(dates.filter((day) => leavePartOn(req, isoDateKey(day)) === "FULL").map(async (day) => {
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

// A check-in is judged late against the cut-off in force AT CHECK-IN: with a forenoon leave already approved that is
// 13:00 + grace, otherwise the college's start + grace. A leave approved AFTER the person checked in (applied in the
// morning, approved in the afternoon) left the day counted as late. On approval, each day of the leave that already
// has a late check-in is judged again: a forenoon-leave day against 13:00 + grace, a whole-leave day not late at all.
// A day no longer late gets the cut-off stamped on its record (`lateAfter`, so every view shows it on time, plus
// `lateExcused`) and its late count reversed - which also gives back a 0.5 CL deduction no longer earned.
async function excuseLateCheckInsCoveredByLeave(
  db: Firestore,
  collegeId: string,
  req: Parameters<typeof leavePartOn>[0] & { uid: string; leaveTypeCode?: string | null },
  dates: Date[],
): Promise<void> {
  const today = todayISODate();
  const days = dates
    .map((day) => ({ day, key: isoDateKey(day), part: leavePartOn(req, isoDateKey(day)) }))
    .filter((d) => d.key <= today && (d.part === "FN" || d.part === "FULL"));
  if (days.length === 0) return;
  const col = db.collection("colleges").doc(collegeId).collection("attendanceRecords");
  let forenoonCutoff: string | null = null;
  for (const { day, key, part } of days) {
    const ref = col.doc(`${req.uid}_${key}`);
    const rec = (await ref.get()).data() as { checkIn?: string; permittedCheckInTime?: string | null; lateAfter?: string | null; lateExcused?: unknown } | undefined;
    if (!rec?.checkIn || rec.lateExcused || !isLateCheckIn(rec.checkIn, rec.permittedCheckInTime, rec.lateAfter)) continue;
    if (part === "FN" && !forenoonCutoff) {
      const t = await loadAttendanceTimings(db, collegeId);
      forenoonCutoff = lateAfterOf({ startTime: HALF_DAY_SPLIT, graceMinutes: t.graceMinutes });
    }
    const cutoff = part === "FN" ? forenoonCutoff! : "23:59";
    if (isLateCheckIn(rec.checkIn, null, cutoff)) continue; // still late even allowing for the leave
    await ref.update({
      lateAfter: cutoff,
      lateExcused: { reason: part === "FN" ? "Forenoon leave approved after check-in" : "Leave approved after check-in", at: new Date() },
      updatedAt: new Date(),
    });
    await reverseLateCheckIn(db, collegeId, req.uid, new Date(day.getFullYear(), day.getMonth(), day.getDate()));
  }
}
