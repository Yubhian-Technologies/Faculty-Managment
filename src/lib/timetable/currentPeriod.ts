import type { Firestore } from "firebase-admin/firestore";
import type { CourseYearTiming, DayOfWeek, TimetableSlot } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";

// Exported for callers that need to map an arbitrary calendar date (not just
// "now") to a DayOfWeek against published timetableSlots - e.g. backfilling
// a historical attendance record's period number from the timetable (see
// class-work-records/route.ts).
export const DAY_BY_JS_DAY: Record<number, DayOfWeek> = {
  1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT",
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Timetable timings are maintained for the colleges' local calendar, not the
// deployment host's timezone. In particular, a UTC server is 5h30 behind
// India, so Date#getHours()/getDay() would otherwise hide valid classes (and
// reject their attendance) for a large part of every working day.
function collegeNow(now: Date): { date: string; day: DayOfWeek | undefined; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  const dayByWeekday: Record<string, DayOfWeek> = {
    Mon: "MON", Tue: "TUE", Wed: "WED", Thu: "THU", Fri: "FRI", Sat: "SAT",
  };

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    day: dayByWeekday[value("weekday")],
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

// Resolves the clock-time window for one TimetableSlot's period, straight
// from its own CourseYearTiming - never hard-coded - falling back to the
// same numberOfPeriods/periodDurationMinutes formula the Timetable page
// itself falls back to when an HOD hasn't broken a course-year into
// explicit periods yet (see buildGrid.ts's defaultPeriodTimings). Null when
// the course-year has no timing configured at all, or the slot's period
// number isn't one of them.
async function resolvePeriodWindow(
  collegeRef: FirebaseFirestore.DocumentReference,
  slot: Pick<TimetableSlot, "courseId" | "year" | "periodNumber">,
): Promise<{ startTime: string; endTime: string } | null> {
  const timingId = `${slot.courseId}_year${slot.year}`;
  const timingSnap = await collegeRef.collection("courseYearTimings").doc(timingId).get();
  if (!timingSnap.exists) return null;
  const timing = { id: timingSnap.id, ...timingSnap.data() } as CourseYearTiming;
  const periods = timing.periods?.length ? timing.periods : defaultPeriodTimings(timing);
  const period = periods.find((p) => p.period === slot.periodNumber);
  return period ? { startTime: period.startTime, endTime: period.endTime } : null;
}

export interface CurrentPeriodSlot {
  slot: TimetableSlot & { id: string };
  startTime: string; // "HH:MM" 24h, resolved from the slot's own CourseYearTiming
  endTime: string;
}

/**
 * The single published TimetableSlot a faculty member is teaching right now
 * (department/course/year/section/subject, keyed off their own
 * `timetableSlots`), or null when no period covers this exact moment -
 * before/after the working day, a lunch/short break, a day with nothing
 * scheduled, or Sunday.
 */
export async function getCurrentTimetableSlot(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  now: Date = new Date(),
): Promise<CurrentPeriodSlot | null> {
  const { day, minutes: nowMinutes } = collegeNow(now);
  if (!day) return null;

  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots")
    .where("facultyId", "==", facultyMemberId)
    .get();
  const todaySlots = slotsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.day === day);
  if (todaySlots.length === 0) return null;

  for (const slot of todaySlots) {
    const window = await resolvePeriodWindow(collegeRef, slot);
    if (!window) continue;
    const start = toMinutes(window.startTime);
    const end = toMinutes(window.endTime);
    if (nowMinutes >= start && nowMinutes < end) {
      return { slot, startTime: window.startTime, endTime: window.endTime };
    }
  }
  return null;
}

export type PeriodWindowCheck =
  | { ok: true; slot: TimetableSlot & { id: string }; startTime: string; endTime: string }
  // `date` isn't today - a stale/replayed request against an old (or future) session.
  | { ok: false; reason: "WRONG_DATE" }
  // No PUBLISHED timetableSlot puts this exact faculty+assignment on today's
  // weekday at all - timetable was never published for this, or has since
  // been changed/republished to drop it.
  | { ok: false; reason: "NOT_SCHEDULED" }
  // The slot exists today, but the current clock time falls outside its
  // period window (too early, or the period has already ended).
  | { ok: false; reason: "OUTSIDE_WINDOW"; startTime: string; endTime: string; phase: "BEFORE" | "AFTER" };

/**
 * Server-side gate for actually writing attendance: true only when `date` is
 * today AND the PUBLISHED timetable currently puts this exact
 * (facultyMemberId, assignmentId) pair in session, right now. This is the
 * authority the API routes must consult before persisting anything - the
 * client-visible "current period" banner is a convenience, not the source of
 * truth, so a request replayed after a period ends (or crafted for a
 * different assignment/date) is rejected here regardless of what the UI let
 * the faculty click.
 */
export async function checkFacultyPeriodWindow(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  assignmentId: string,
  dateISO: string,
  now: Date = new Date(),
): Promise<PeriodWindowCheck> {
  const { date: collegeDate, day, minutes: nowMinutes } = collegeNow(now);
  if (dateISO !== collegeDate) {
    return { ok: false, reason: "WRONG_DATE" };
  }

  if (!day) return { ok: false, reason: "NOT_SCHEDULED" };

  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots")
    .where("facultyId", "==", facultyMemberId)
    .where("assignmentId", "==", assignmentId)
    .get();
  // A single assignment can occupy more than one TimetableSlot on the same
  // day (e.g. a 3-period lab block, or a subject taught twice on the same
  // day) - each period keeps its own doc, so resolve every one of today's
  // and check them all rather than assuming the first result is the one
  // covering "now".
  const todaySlots = slotsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.day === day);
  if (todaySlots.length === 0) return { ok: false, reason: "NOT_SCHEDULED" };

  const resolved: { slot: TimetableSlot & { id: string }; startTime: string; endTime: string }[] = [];
  for (const slot of todaySlots) {
    const window = await resolvePeriodWindow(collegeRef, slot);
    if (window) resolved.push({ slot, ...window });
  }
  if (resolved.length === 0) return { ok: false, reason: "NOT_SCHEDULED" };
  resolved.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  const active = resolved.find(
    (r) => nowMinutes >= toMinutes(r.startTime) && nowMinutes < toMinutes(r.endTime)
  );
  if (active) {
    return { ok: true, slot: active.slot, startTime: active.startTime, endTime: active.endTime };
  }

  // Not in any of today's periods for this assignment - report the nearest
  // boundary so the error reads naturally ("hasn't started" vs. "ended at").
  const first = resolved[0];
  const last = resolved[resolved.length - 1];
  if (nowMinutes < toMinutes(first.startTime)) {
    return { ok: false, reason: "OUTSIDE_WINDOW", startTime: first.startTime, endTime: first.endTime, phase: "BEFORE" };
  }
  return { ok: false, reason: "OUTSIDE_WINDOW", startTime: last.startTime, endTime: last.endTime, phase: "AFTER" };
}

/** Human-readable reason for an API error response, from a failed check above. */
export function periodWindowMessage(check: Exclude<PeriodWindowCheck, { ok: true }>): string {
  switch (check.reason) {
    case "WRONG_DATE":
      return "Attendance can only be marked for the current date.";
    case "NOT_SCHEDULED":
      return "This class is not on your published timetable right now.";
    case "OUTSIDE_WINDOW":
      return check.phase === "BEFORE"
        ? `This period has not started yet (${check.startTime}–${check.endTime}).`
        : `Attendance period ended at ${check.endTime}.`;
  }
}
