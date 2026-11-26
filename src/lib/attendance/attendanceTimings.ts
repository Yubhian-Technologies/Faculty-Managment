// Each college's own attendance timings for faculty and staff self check-in (Principal / VP / College Office set
// them): the day's start time and the grace minutes after it. A check-in AFTER start + grace is Late - which needs a
// reason, counts towards the "3 late check-ins = 0.5 CL" rule and shows as Late everywhere. Stored at
// colleges/{c}/settings/attendanceTimings. Not set = 09:00 + 5 min, the same 09:05 cut-off as before.
// Each check-in stores the cut-off in force that day (AttendanceRecord.lateAfter), so changing the timings never
// changes how an earlier day reads.

export interface AttendanceTimings {
  startTime: string;
  graceMinutes: number;
  /** The college's closing time for faculty / staff ("HH:MM"). Not set = no early check-out rule. A check-out
   *  before it needs a reason, and faculty with classes still left must cover them first (lib/attendance/earlyCheckOut.ts). */
  endTime?: string;
}

export const DEFAULT_ATTENDANCE_TIMINGS: AttendanceTimings = { startTime: "09:00", graceMinutes: 5 };
export const MAX_GRACE_MINUTES = 120;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm: string) => {
  const m = TIME_RE.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHHMM = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The Late cut-off ("HH:MM"): start time + grace. A check-in at this exact minute is still on time. */
export function lateAfterOf(t: AttendanceTimings): string {
  const start = toMinutes(t.startTime) ?? toMinutes(DEFAULT_ATTENDANCE_TIMINGS.startTime)!;
  return toHHMM(Math.min(start + Math.max(0, Math.round(t.graceMinutes)), 23 * 60 + 59));
}

/** Validates what Principal / Office sends; throws a readable message. */
export function cleanAttendanceTimings(raw: unknown): AttendanceTimings {
  const r = (raw ?? {}) as { startTime?: unknown; graceMinutes?: unknown; endTime?: unknown };
  const startTime = typeof r.startTime === "string" ? r.startTime.trim() : "";
  if (toMinutes(startTime) === null) throw new Error("Enter the start time as HH:MM (24-hour), for example 09:00.");
  const grace = Number(r.graceMinutes);
  if (!Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_MINUTES) throw new Error(`Grace minutes must be a whole number from 0 to ${MAX_GRACE_MINUTES}.`);
  const endTime = typeof r.endTime === "string" ? r.endTime.trim() : "";
  if (endTime) {
    const end = toMinutes(endTime);
    if (end === null) throw new Error("Enter the end time as HH:MM (24-hour), for example 16:30, or leave it blank.");
    if (end <= toMinutes(startTime)!) throw new Error("The end time must be after the start time.");
    return { startTime, graceMinutes: grace, endTime };
  }
  return { startTime, graceMinutes: grace };
}

/** A stored value read leniently: anything missing or unreadable falls back to the defaults. */
export function readAttendanceTimings(stored: unknown): AttendanceTimings {
  try {
    return cleanAttendanceTimings({ ...DEFAULT_ATTENDANCE_TIMINGS, ...((stored ?? {}) as object) });
  } catch {
    // A bad end time alone never loses the start time.
    try {
      const { endTime: _drop, ...rest } = (stored ?? {}) as { endTime?: unknown };
      void _drop;
      return cleanAttendanceTimings({ ...DEFAULT_ATTENDANCE_TIMINGS, ...rest });
    } catch {
      return DEFAULT_ATTENDANCE_TIMINGS;
    }
  }
}
