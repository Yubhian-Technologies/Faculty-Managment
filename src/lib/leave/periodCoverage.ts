import type { Firestore } from "firebase-admin/firestore";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { notify } from "@/lib/notify";
import { enumerateWorkingDates, isoDateKey, todayISODate } from "@/lib/leave/dayCounter";
import { loadUnavailability, findSubstituteConflicts, describeSubstituteConflict } from "@/lib/leave/availability";
import { resolveSectionCurrentSemester, matchesCurrentSemester as slotMatchesCurrentSemester } from "@/lib/college/semester";
import { matchesCurrentAcademicYear } from "@/lib/college/academicSession";
import { isFacultyAvailable } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import type { DayOfWeek, FacultyMember, TimetableSlot, CourseYearTiming } from "@/types";
import type { LeaveRequest, PeriodSubstitution, StaffAdjustment } from "@/types/leave";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";

// Resolves, for a batch of TimetableSlots spanning possibly many course-years,
// which ones belong to the currently-live semester/session - the same "no
// stale history" rule every actual timetable read already applies (see
// timetable-slots/route.ts), needed here too since a section that reused the
// same day/period/subject placement in an earlier semester/session would
// otherwise let that OLD slot's id shadow the current one below.
async function filterToCurrentSlots(
  db: Firestore,
  collegeId: string,
  slots: (TimetableSlot & { id: string })[]
): Promise<(TimetableSlot & { id: string })[]> {
  const currentAcademicYear = await resolveCollegeAcademicYear(db, collegeId);
  const distinctCourseYears = new Map<string, { courseId: string; year: number }>();
  for (const s of slots) distinctCourseYears.set(`${s.courseId} ${s.year}`, { courseId: s.courseId, year: s.year });
  const semesterByCourseYear = new Map<string, number | null>();
  for (const [key, { courseId, year }] of distinctCourseYears) {
    semesterByCourseYear.set(key, await resolveSectionCurrentSemester(db, collegeId, courseId, year));
  }
  return slots.filter((s) =>
    matchesCurrentAcademicYear(s.academicYear, currentAcademicYear) &&
    slotMatchesCurrentSemester(s.semester, semesterByCourseYear.get(`${s.courseId} ${s.year}`) ?? null)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridges the Leave module to the Timetable module (see CLAUDE.md's "College
// Hiring Pipeline" note that these two are otherwise unconnected). Given a
// teaching faculty member and a leave date range, this resolves which of
// their TimetableSlots fall on working days in that range ("required
// periods"), and for each one, who in their own department is free to cover
// it (not already teaching that day/period anywhere, and not themselves on
// approved leave that date).
// ─────────────────────────────────────────────────────────────────────────────

function dayOfWeekFromDate(d: Date): DayOfWeek | null {
  const map: Record<number, DayOfWeek> = { 1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT" };
  return map[d.getDay()] ?? null; // Sunday (0) never appears - enumerateWorkingDates already excludes it
}

// The Monday..Saturday date keys of the week containing `anchorISO`, plus
// the same six days of the `extraWeeks` weeks that follow - feeds the weekly
// timetable grid's substitution overlay (see getActiveSubstitutionsForDates
// and its 3 callers: teaching-assignments, timetable-slots, class-leader/
// timetable routes). Each TimetableSlot occurs on exactly one fixed weekday,
// so within a single week it maps to exactly one calendar date - a Wednesday
// slot's substitute (if any) always comes from Wednesday's date in whichever
// week is being displayed. Previously these routes only checked TODAY's
// date, so a weekly grid showing Mon-Sat correctly overlaid a substitute
// onto today's own cell but left every OTHER day of that same week (already
// past, or still to come, within an approved leave/extension spanning
// several days) silently showing the original faculty instead.
//
// Every timetable grid now offers date navigation (a calendar picker, see
// the pages under src/app/(dashboard)/**/timetable*), so `anchorISO`
// defaults to today but a caller can pass whichever date the viewer has
// navigated to - and `extraWeeks` defaults to 0 (this exact week only): a
// substitution shows only on the day it's actually dated for, never
// borrowed from a later week and displayed under the wrong date. A caller
// that still wants the old "peek ahead" behavior (none currently do) can
// pass extraWeeks > 0 - getActiveSubstitutionsForDates would then pick the
// SOONEST matching date per slot if more than one week's worth is passed in.
export function currentWeekDateKeys(anchorISO: string = todayISODate(), extraWeeks = 0): string[] {
  // Parsed as Y/M/D rather than run through `new Date(anchorISO)` (which
  // reads an unqualified "YYYY-MM-DD" as UTC midnight) and NEVER defaulted
  // to a bare `new Date()` here - todayISODate() is already anchored to
  // Asia/Kolkata specifically to dodge the bug this file's own dayCounter.ts
  // documents: a UTC-run server's raw "now" reports the previous calendar
  // day for the first ~5.5h of every India day, which would silently pick
  // the wrong Monday and misalign this week's dates against the ones
  // already stored on approved PeriodSubstitutions.
  const [y, m, d] = anchorISO.split("-").map(Number);
  const anchor = new Date(y, m - 1, d);
  const day = anchor.getDay(); // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + mondayOffset);
  const keys: string[] = [];
  for (let w = 0; w <= extraWeeks; w++) {
    for (let i = 0; i < 6; i++) {
      keys.push(isoDateKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + w * 7 + i)));
    }
  }
  return keys;
}

export interface RequiredPeriod {
  date: string;
  day: DayOfWeek;
  periodNumber: number;
  timetableSlotId: string;
  sectionId: string;
  sectionName?: string;
  courseId?: string;
  // The course's short code ("BTECH"), resolved from courseId. Shown instead
  // of the full course name wherever a period has to identify itself in a
  // card narrow enough to hold three of them side by side.
  courseCode?: string;
  // Needed alongside courseId to look up this period's own CourseYearTiming
  // (id `${courseId}_year${year}`) for startTime/endTime below.
  year?: number;
  // Which of the course-year's semesters this slot sits in (TimetableSlot.
  // semester). Null/absent on slots published before that field existed.
  semester?: number | null;
  subjectId: string;
  subjectName: string;
  // The subject's own short mnemonic - Subject.shortCode where someone has
  // filled it in, else the formal `code`. Absent when the subject doc is
  // gone, in which case callers fall back to subjectName.
  subjectCode?: string;
  // This period's clock time ("HH:MM"), resolved from its course-year's
  // CourseYearTiming (explicit periods[] if the HOD broke it down, else the
  // same defaultPeriodTimings formula the timetable grid itself falls back
  // on - see resolveRequiredPeriods). Absent when no CourseYearTiming exists
  // at all for that course-year yet.
  startTime?: string;
  endTime?: string;
}

export interface SubstituteCandidate {
  facultyId: string;
  facultyName: string;
  /** Shown beside the name in every substitute picker - candidates now span
   *  the whole college, so two colleagues can share a name and the department
   *  is what tells them apart. */
  facultyDepartment: string;
}

export interface PeriodCoverageEntry extends RequiredPeriod {
  candidates: SubstituteCandidate[];
}

// Every TimetableSlot this faculty member teaches, expanded across the
// working dates of [fromDate, toDate]. Empty for a non-teaching requester
// (no slots) or a range that happens to fall entirely on non-working days.
export async function resolveRequiredPeriods(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  fromDate: Date,
  toDate: Date,
  holidayDates: Set<string>
): Promise<RequiredPeriod[]> {
  const collegeRef = db.collection("colleges").doc(collegeId);
  const slotsSnap = await collegeRef.collection("timetableSlots").where("facultyId", "==", facultyMemberId).get();
  if (slotsSnap.empty) return [];
  const rawSlots = slotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string });
  const slots = await filterToCurrentSlots(db, collegeId, rawSlots);
  if (slots.length === 0) return [];

  const slotsByDay = new Map<DayOfWeek, TimetableSlot[]>();
  for (const s of slots) {
    const arr = slotsByDay.get(s.day) ?? [];
    arr.push(s);
    slotsByDay.set(s.day, arr);
  }

  const workingDates = enumerateWorkingDates(fromDate, toDate, holidayDates);
  const required: RequiredPeriod[] = [];
  for (const date of workingDates) {
    const day = dayOfWeekFromDate(date);
    if (!day) continue;
    const daySlots = slotsByDay.get(day);
    if (!daySlots) continue;
    const dateISO = isoDateKey(date);
    for (const s of daySlots) {
      required.push({
        date: dateISO, day, periodNumber: s.periodNumber, timetableSlotId: s.id,
        sectionId: s.sectionId, courseId: s.courseId, year: s.year, semester: s.semester ?? null,
        subjectId: s.subjectId, subjectName: s.subjectName,
      });
    }
  }
  if (required.length === 0) return required;

  const sectionIds = Array.from(new Set(required.map((p) => p.sectionId)));
  const sectionSnaps = await Promise.all(sectionIds.map((id) => collegeRef.collection("sections").doc(id).get()));
  const sectionNameById = new Map(
    sectionSnaps.filter((s) => s.exists).map((s) => [s.id, (s.data() as { name?: string } | undefined)?.name])
  );
  for (const p of required) p.sectionName = sectionNameById.get(p.sectionId) ?? undefined;

  // Course and subject short codes, fetched once per distinct id - a leave
  // spanning many periods usually repeats a handful of each. A missing doc
  // simply leaves the code unset; callers fall back to the name they already
  // have rather than showing a gap.
  const courseIds = Array.from(new Set(required.map((p) => p.courseId).filter((v): v is string => !!v)));
  const subjectIds = Array.from(new Set(required.map((p) => p.subjectId).filter(Boolean)));
  const [courseSnaps, subjectSnaps] = await Promise.all([
    Promise.all(courseIds.map((id) => collegeRef.collection("courses").doc(id).get())),
    Promise.all(subjectIds.map((id) => collegeRef.collection("subjects").doc(id).get())),
  ]);
  const courseCodeById = new Map(
    courseSnaps.filter((d) => d.exists).map((d) => [d.id, (d.data() as { code?: string } | undefined)?.code])
  );
  const subjectCodeById = new Map(
    subjectSnaps.filter((d) => d.exists).map((d) => {
      const data = d.data() as { shortCode?: string; code?: string } | undefined;
      return [d.id, data?.shortCode || data?.code];
    })
  );
  for (const p of required) {
    p.courseCode = (p.courseId ? courseCodeById.get(p.courseId) : undefined) ?? undefined;
    p.subjectCode = subjectCodeById.get(p.subjectId) ?? undefined;
  }

  await attachPeriodTimes(collegeRef, required);

  return required.sort((a, b) => (a.date === b.date ? a.periodNumber - b.periodNumber : a.date.localeCompare(b.date)));
}

// Stamps startTime/endTime onto each period from its own course-year's
// CourseYearTiming, batch-fetched once per distinct courseId+year pair (a
// leave spanning many periods usually repeats just a handful of course-years).
// Falls back to defaultPeriodTimings - the same formula the timetable grid
// itself uses (buildRows in lib/timetable/buildGrid.ts) - whenever an HOD
// hasn't broken a course-year down period-by-period yet, so this never shows
// a blank time just because CourseYearTiming.periods is unset. Silently
// leaves startTime/endTime absent for a period whose course-year has no
// CourseYearTiming doc at all (legacy/incomplete setup) - callers already
// treat a missing time as "hide the time line", not an error.
async function attachPeriodTimes(collegeRef: FirebaseFirestore.DocumentReference, periods: RequiredPeriod[]): Promise<void> {
  const keys = Array.from(new Set(
    periods.filter((p) => p.courseId && p.year != null).map((p) => `${p.courseId}_year${p.year}`)
  ));
  if (keys.length === 0) return;
  const snaps = await Promise.all(keys.map((id) => collegeRef.collection("courseYearTimings").doc(id).get()));
  const timingById = new Map(
    snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as CourseYearTiming])
  );
  for (const p of periods) {
    if (!p.courseId || p.year == null) continue;
    const timing = timingById.get(`${p.courseId}_year${p.year}`);
    if (!timing) continue;
    const source = timing.periods && timing.periods.length > 0 ? timing.periods : defaultPeriodTimings(timing);
    const pt = source.find((t) => t.period === p.periodNumber);
    if (pt) { p.startTime = pt.startTime; p.endTime = pt.endTime; }
  }
}

// Resolves required periods plus, per period, which same-department teaching
// faculty (excluding the requester) are actually free to cover it - not
// already teaching that day/period in any section, and not themselves on
// approved leave that date. "Free" is evaluated fresh here (not cached from
// an earlier GET), so a pick made on the apply form can still be rejected at
// submission time if something changed in between (someone else got
// scheduled, or the candidate went on leave themselves).
export interface CoverageOptions {
  /** A leave request whose own picks/leave must not count against candidates
   *  (it already exists - e.g. re-picking a declined substitute). */
  excludeRequestId?: string;
  /** A staff adjustment being re-evaluated, same idea. */
  excludeAdjustmentId?: string;
  /** Narrows who may be offered - the Adjustments module limits an HOD to
   *  their own department's faculty. */
  candidateFilter?: (f: FacultyMember) => boolean;
}

export async function buildPeriodCoverage(
  db: Firestore,
  collegeId: string,
  facultyMemberId: string,
  department: string,
  fromDate: Date,
  toDate: Date,
  holidayDates: Set<string>,
  opts: CoverageOptions = {}
): Promise<PeriodCoverageEntry[]> {
  const required = await resolveRequiredPeriods(db, collegeId, facultyMemberId, fromDate, toDate, holidayDates);
  if (required.length === 0) return [];

  const collegeRef = db.collection("colleges").doc(collegeId);
  const [deptFacultySnap, allSlotsSnap, unavailability] = await Promise.all([
    // Every teaching faculty member in the college, not just the applicant's
    // own department: cover is routinely arranged across departments (a
    // shared first-year subject especially), and restricting the list to one
    // department left an applicant with "None available" whenever their own
    // colleagues were all teaching that period. `department` still matters -
    // it orders the list below, own department first.
    collegeRef.collection("facultyMembers").get(),
    // Only slots on the weekdays being covered can make anyone "busy" (the busy
    // map below is keyed day:period), so fetch just those days - a single-field
    // `in`, no composite index - instead of every slot of every day.
    collegeRef.collection("timetableSlots").where("day", "in", Array.from(new Set(required.map((r) => r.day)))).get(),
    // Everyone on (or awaiting a decision on) leave, the subject of another
    // adjustment, or already named to cover a period - not just APPROVED leave
    // as before, which let people with a pending leave or an existing cover
    // assignment still show up as "free". Widened past the applicant's own
    // department for the same reason the faculty list is.
    loadUnavailability(
      db, collegeId, required[0].date, required[required.length - 1].date,
      { excludeRequestId: opts.excludeRequestId, excludeAdjustmentId: opts.excludeAdjustmentId }
    ),
  ]);

  const eligibleFaculty = deptFacultySnap.docs
    .filter((d) => d.id !== facultyMemberId)
    .map((d) => ({ id: d.id, ...d.data() }) as FacultyMember)
    // Any FacultyMember record is teaching staff now that every real Faculty
    // designation lives in the admin-curated FACULTY Designation Catalog,
    // EXCEPT a not-yet-migrated legacy technical record (see
    // scripts/migrate-technical-staff-to-supporting-staff.mjs).
    .filter((f) => isFacultyAvailable(f.status) && !LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation))
    .filter((f) => !opts.candidateFilter || opts.candidateFilter(f));

  // Only the LIVE timetable counts as "already teaching then" - a section's
  // earlier semester/session keeps its slot docs as history, and those used to
  // count too, hiding people who are in fact free.
  const allSlots = allSlotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as TimetableSlot & { id: string });
  const currentSlots = await filterToCurrentSlots(db, collegeId, allSlots);
  const busyByDayPeriod = new Map<string, Set<string>>();
  for (const s of currentSlots) {
    const key = `${s.day}:${s.periodNumber}`;
    let set = busyByDayPeriod.get(key);
    if (!set) { set = new Set(); busyByDayPeriod.set(key, set); }
    set.add(s.facultyId);
  }

  return required.map((period) => {
    const busyFacultyIds = busyByDayPeriod.get(`${period.day}:${period.periodNumber}`) ?? new Set<string>();
    const candidates = eligibleFaculty
      .filter((f) =>
        !busyFacultyIds.has(f.id) &&
        !(f.userUid && unavailability.isUnavailableOn(f.userUid, period.date)) &&
        !unavailability.isCoveringAt(f.id, period.date, period.periodNumber)
      )
      .map((f) => ({ facultyId: f.id, facultyName: facultyDisplayName(f), facultyDepartment: f.department ?? "" }))
      // Own department first - the usual choice stays at the top of a list
      // that now spans the college - then by name within each group.
      .sort((a, b) => {
        const own = (d: string) => (d === department ? 0 : 1);
        return own(a.facultyDepartment) - own(b.facultyDepartment)
          || a.facultyDepartment.localeCompare(b.facultyDepartment)
          || a.facultyName.localeCompare(b.facultyName);
      });
    return { ...period, candidates };
  });
}

export interface PeriodSubstitutionInput {
  date: string;
  timetableSlotId: string;
  substituteFacultyId: string;
}

export type ValidatePeriodSubstitutionsResult =
  | { ok: true; resolved: PeriodSubstitution[] }
  | { ok: false; error: string };

// "FULL": every required period must have a submitted, valid pick (standard
// leave types - the requester's own submission, see applications/route.ts
// POST). "PARTIAL": submitted picks are optional and may cover any subset of
// the required periods (an "Other" request's HOD adjustment, see
// applications/[id]/route.ts PATCH) - anything not picked is simply left
// uncovered for the HOD/Principal to sort out manually.
export async function validatePeriodSubstitutions(params: {
  db: Firestore;
  collegeId: string;
  facultyMemberId: string;
  department: string;
  fromDate: Date;
  toDate: Date;
  holidayDates: Set<string>;
  submitted: PeriodSubstitutionInput[];
  mode: "FULL" | "PARTIAL";
  coverageOptions?: CoverageOptions;
  /** Stamped on each resolved substitution; leave flows use the default. */
  assignedByOverride?: PeriodSubstitution["assignedBy"];
}): Promise<ValidatePeriodSubstitutionsResult> {
  const { db, collegeId, facultyMemberId, department, fromDate, toDate, holidayDates, submitted, mode, coverageOptions, assignedByOverride } = params;
  const coverage = await buildPeriodCoverage(db, collegeId, facultyMemberId, department, fromDate, toDate, holidayDates, coverageOptions);

  if (mode === "FULL" && coverage.length > 0 && submitted.length !== coverage.length) {
    return { ok: false, error: `Select a substitute for all ${coverage.length} affected period(s) before submitting.` };
  }

  const byKey = new Map(coverage.map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
  const resolved: PeriodSubstitution[] = [];
  const seenKeys = new Set<string>();
  for (const sub of submitted) {
    const key = `${sub.date}|${sub.timetableSlotId}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const period = byKey.get(key);
    if (!period) return { ok: false, error: "One of the selected periods is not part of this leave request." };
    const candidate = period.candidates.find((c) => c.facultyId === sub.substituteFacultyId);
    if (!candidate) {
      return {
        ok: false,
        error: `No eligible substitute matches your selection for ${period.subjectName} on ${period.date} (period ${period.periodNumber}) - they may already be teaching then or are on leave.`,
      };
    }
    resolved.push({
      date: period.date, day: period.day, periodNumber: period.periodNumber, timetableSlotId: period.timetableSlotId,
      sectionId: period.sectionId, sectionName: period.sectionName, courseId: period.courseId,
      subjectId: period.subjectId, subjectName: period.subjectName,
      startTime: period.startTime, endTime: period.endTime,
      substituteFacultyId: candidate.facultyId, substituteFacultyName: candidate.facultyName,
      assignedBy: assignedByOverride ?? (mode === "FULL" ? "APPLICANT" : "HOD"),
    });
  }

  if (mode === "FULL" && resolved.length !== coverage.length) {
    return { ok: false, error: "Select a substitute for every affected period before submitting." };
  }

  // The picks are each individually valid by here - every one came from its own
  // period's candidate list, which already excludes anyone teaching then, on
  // leave, or covering that slot for another request. What that cannot see is
  // the picks colliding with EACH OTHER: two periods sharing a (date,
  // periodNumber) resolve their candidates independently, so the same free
  // person is offered for both, and the de-duplication above is keyed on
  // `date|timetableSlotId`, which those two periods do not share.
  const conflicts = findSubstituteConflicts(resolved);
  if (conflicts.length > 0) {
    return { ok: false, error: describeSubstituteConflict(conflicts[0]) };
  }

  return { ok: true, resolved };
}

export interface DateSubstitution {
  date: string;
  timetableSlotId: string;
  day: DayOfWeek;
  periodNumber: number;
  sectionName?: string;
  subjectName: string;
  substituteFacultyId: string;
  substituteFacultyName: string;
  requesterUid: string;
  requesterName: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Every PeriodSubstitution active on any of the given dates - i.e. from an
// APPROVED leave request whose periodSubstitutions include that exact date -
// across the whole college. Used by timetable read surfaces (section view,
// class leader view, a faculty's own Teaching Load grid) to show who's
// actually covering a period on a given day instead of the regular weekly
// assignment. Since a TimetableSlot only ever has one fixed weekday, it
// occurs on exactly one calendar date within any single WEEK of the dates
// passed in here (see currentWeekDateKeys) - but that window now spans
// several weeks, so the result is deduped down to one entry per slot before
// returning (soonest date wins - see below) and a caller can still key
// results by `timetableSlotId` alone to override "who teaches this," and/or
// filter by `substituteFacultyId` to find what a given faculty member is
// covering.
//
// A substitution is pinned to the timetableSlot doc that existed at the
// moment the HOD/applicant picked it - but publish/route.ts deletes and
// recreates every GENERATED slot with a brand-new id on each republish, even
// when the same subject stays in the same day/period. That silently orphans
// an already-approved substitution's stored id. So the id below is
// re-resolved against whatever slot currently occupies this section/day/
// period/subject, and only falls back to the originally-stored id if that
// exact placement genuinely no longer exists (the class itself was moved or
// dropped) - which the caller's Map lookup then simply won't match, same as
// before this fix.
// What this costs, and why it is cached: the lookup used to read EVERY approved
// leave the college has ever had, so one call cost as many reads as there are
// leaves on file - and it sits behind the Mark Attendance poll, the nightly
// not-posted sweep (once per faculty) and every student/class-leader timetable
// view. Two changes keep it cheap without altering what it returns:
//   1. The leave query is bounded by date (only leaves that END on or after the
//      earliest requested date can cover it), so it reads the leaves around "now",
//      not the whole history. Needs the (status, toDate) index; if that index is
//      not deployed yet it falls back to the old full read rather than failing.
//   2. Identical lookups within a few seconds share one result (and one in-flight
//      read), so a burst of polls or a sweep over 1,500 faculty reads once.
// A caller that must see a change immediately (the attendance WRITE gate) passes
// `fresh: true`.
const SUBSTITUTION_CACHE_TTL_MS = 15_000;
const SUBSTITUTION_CACHE_MAX = 200;
const substitutionCache = new Map<string, { at: number; value: Promise<DateSubstitution[]> }>();

export function invalidateSubstitutionCache(collegeId?: string): void {
  if (!collegeId) { substitutionCache.clear(); return; }
  for (const key of substitutionCache.keys()) if (key.startsWith(`${collegeId}|`)) substitutionCache.delete(key);
}

export async function getActiveSubstitutionsForDates(
  db: Firestore,
  collegeId: string,
  dateISOs: string[],
  opts: { fresh?: boolean } = {}
): Promise<DateSubstitution[]> {
  const key = `${collegeId}|${[...dateISOs].sort().join(",")}`;
  const now = Date.now();
  if (!opts.fresh) {
    const hit = substitutionCache.get(key);
    if (hit && now - hit.at < SUBSTITUTION_CACHE_TTL_MS) return hit.value;
  }
  const value = loadActiveSubstitutions(db, collegeId, dateISOs);
  if (substitutionCache.size >= SUBSTITUTION_CACHE_MAX) {
    for (const [k, v] of substitutionCache) if (now - v.at >= SUBSTITUTION_CACHE_TTL_MS) substitutionCache.delete(k);
    if (substitutionCache.size >= SUBSTITUTION_CACHE_MAX) substitutionCache.clear();
  }
  substitutionCache.set(key, { at: now, value });
  // A failed read must not be served again for the next 15 seconds.
  value.catch(() => { if (substitutionCache.get(key)?.value === value) substitutionCache.delete(key); });
  return value;
}

async function loadApprovedLeaves(collegeRef: FirebaseFirestore.DocumentReference, dateISOs: string[]) {
  const leaves = collegeRef.collection("leaveRequests").where("status", "==", "APPROVED");
  if (dateISOs.length === 0) return leaves.get();
  const earliest = [...dateISOs].sort()[0];
  // One day of slack either side: leave dates are stored as instants whose IST/UTC
  // midnight can fall a day off the calendar date being asked about.
  const floor = new Date(`${earliest}T00:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - 1);
  try {
    return await leaves.where("toDate", ">=", floor).get();
  } catch (err) {
    // 9 = FAILED_PRECONDITION: the (status, toDate) index isn't deployed yet.
    if ((err as { code?: number }).code === 9) {
      console.warn("[periodCoverage] leaveRequests (status,toDate) index missing - falling back to a full read");
      return leaves.get();
    }
    throw err;
  }
}

async function loadActiveSubstitutions(
  db: Firestore,
  collegeId: string,
  dateISOs: string[]
): Promise<DateSubstitution[]> {
  const dateSet = new Set(dateISOs);
  const collegeRef = db.collection("colleges").doc(collegeId);
  const [snap, adjustmentsSnap] = await Promise.all([
    loadApprovedLeaves(collegeRef, dateISOs),
    collegeRef.collection("staffAdjustments").where("status", "==", "ACTIVE").get(),
  ]);

  // A substitution in force comes either from an APPROVED leave or from an
  // ACTIVE manager-assigned adjustment (the Adjustments module) - either way
  // `requester` is whoever's classes are being covered.
  const active: { req: { uid: string; employeeName: string }; sub: PeriodSubstitution }[] = [];
  for (const doc of snap.docs) {
    const r = doc.data() as LeaveRequest;
    if (!r.periodSubstitutions?.length) continue;
    for (const p of r.periodSubstitutions) {
      if (dateSet.has(p.date)) active.push({ req: r, sub: p });
    }
  }
  for (const doc of adjustmentsSnap.docs) {
    const a = doc.data() as StaffAdjustment;
    for (const p of a.periodSubstitutions ?? []) {
      if (dateSet.has(p.date)) active.push({ req: { uid: a.subjectUid, employeeName: a.subjectName }, sub: p });
    }
  }
  if (active.length === 0) return [];

  const sectionIds = Array.from(new Set(active.map((a) => a.sub.sectionId)));
  const slotsSnaps = await Promise.all(
    chunk(sectionIds, 30).map((ids) => collegeRef.collection("timetableSlots").where("sectionId", "in", ids).get())
  );
  const rawSlots: (TimetableSlot & { id: string })[] = [];
  for (const slotsSnap of slotsSnaps) {
    for (const doc of slotsSnap.docs) rawSlots.push({ id: doc.id, ...doc.data() } as TimetableSlot & { id: string });
  }
  // A section can reuse the same day/period/subject placement across
  // semesters/sessions (e.g. the same subject continuing next semester) - if
  // an earlier semester's/session's now-historical slot doc happened to win
  // this map below, the substitution would resolve to an id nobody currently
  // sees on the grid instead of the live one. Restrict to current slots only,
  // same as every actual timetable read.
  const currentSlots = await filterToCurrentSlots(db, collegeId, rawSlots);
  const currentSlotIdByPlacement = new Map<string, string>();
  for (const s of currentSlots) {
    currentSlotIdByPlacement.set(`${s.sectionId}|${s.day}|${s.periodNumber}|${s.subjectId}`, s.id);
  }

  // `dateISOs` now spans several weeks (see currentWeekDateKeys), so the same
  // weekly slot can turn up more than once here - e.g. a leave approved today
  // that crosses from this week into the next still has an entry for each
  // week it touches. Keep only the soonest date per resolved slot (ISO date
  // strings sort chronologically): this week's own date wins whenever one
  // exists, exactly as before extending the window, and a later week's is
  // only surfaced when this week's slot has no substitution recorded at all.
  const bestByResolvedId = new Map<string, { req: { uid: string; employeeName: string }; sub: PeriodSubstitution; resolvedId: string }>();
  for (const { req, sub } of active) {
    const resolvedId = currentSlotIdByPlacement.get(`${sub.sectionId}|${sub.day}|${sub.periodNumber}|${sub.subjectId}`) ?? sub.timetableSlotId;
    const existing = bestByResolvedId.get(resolvedId);
    if (!existing || sub.date < existing.sub.date) {
      bestByResolvedId.set(resolvedId, { req, sub, resolvedId });
    }
  }

  return Array.from(bestByResolvedId.values()).map(({ req: r, sub: p, resolvedId }) => ({
    date: p.date, timetableSlotId: resolvedId, day: p.day, periodNumber: p.periodNumber,
    sectionName: p.sectionName, subjectName: p.subjectName,
    substituteFacultyId: p.substituteFacultyId, substituteFacultyName: p.substituteFacultyName,
    requesterUid: r.uid, requesterName: r.employeeName,
  }));
}

// Every timetableSlotId `substituteFacultyId` is covering on `dateISO`,
// mapped to who they're covering FOR (display purposes only) - built on
// getActiveSubstitutionsForDates above (reuse, not re-derived from
// leaveRequests/staffAdjustments directly). Consumed by
// lib/timetable/currentPeriod.ts's getFacultyPeriodsForDate/
// getCurrentTimetableSlot/checkFacultyPeriodWindow so a substitute's own
// attendance flow (today-periods list, and the actual write gate) recognizes
// a slot that was never assigned to them - the substitution is a read-time
// overlay only (see TimetableSlot.substituteFacultyId's own doc-comment,
// never written onto the slot doc itself), so anything that used to resolve
// "my periods" purely off TimetableSlot.facultyId has to check this too.
export async function resolveSubstituteSlotsForDate(
  db: Firestore,
  collegeId: string,
  substituteFacultyId: string,
  dateISO: string,
  opts: { fresh?: boolean } = {},
): Promise<Map<string, { originalFacultyId: string; originalFacultyName: string }>> {
  const subs = await getActiveSubstitutionsForDates(db, collegeId, [dateISO], opts);
  const map = new Map<string, { originalFacultyId: string; originalFacultyName: string }>();
  for (const s of subs) {
    if (s.substituteFacultyId !== substituteFacultyId) continue;
    map.set(s.timetableSlotId, { originalFacultyId: s.requesterUid, originalFacultyName: s.requesterName });
  }
  return map;
}

// Notifies each assigned substitute once - called only when a leave request
// reaches a final APPROVED status (see applications/[id]/route.ts and
// decideFinalStage.ts), never on a tentative HOD forward that might still be
// rejected by the Principal.
export async function notifySubstitutes(db: Firestore, collegeId: string, req: LeaveRequest): Promise<void> {
  if (!req.periodSubstitutions?.length) return;

  const byFaculty = new Map<string, PeriodSubstitution[]>();
  for (const p of req.periodSubstitutions) {
    const arr = byFaculty.get(p.substituteFacultyId) ?? [];
    arr.push(p);
    byFaculty.set(p.substituteFacultyId, arr);
  }

  for (const [facultyId, periods] of byFaculty) {
    const uid = await resolveLoginUidForFacultyMember(db, collegeId, facultyId);
    if (!uid || uid === facultyId) continue; // not provisioned with a login yet - nothing to notify
    const shown = periods.slice(0, 3).map((p) => `${p.subjectName} (${p.day} P${p.periodNumber}, ${p.date})`).join("; ");
    const rest = periods.length > 3 ? ` and ${periods.length - 3} more` : "";
    await notify(
      db, collegeId, uid, "SUBSTITUTE_ASSIGNED", "You're covering a class",
      `${req.employeeName} is on approved leave and you've been assigned to cover: ${shown}${rest}.`,
      "/panel/teaching"
    );
  }
}
