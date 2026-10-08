import type { Firestore } from "firebase-admin/firestore";
import type { CourseYearTiming, DayOfWeek, TimetableSlot } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { loadEffectiveTiming, resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import { resolveSubstituteSlotsForDate } from "@/lib/leave/periodCoverage";
import { istDateFromParts } from "@/lib/attendance/istTime";

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
// the course-year has no timing configured at all, the slot's period number
// isn't one of them, OR the slot belongs to a semester that isn't the
// currently active one for its own course-year (see matchesCurrentSemester -
// a faculty member can have same-day/period slots from two different
// semesters once a college turns semesters on, and only the live one should
// ever gate "is this class in session right now").
// Per-call memo of courseYearTimings docs. A faculty's day (or the cron's
// whole-college sweep) resolves many slots that share a course-year; without
// this every slot re-read the same timing doc.
export type TimingCache = Map<string, Promise<CourseYearTiming | null>>;

function loadTiming(
  collegeRef: FirebaseFirestore.DocumentReference,
  timingId: string,
  cache: TimingCache,
): Promise<CourseYearTiming | null> {
  let hit = cache.get(timingId);
  if (!hit) {
    hit = collegeRef.collection("courseYearTimings").doc(timingId).get().then(async (snap) => {
      if (snap.exists) return { id: snap.id, ...snap.data() } as CourseYearTiming;
      // A shared-year branch (e.g. first-year CSE under Basic Science) stores its own courseId on
      // its slots, but the year's timing lives on the managing department - same fallback the
      // Timetable editor uses (see loadEffectiveTiming).
      const m = /^(.+)_year(\d+)$/.exec(timingId);
      if (!m) return null;
      return loadEffectiveTiming(collegeRef.firestore, collegeRef.id, m[1], Number(m[2]));
    });
    cache.set(timingId, hit);
  }
  return hit;
}

// Why an assigned period can be listed but not taken. `lenient` keeps such a
// period (listing only - the attendance window checks stay strict) instead of
// dropping it, so a faculty member still SEES everything assigned to them.
export type UnavailableReason = "NO_TIMING" | "NO_PERIOD" | "OTHER_SEMESTER";

export const UNAVAILABLE_MESSAGES: Record<UnavailableReason, string> = {
  NO_TIMING: "College timings are not set for this course-year - contact the College Office.",
  NO_PERIOD: "This period is not in the course-year's timings - contact the College Office.",
  OTHER_SEMESTER: "This timetable belongs to a semester that is not the current one - contact your HOD.",
};

async function resolvePeriodWindow(
  collegeRef: FirebaseFirestore.DocumentReference,
  slot: Pick<TimetableSlot, "courseId" | "year" | "periodNumber" | "semester">,
  cache: TimingCache = new Map(),
  lenient = false,
  // The date whose semester applies (default: now). Office corrections of a past day pass that day.
  asOf?: Date,
): Promise<{ startTime: string; endTime: string; closeTime: string; unavailableReason?: UnavailableReason } | null> {
  const timingId = `${slot.courseId}_year${slot.year}`;
  const timing = await loadTiming(collegeRef, timingId, cache);
  const unavailable = (unavailableReason: UnavailableReason) =>
    lenient ? { startTime: "", endTime: "", closeTime: "", unavailableReason } : null;
  if (!timing) return unavailable("NO_TIMING");
  const otherSemester = !matchesCurrentSemester(slot.semester, resolveCurrentSemester(timing, asOf));
  if (otherSemester && !lenient) return null;
  const periods = timing.periods?.length ? timing.periods : defaultPeriodTimings(timing);
  const period = periods.find((p) => p.period === slot.periodNumber);
  if (!period) return unavailable("NO_PERIOD");
  // Attendance for a period stays postable until the course-year's college end
  // time (never earlier than the period's own end). endTime itself is unchanged:
  // on-time/late and not-posted reporting still measure against the period end.
  const closeTime = timing.collegeEndTime && toMinutes(timing.collegeEndTime) > toMinutes(period.endTime) ? timing.collegeEndTime : period.endTime;
  return {
    startTime: period.startTime, endTime: period.endTime, closeTime,
    ...(otherSemester ? { unavailableReason: "OTHER_SEMESTER" as const } : {}),
  };
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
  const { date, day, minutes: nowMinutes } = collegeNow(now);
  if (!day) return null;

  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots")
    .where("facultyId", "==", facultyMemberId)
    .where("day", "==", day)
    .get();
  const ownTodaySlots = slotsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.day === day);

  // Also resolve any slot this person is covering today as an approved
  // substitute - their own facultyId never appears on that slot doc (see
  // resolveSubstituteSlotsForDate's own doc-comment), so it's invisible to
  // the query above without this.
  const substituted = await resolveSubstituteSlotsForDate(db, collegeId, facultyMemberId, date);
  const ownSlotIds = new Set(ownTodaySlots.map((s) => s.id));
  const missingSubIds = [...substituted.keys()].filter((id) => !ownSlotIds.has(id));
  const subSlots: (TimetableSlot & { id: string })[] = [];
  if (missingSubIds.length) {
    const subSnaps = await Promise.all(missingSubIds.map((id) => collegeRef.collection("timetableSlots").doc(id).get()));
    for (const snap of subSnaps) {
      if (snap.exists) subSlots.push({ id: snap.id, ...snap.data() } as TimetableSlot & { id: string });
    }
  }
  const todaySlots = [...ownTodaySlots, ...subSlots];
  if (todaySlots.length === 0) return null;

  const timingCache: TimingCache = new Map();
  for (const slot of todaySlots) {
    const window = await resolvePeriodWindow(collegeRef, slot, timingCache);
    if (!window) continue;
    const start = toMinutes(window.startTime);
    const end = toMinutes(window.endTime);
    if (nowMinutes >= start && nowMinutes < end) {
      return { slot, startTime: window.startTime, endTime: window.endTime };
    }
  }
  return null;
}

export interface FacultyPeriodOnDate {
  slot: TimetableSlot & { id: string };
  startTime: string; // "HH:MM" 24h, resolved from the slot's own CourseYearTiming
  endTime: string;
  closeTime: string; // when posting closes: the year's college end time (>= endTime)
  /** Set (with blank/other-semester times) only when listed leniently - see resolvePeriodWindow. */
  unavailableReason?: UnavailableReason;
}

/**
 * Every published TimetableSlot a faculty member has on an arbitrary calendar
 * date (past, today, or future) - not just "now" (see getCurrentTimetableSlot
 * above). Used by attendance-completion reporting, where a Principal/HOD picks
 * a specific date and needs the faculty's full day, not just whichever single
 * period happens to be in session right now. Sorted by period start time.
 *
 * Note: like getCurrentTimetableSlot, this filters each slot through
 * resolvePeriodWindow's matchesCurrentSemester check, which compares against
 * the semester that's active RIGHT NOW, not the one active on `dateISO` - a
 * date from a since-ended semester can under-report periods. Acceptable for
 * this feature's use (recent-date attendance-completion checks); revisit if a
 * caller ever needs an accurate report far into a past semester.
 */
export async function getFacultyPeriodsForDate(
  db: Firestore,
  collegeId: string,
  facultyId: string,
  dateISO: string,
  // Pass one cache across many calls (e.g. the cron looping over every
  // faculty in a college) so a shared course-year timing is read once.
  timingCache: TimingCache = new Map(),
  // List periods whose timing/semester can't be resolved too (flagged with unavailableReason).
  // semesterOnDate: judge each slot against the semester that was active ON dateISO, not today
  // (used to correct a past day that belongs to an earlier semester).
  options: { lenient?: boolean; semesterOnDate?: boolean } = {},
): Promise<FacultyPeriodOnDate[]> {
  // Same weekday-from-date convention as class-work-records/route.ts's
  // resolvePeriodNumber - a plain JS Date parsed from "YYYY-MM-DD" components
  // (not `new Date(dateISO)`, which parses as UTC midnight and can land on
  // the wrong local weekday).
  const [y, m, d] = dateISO.split("-").map(Number);
  const day = DAY_BY_JS_DAY[new Date(y, m - 1, d).getDay()];
  if (!day) return []; // Sunday - nothing scheduled

  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots")
    .where("facultyId", "==", facultyId)
    .where("day", "==", day)
    .get();
  const ownDaySlots = slotsSnap.docs
    .map((s) => ({ id: s.id, ...s.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.day === day);

  // Also include slots this person is covering on dateISO as an approved
  // substitute (see resolveSubstituteSlotsForDate's own doc-comment) - this
  // is what makes a covering faculty's own "today's classes" list (Mark
  // Attendance, Attendance Completion) actually show the class they're
  // standing in for, not just the ones they're directly assigned.
  const substituted = await resolveSubstituteSlotsForDate(db, collegeId, facultyId, dateISO);
  const ownSlotIds = new Set(ownDaySlots.map((s) => s.id));
  const missingSubIds = [...substituted.keys()].filter((id) => !ownSlotIds.has(id));
  const subSlots: (TimetableSlot & { id: string })[] = [];
  if (missingSubIds.length) {
    const subSnaps = await Promise.all(missingSubIds.map((id) => collegeRef.collection("timetableSlots").doc(id).get()));
    for (const snap of subSnaps) {
      if (snap.exists) subSlots.push({ id: snap.id, ...snap.data() } as TimetableSlot & { id: string });
    }
  }
  const daySlots = [...ownDaySlots, ...subSlots];

  const resolved: FacultyPeriodOnDate[] = [];
  const windows = await Promise.all(daySlots.map((slot) => resolvePeriodWindow(collegeRef, slot, timingCache, options.lenient, options.semesterOnDate ? istDateFromParts(y, m, d) : undefined)));
  daySlots.forEach((slot, i) => {
    const window = windows[i];
    if (window) resolved.push({ slot, ...window });
  });
  // Periods without a resolvable time go last.
  const minutesOf = (t: string) => (t ? toMinutes(t) : Number.MAX_SAFE_INTEGER);
  resolved.sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
  return resolved;
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
  | { ok: false; reason: "OUTSIDE_WINDOW"; startTime: string; endTime: string; phase: "BEFORE" | "AFTER" }
  // A period IS currently in session for this assignment, but it's a
  // different period number than `expectedPeriodNumber` - e.g. this exact
  // assignment has consecutive periods today (Period 1 then Period 2, same
  // faculty/section/subject) and the caller is trying to save against
  // Period 1's session while Period 2 is the one actually active right now.
  | { ok: false; reason: "PERIOD_MISMATCH"; activePeriodNumber: number };

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
  // Pass the SPECIFIC period a saved session belongs to (see
  // StudentAttendanceSession.periodNumber) when re-validating a save against
  // an already-created session - without this, an assignment with two
  // consecutive periods today (same faculty/section/subject) would let a
  // save against Period 1's session through just because SOME period of
  // this assignment happens to be active right now, even after Period 2 has
  // taken over. Omit when there's no session yet (creating a fresh one just
  // wants whichever period is active right now).
  expectedPeriodNumber?: number,
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
    .where("day", "==", day)
    .get();
  // A single assignment can occupy more than one TimetableSlot on the same
  // day (e.g. a 3-period lab block, or a subject taught twice on the same
  // day) - each period keeps its own doc, so resolve every one of today's
  // and check them all rather than assuming the first result is the one
  // covering "now".
  let todaySlots = slotsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
    .filter((s) => s.day === day);

  // Fallback: this exact facultyMemberId+assignmentId combo may belong to a
  // different faculty (on leave), with facultyMemberId covering it today as
  // an approved substitute instead - checked only when the direct query
  // above finds nothing, so the ordinary (non-substitute) path never pays
  // this extra cost. See resolveSubstituteSlotsForDate's own doc-comment.
  if (todaySlots.length === 0) {
    // fresh: this is the write gate - a just-approved substitute must not be refused for a cache's sake.
    const substituted = await resolveSubstituteSlotsForDate(db, collegeId, facultyMemberId, dateISO, { fresh: true });
    if (substituted.size > 0) {
      const assignmentSlotsSnap = await collegeRef.collection("timetableSlots")
        .where("assignmentId", "==", assignmentId)
        .get();
      todaySlots = assignmentSlotsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string })
        .filter((s) => s.day === day && substituted.has(s.id));
    }
  }
  if (todaySlots.length === 0) return { ok: false, reason: "NOT_SCHEDULED" };

  const resolved: { slot: TimetableSlot & { id: string }; startTime: string; endTime: string; closeTime: string }[] = [];
  const timingCache: TimingCache = new Map();
  const windows = await Promise.all(todaySlots.map((slot) => resolvePeriodWindow(collegeRef, slot, timingCache)));
  todaySlots.forEach((slot, i) => {
    const window = windows[i];
    if (window) resolved.push({ slot, ...window });
  });
  if (resolved.length === 0) return { ok: false, reason: "NOT_SCHEDULED" };
  resolved.sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

  // Postable from the period's start until the year's college end time. A
  // saved session pins its own period (expectedPeriodNumber); a new one takes
  // the period running now, else the latest one already started.
  const candidates = expectedPeriodNumber != null ? resolved.filter((r) => r.slot.periodNumber === expectedPeriodNumber) : resolved;
  if (candidates.length === 0) return { ok: false, reason: "NOT_SCHEDULED" };
  const open = candidates.filter((r) => nowMinutes >= toMinutes(r.startTime) && nowMinutes < toMinutes(r.closeTime));
  const active = open.find((r) => nowMinutes < toMinutes(r.endTime)) ?? open[open.length - 1];
  if (active) {
    return { ok: true, slot: active.slot, startTime: active.startTime, endTime: active.endTime };
  }

  // Not postable - report the nearest boundary so the error reads naturally
  // ("hasn't started" vs. "closed at").
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  if (nowMinutes < toMinutes(first.startTime)) {
    return { ok: false, reason: "OUTSIDE_WINDOW", startTime: first.startTime, endTime: first.endTime, phase: "BEFORE" };
  }
  return { ok: false, reason: "OUTSIDE_WINDOW", startTime: last.startTime, endTime: last.closeTime, phase: "AFTER" };
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
        : `Attendance closed at ${check.endTime}.`;
    case "PERIOD_MISMATCH":
      return `This period has ended - Period ${check.activePeriodNumber} is now in session. Please reload to mark its attendance.`;
  }
}
