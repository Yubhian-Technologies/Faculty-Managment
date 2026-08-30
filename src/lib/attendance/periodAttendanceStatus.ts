import type { Timestamp } from "firebase-admin/firestore";
import type { StudentAttendanceSession } from "@/types/studentAttendance";

// Purely a display-time derivation, same convention as lateStatus.ts's
// isLateCheckIn - never written to Firestore, never affects the underlying
// StudentAttendanceSession. Shared by the Principal and HOD "Attendance
// Completion" views so both derive it identically from the same raw data.

export type PeriodAttendanceStatus = "ON_TIME" | "LATE" | "NOT_MARKED" | "PENDING";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// The period's own end time, resolved to a real Date on `dateISO` in the
// college's local calendar (Asia/Kolkata, UTC+5:30 - matches collegeNow() in
// lib/timetable/currentPeriod.ts). Built from components rather than
// `new Date(...)` parsing so it isn't at the mercy of the deployment host's
// own timezone.
function periodEndInstant(dateISO: string, endTime: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  const minutes = toMinutes(endTime);
  // IST is UTC+5:30 with no DST - a UTC instant for "this local wall-clock
  // time" is just the wall-clock time minus the offset.
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - 5 * 60 - 30, 0));
}

/**
 * Whether a faculty member completed one scheduled period's student
 * attendance, and how promptly - "on time" meaning submitted by the period's
 * own scheduled end time. `session` is the StudentAttendanceSession doc for
 * this exact (assignment, date, period), if one exists at all.
 */
export function resolvePeriodCompletionStatus(params: {
  dateISO: string;
  endTime: string; // "HH:MM", the period's own scheduled end
  session: Pick<StudentAttendanceSession, "status" | "submittedAt"> | null | undefined;
  now?: Date;
}): PeriodAttendanceStatus {
  const { dateISO, endTime, session, now = new Date() } = params;
  const periodEnd = periodEndInstant(dateISO, endTime);

  if (session?.status === "SUBMITTED") {
    const submittedAt = session.submittedAt as Timestamp | null | undefined;
    if (!submittedAt) return "ON_TIME"; // submitted but no timestamp on record - don't penalize
    return submittedAt.toDate().getTime() <= periodEnd.getTime() ? "ON_TIME" : "LATE";
  }

  // No SUBMITTED session yet - only a real gap once the period has actually
  // ended; still in progress (or scheduled for a future date) reads as
  // PENDING so a Principal checking mid-class doesn't see a false "missed".
  return now.getTime() < periodEnd.getTime() ? "PENDING" : "NOT_MARKED";
}
