export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, ownDepartmentNames } from "@/lib/departments/scope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { resolveCollegeAcademicYear } from "@/lib/college/collegeAcademicYear";
import { makeLiveSlotPredicate } from "@/lib/timetable/liveSlots";
import { timingLookupFrom } from "@/lib/timetable/facultyOverlap";
import { getActiveSubstitutionsForDates } from "@/lib/leave/periodCoverage";
import { isFacultyAvailable, DEFAULT_TIMETABLE_RULES } from "@/types";
import { defaultPeriodTimings } from "@/lib/timetable/buildGrid";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { istDateKey } from "@/lib/attendance/istTime";
import type { CourseYearTiming, DayOfWeek, PeriodTiming, TimetableDraft, TimetableRules, TimetableSlot } from "@/types";

// "HH:MM" or nothing. Anything else is ignored rather than guessed at.
function normalizeHHMM(v: string | null): string | null {
  const t = (v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null;
}

// Parsed as a plain calendar date, not an instant - "2026-10-05" is that
// Monday whatever the server timezone is, which `new Date(iso)` alone would
// not guarantee.
function dayOfWeekFromISODate(iso: string): DayOfWeek | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  // Sunday (0) is never a working day in this app DayOfWeek union.
  return ([null, "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const)[d.getDay()] ?? null;
}

// College-wide "who is free at this time": every available faculty member with
// NO class on the given day + period, in any department. Restricted to the
// oversight roles (Principal, Vice Principal, Exam Cell, ...) - the same list as
// the Timetable pages. An HOD gets the same list narrowed to their own
// department (plus its sub-departments) - the busy check stays college-wide, so
// someone lent to another department still reads as busy. Only ever returns
// employee id, name and department.
//
// Busy = a published slot OR an unpublished draft slot (a draft still occupies
// the faculty - see faculty-schedule), each checked against its own course-year's
// current semester. Matching is by day + period NUMBER, the app-wide convention.
//
// Without day/period it just returns the pickers' options (working days,
// widest period count and the configured semester numbers).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "EXAM_CELL", "COLLEGE_ADMIN", "DIRECTOR", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    // The filter asks for a DATE, not a weekday - a date is what someone
    // scheduling an exam or a meeting actually has in hand. The timetable is
    // still keyed by weekday, so the date is resolved to one here.
    const dateParam = searchParams.get("date");
    const day = dateParam ? dayOfWeekFromISODate(dateParam) : (searchParams.get("day") as DayOfWeek | null);
    const period = Number(searchParams.get("period"));
    // Optional clock window, as an alternative to a single period: every
    // period OVERLAPPING it counts, so a 10:00-12:00 window still catches
    // someone teaching only its last ten minutes.
    const from = normalizeHHMM(searchParams.get("from"));
    const to = normalizeHHMM(searchParams.get("to"));
    const departmentFilter = (searchParams.get("department") ?? "").trim();
    const byWindow = !!from && !!to && from < to;

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const [rulesSnap, timingsSnap, deptsSnap] = await Promise.all([
      collegeRef.collection("settings").doc("timetableRules").get(),
      collegeRef.collection("courseYearTimings").get(),
      collegeRef.collection("departments").get(),
    ]);
    const rules: TimetableRules = rulesSnap.exists
      ? { ...DEFAULT_TIMETABLE_RULES, ...(rulesSnap.data() as Partial<TimetableRules>) }
      : DEFAULT_TIMETABLE_RULES;
    const timingByCourseYear = new Map<string, CourseYearTiming>();
    let periodCount = 0;
    const semesterNumbers = new Set<number>();
    // The widest course-year clock, sent to the client only so the Period
    // picker can show times and prefill the window. Busy-checking never uses
    // it - that resolves each slot against ITS OWN course-year (periodsFor
    // below), since two course-years can run the same period number at
    // different times.
    let periods: PeriodTiming[] = [];
    for (const d of timingsSnap.docs) {
      const t = d.data() as CourseYearTiming;
      timingByCourseYear.set(`${t.courseId}_${t.year}`, t);
      for (const sem of t.semesters ?? []) semesterNumbers.add(sem.semester);
      const own = t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t);
      if (own.length > periodCount) { periodCount = own.length; periods = own; }
    }
    const periodsFor = (courseId: string, year: number): PeriodTiming[] => {
      const t = timingByCourseYear.get(`${courseId}_${year}`);
      if (!t) return periods;
      return t.periods && t.periods.length > 0 ? t.periods : defaultPeriodTimings(t);
    };
    const overlapsWindow = (courseId: string, year: number, periodNumber: number): boolean => {
      const pt = periodsFor(courseId, year).find((x) => x.period === periodNumber);
      if (!pt || !from || !to) return false;
      return pt.startTime < to && pt.endTime > from;
    };

    const departmentNames = deptsSnap.docs
      .map((d) => ((d.data() as { name?: string }).name ?? "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const semesters = Array.from(semesterNumbers).sort((a, b) => a - b);

    // Options-only call: no usable date yet, or neither a period nor a window.
    if (!day || (!byWindow && (!Number.isInteger(period) || period < 1))) {
      return NextResponse.json({ workingDays: rules.workingDays, periodCount, periods, departments: departmentNames, semesters });
    }
    if (!rules.workingDays.includes(day)) {
      return NextResponse.json({ error: "That date is not a working day" }, { status: 400 });
    }

    const [facultySnap, slotsSnap, draftsSnap, leaveSnap] = await Promise.all([
      collegeRef.collection("facultyMembers").get(),
      // A window cannot be narrowed to one periodNumber up front - which
      // numbers fall inside it differs per course-year - so the whole day is
      // fetched and filtered below. One day of slots, not the whole term.
      byWindow
        ? collegeRef.collection("timetableSlots").where("day", "==", day).get()
        : collegeRef.collection("timetableSlots").where("day", "==", day).where("periodNumber", "==", period).get(),
      collegeRef.collection("timetableDrafts").get(),
      REQUESTS_COL(session.collegeId, db).where("status", "==", "APPROVED").get(),
    ]);

    // Time ranges ("HH:MM") each person is NOT free in. With a clock window a
    // person is listed when any part of the window is left over, together with
    // that leftover (e.g. window 13:40-15:20, class 13:40-14:30 -> free
    // 14:30-15:20). Period mode has no window, so any hit blocks outright.
    type Range = [string, string];
    const WHOLE_DAY: Range = ["00:00", "24:00"];
    const addRange = (m: Map<string, Range[]>, key: string, r: Range) => m.set(key, [...(m.get(key) ?? []), r]);

    // Approved leave covering the chosen date, by login uid. Leave dates are
    // midnight-IST timestamps, so they are compared as IST calendar days. A
    // half-day only blocks its own half (FN before 13:00, AN from 13:00); a
    // full-day leave blocks everything.
    const leaveByUid = new Map<string, Range[]>();
    for (const doc of leaveSnap.docs) {
      const r = doc.data() as { uid?: string; fromDate?: { toDate?: () => Date }; toDate?: { toDate?: () => Date }; isHalfDay?: boolean; halfDaySession?: "FN" | "AN" };
      const f = r.fromDate?.toDate?.();
      const t = r.toDate?.toDate?.();
      if (!r.uid || !f || !t || !dateParam) continue;
      if (istDateKey(f) > dateParam || istDateKey(t) < dateParam) continue;
      addRange(leaveByUid, r.uid, r.isHalfDay && r.halfDaySession
        ? (r.halfDaySession === "FN" ? ["00:00", "13:00"] : ["13:00", "24:00"])
        : WHOLE_DAY);
    }

    // "Live" = this course-year's current semester AND this academic session. The
    // semester check alone counted a past cohort's slots (same semester number,
    // last year) as busy, so people wrongly dropped off the free list.
    const currentAcademicYear = await resolveCollegeAcademicYear(db, session.collegeId);
    const isLive = makeLiveSlotPredicate(timingLookupFrom(Array.from(timingByCourseYear.values())), currentAcademicYear);
    const inCurrentSemester = (courseId: string, year: number, semester: number | null | undefined, academicYear?: string | null) =>
      isLive({ courseId, year, semester, academicYear });

    const periodRange = (courseId: string, year: number, periodNumber: number): Range | null => {
      const pt = periodsFor(courseId, year).find((x) => x.period === periodNumber);
      return pt ? [pt.startTime, pt.endTime] : null;
    };
    const busyByFaculty = new Map<string, Range[]>();
    const markBusy = (facultyId: string, courseId: string, year: number, periodNumber: number) => {
      if (!byWindow) return addRange(busyByFaculty, facultyId, WHOLE_DAY);
      if (!overlapsWindow(courseId, year, periodNumber)) return;
      const r = periodRange(courseId, year, periodNumber);
      if (r) addRange(busyByFaculty, facultyId, r);
    };
    for (const d of slotsSnap.docs) {
      const s = d.data() as TimetableSlot;
      if (!s.facultyId || !inCurrentSemester(s.courseId, s.year, s.semester, s.academicYear)) continue;
      markBusy(s.facultyId, s.courseId, s.year, s.periodNumber);
    }
    // Someone covering a colleague's period on this date is busy then, whatever
    // their own timetable says (the slot stays under the colleague's name).
    if (dateParam) {
      const slotById = new Map(slotsSnap.docs.map((d) => [d.id, d.data() as TimetableSlot]));
      for (const sub of await getActiveSubstitutionsForDates(db, session.collegeId, [dateParam])) {
        const slot = slotById.get(sub.timetableSlotId);
        if (slot && sub.substituteFacultyId) markBusy(sub.substituteFacultyId, slot.courseId, slot.year, slot.periodNumber);
      }
    }
    for (const d of draftsSnap.docs) {
      const draft = d.data() as TimetableDraft;
      if (draft.status !== "DRAFT" || !inCurrentSemester(draft.courseId, draft.year, draft.semester, (draft as { academicYear?: string }).academicYear)) continue;
      for (const ds of draft.slots ?? []) {
        if (!ds.facultyId || ds.day !== day) continue;
        if (!byWindow && ds.periodNumber !== period) continue;
        markBusy(ds.facultyId, draft.courseId, draft.year, ds.periodNumber);
      }
    }

    // Gaps between consecutive periods (lunch / short breaks), from the widest
    // course-year clock. They are never offered as free time - a break is not
    // a slot anyone can be scheduled into.
    const breakGaps: Range[] = [];
    const orderedPeriods = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (let i = 1; i < orderedPeriods.length; i++) {
      if (orderedPeriods[i].startTime > orderedPeriods[i - 1].endTime) {
        breakGaps.push([orderedPeriods[i - 1].endTime, orderedPeriods[i].startTime]);
      }
    }

    // The part of [from, to] not covered by any of `blocked` or a break.
    const freeWithin = (blocked: Range[]): Range[] => {
      if (!byWindow) return blocked.length ? [] : [[from ?? "", to ?? ""]];
      const sorted = [...blocked, ...breakGaps].sort((a, b) => a[0].localeCompare(b[0]));
      const out: Range[] = [];
      let cursor = from!;
      for (const [bs, be] of sorted) {
        if (bs > cursor) out.push([cursor, bs < to! ? bs : to!]);
        if (be > cursor) cursor = be;
        if (cursor >= to!) break;
      }
      if (cursor < to!) out.push([cursor, to!]);
      return out.filter(([a, b]) => a < b);
    };

    // HOD: own department tree only (ownDepartmentNames, the narrowest scope).
    const hodDepartments = session.role === "HOD"
      ? new Set(ownDepartmentNames(await getHodDepartmentScope(db, session.collegeId, session.uid)))
      : null;

    // A parent department also covers its sub-departments (BASIC SCIENCE
    // includes BASIC SCIENCE ENGLISH / MATHS), matching how an HOD's own scope
    // already works.
    let departmentScope: Set<string> | null = null;
    if (departmentFilter) {
      departmentScope = new Set([departmentFilter]);
      const rows = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as { name?: string; parentDepartmentId?: string | null }) }));
      const rootIds = new Set(rows.filter((r) => (r.name ?? "").trim() === departmentFilter).map((r) => r.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of rows) {
          if (r.parentDepartmentId && rootIds.has(r.parentDepartmentId) && !rootIds.has(r.id)) {
            rootIds.add(r.id);
            departmentScope.add((r.name ?? "").trim());
            grew = true;
          }
        }
      }
    }

    // What "free for the whole range" looks like once breaks are carved out.
    const fullRanges = JSON.stringify(freeWithin([]));

    const faculty = facultySnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as { id: string; userUid?: string; legalName?: string; status?: string; department?: string; employeeId?: string })
      // ON_LEAVE is a manual flag with no dates, so it no longer excludes on its
      // own - real approved leave on the chosen date does (leaveByUid).
      .filter((f) => (isFacultyAvailable(f.status) || f.status === "ON_LEAVE")
        && (!hodDepartments || hodDepartments.has(f.department ?? ""))
        && (!departmentScope || departmentScope.has(f.department ?? "")))
      .map((f) => {
        const blocked = [...(busyByFaculty.get(f.id) ?? []), ...(f.userUid ? leaveByUid.get(f.userUid) ?? [] : [])];
        return { f, freeRanges: freeWithin(blocked) };
      })
      .filter(({ freeRanges }) => freeRanges.length > 0)
      .map(({ f, freeRanges }) => ({
        id: f.id, employeeId: f.employeeId ?? "", name: facultyDisplayName(f), department: f.department ?? "",
        // Only sent when the person is free for just PART of the window.
        freeRanges: byWindow && JSON.stringify(freeRanges) !== fullRanges ? freeRanges : undefined,
      }))
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));

    return NextResponse.json({ workingDays: rules.workingDays, periodCount, periods, departments: departmentNames, semesters, faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-leisure GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
