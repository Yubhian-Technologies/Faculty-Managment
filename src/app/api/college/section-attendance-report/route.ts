export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { getFacultyIdCandidates } from "@/lib/faculty/resolveFacultyMemberId";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import { countFullyAbsentDays, indexSessions, tallyStudentBySubject } from "@/lib/studentAttendance/counting";
import { isShortageByPercent } from "@/lib/studentAttendance/shortage";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { compareStudentsForList } from "@/lib/students/listOrder";
import {
  loadAcademicYearConfig, resolveAcademicYearRequest, sessionInAcademicYear, windowForAcademicYear,
  type AcademicYearConfig, type AcademicYearWindow,
} from "@/lib/studentAttendance/academicYearWindow";
import {
  denominatorNumbers, loadNotPostedIndex, resolveDenominatorMode, type DenominatorResult, type HeldDenominatorMode,
} from "@/lib/studentAttendance/heldDenominator";
import { istDateKey } from "@/lib/attendance/istTime";
import type { Section, StudentAttendanceMark, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The section's CURRENT teaching-assignment subject list (every subject an
// HOD has actually assigned a faculty to teach this section, any faculty) -
// shared by every mode below. A Subject only reaches teachingAssignments
// once it's part of the Academics-defined curriculum for that
// Course+Year (subjects.courseId/year), so this is already exactly "the
// subjects assigned to that Section/Year by Academics", not a separate
// query - and it's the stable, date-independent column set for every
// report mode (Monthly, Period, Till Now alike).
async function currentSectionSubjects(
  collegeRef: FirebaseFirestore.DocumentReference,
  sectionId: string,
  requestedSemester: number | null
): Promise<{ subjectId: string; subjectName: string; subjectCode: string }[]> {
  const assignmentsSnap = await collegeRef.collection("teachingAssignments")
    .where("sectionId", "==", sectionId).get();
  const bySubject = new Map<string, TeachingAssignment>();
  for (const doc of assignmentsSnap.docs) {
    const a = doc.data() as TeachingAssignment;
    if (a.isPast) continue;
    // Same leniency as matchesCurrentSemester everywhere else - an assignment
    // never tagged with a semester (course-year has none configured) still
    // counts regardless of which semester was requested.
    if (requestedSemester != null && !matchesCurrentSemester(a.timetableSemester, requestedSemester)) continue;
    if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
  }
  return Array.from(bySubject.values())
    .map((a) => ({ subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
}

// "Attendance Reports": Section -> Year -> Month -> Date, aggregated across
// EVERY subject and faculty assigned to that section - unlike the Faculty
// Attendance Report (see /api/college/class-work-records), which is scoped
// to one faculty's own periods. Reuses the same submitted student-attendance
// sessions and the same canonical section-roster query
// (lib/students/sectionRoster.ts) - no separate/duplicate data source.
//
// Two callers share this route: HOD (their own department tree only - see
// canHodEditDepartment) and PRINCIPAL/VICE_PRINCIPAL (every department in the
// college, view-only - this route is GET-only regardless). The HOD path is
// unchanged from before Principal support was added.
//
// Drill levels, selected by which query params are present:
//   sectionId only                       -> { years: number[] }
//   sectionId + year                     -> { months: number[] }
//   sectionId + year + month             -> { dates: string[] }, newest first
//   sectionId + year + month + summary   -> { subjects, weekLabels, students } (see below) - "Month Report"
//   sectionId + year + month + date      -> { subjects, students, classwork }        (Monthly - unchanged)
//   sectionId + summary + from/to        -> { subjects, students } - "Period" (hod/monthly-records's own
//                                            Period tab - subjects derived from whatever sessions actually
//                                            fall in range, so a since-retired subject still shows up)
//   sectionId + summary + allTime        -> { subjects, students } - "Till now" (same page/shape as above)
//   sectionId + from + to (no summary)   -> { subjects, students, summary }          (a second, independently
//   sectionId + tillNow=true                built Period/Till-Now consumer - subjects instead fixed to the
//                                            section's CURRENT teaching-assignment roster, and each student
//                                            additionally carries `overall`, plus a section-wide `summary`
//                                            footer. Kept alongside the mode above rather than merged into
//                                            it since the two disagree on subject scope and response shape;
//                                            distinguished by the presence of `summary=true`, which this
//                                            mode never sends.)
// Cohort integrity (audit F-24): a Section is a year-slot that a new cohort
// occupies each academic year, so the two UNBOUNDED modes ("Till now" /
// summary+allTime) read ONE academic year - the current one, or
// `academicYear=2025-26`, or `all` for the old everything-ever behaviour. A
// session's year is its own stamp or, for one written before stamping, its date.
// Explicit ranges (`from`/`to`, year/month) are the caller's choice and are
// never overridden.
//
// Held denominator (audit F-25): the two cumulative modes can count published-
// timetable periods nobody posted as held (`denominator=timetable`, or the
// college's own setting). The default is the original submitted-only numbers;
// `compare=true` adds the other definition beside each figure as `alt`.
//
// The `from`/`to`/`tillNow`/`summary` modes are all checked BEFORE the
// year/month/date drill chain and are mutually exclusive with it (the
// Monthly flow never sends them), so the existing Monthly behavior below is
// untouched either way.
//
// `subjects` is the section's CURRENT teaching-assignment roster (every
// subject an HOD has actually assigned to it, any faculty) - stable across
// dates, not filtered to "had a class that day", so the column set doesn't
// shift date to date. `classwork`/per-subject status only appear for
// subjects that actually had a submitted session on the selected date.
//
// `summary=true` (mutually exclusive with `date`) instead returns a whole
// month's Present/Total percentages per student per subject, broken down by
// week - the "Month Report" tab (see hod/monthly-records/.../[year]/[month]/
// page.tsx). Weeks follow the SAME Sun-Sat calendar-row boundaries as that
// page's own month-picker grid (a week can therefore be a partial one at
// either end of the month), not a naive "every 7 days from the 1st" - so a
// week's label always matches what the visible calendar shows as one row.
// `null` for a given subject/week means no class was actually held for it
// that week (never "0%" - a real 0% requires at least one held class the
// student missed).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "PANEL_MEMBER");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const dateParam = searchParams.get("date");
    // "Period"/"Till now" summary - see the two branches right after
    // `allSessions` below. Independent of the year/month drill levels
    // above; `allTime`/`tillNow` with neither `from` nor `to` means the
    // section's entire history. `summaryParam` distinguishes which of the
    // two independently-built Period/Till-Now modes a `from`/`to` pair
    // belongs to - see the drill-levels comment above.
    const summaryParam = searchParams.get("summary") === "true";
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const allTimeParam = searchParams.get("allTime") === "true";
    const tillNow = searchParams.get("tillNow") === "true";
    const absentOnly = searchParams.get("absentOnly") === "true";
    const shortage = searchParams.get("shortage") === "true";
    const subjectFilter = searchParams.get("subjectId")?.trim() || null;
    const consolidated = searchParams.get("consolidated") === "true";
    const thresholdRaw = searchParams.get("threshold");
    const threshold = thresholdRaw != null ? Math.max(0, Math.min(100, Number(thresholdRaw) || 75)) : 75;
    const dailyPercent = searchParams.get("dailyPercent") === "true";
    const compare = searchParams.get("compare") === "true";
    const hostellerParam = searchParams.get("hosteller") as "yes" | "no" | null;
    // Optional - narrows every mode below (they all derive from allSessions/
    // currentSectionSubjects) to one semester's own subjects/sessions.
    // Omitted counts every subject/session regardless of semester, same as
    // before this existed.
    const semesterParam = searchParams.get("semester");
    if (semesterParam != null && !Number.isFinite(Number(semesterParam))) {
      return NextResponse.json({ error: "semester must be a valid number" }, { status: 400 });
    }
    const requestedSemester = semesterParam != null ? Number(semesterParam) : null;
    const filterByHosteller = <T extends { hosteller?: boolean }>(list: T[]): T[] => {
      if (hostellerParam === "yes") return list.filter((s) => s.hosteller === true);
      if (hostellerParam === "no") return list.filter((s) => s.hosteller !== true);
      return list;
    };

    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
    }
    // A reversed range wouldn't error out below - the date filter would
    // just never match anything, silently returning an empty (not wrong,
    // but confusing) report instead of the mistake it actually is. Caught
    // here as a backstop even though the picker page itself already
    // validates this, since this route is reachable directly by URL too.
    if (fromParam && toParam && fromParam > toParam) {
      return NextResponse.json({ error: "From date must be before the To date" }, { status: 400 });
    }
    // From/to without a valid bound must never reach an unbounded
    // Firebase `.where("date", ...).get()` scan - be explicit and fail
    // closed instead.
    if (fromParam && !DATE_RE.test(fromParam)) {
      return NextResponse.json({ error: "from must be a valid date (YYYY-MM-DD)" }, { status: 400 });
    }
    if (toParam && !DATE_RE.test(toParam)) {
      return NextResponse.json({ error: "to must be a valid date (YYYY-MM-DD)" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const sectionSnap = await collegeRef.collection("sections").doc(sectionId).get();
    if (!sectionSnap.exists) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }
    const section = sectionSnap.data() as Section;

    // HOD stays scoped to their own department tree, exactly as before.
    // PRINCIPAL/VICE_PRINCIPAL have no department restriction - they can
    // report on any section in the college.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, section.department)) {
        return NextResponse.json({ error: "This section isn't in your department" }, { status: 403 });
      }
    }

    // A class incharge (a faculty login, PANEL_MEMBER) may report on the
    // sections they are in charge of - and only those. Section.facultyInchargeUid
    // holds their login uid or, on older records, their FacultyMember doc id.
    if (session.role === "PANEL_MEMBER") {
      const candidateIds = await getFacultyIdCandidates(db, session.collegeId, session.uid);
      if (!section.facultyInchargeUid || !candidateIds.includes(section.facultyInchargeUid)) {
        return NextResponse.json({ error: "You are not the class incharge of this section" }, { status: 403 });
      }
    }

    // Bounds (if any) are applied at query time with .where();
    // unbounded paths keep the same shape so the response contract is
    // stable and callers don't need to special-case "no filter".
    // Bounded by date wherever the request itself names a range: each session
    // carries its whole roster, so pulling a section's entire history to show
    // one month was the dominant cost of this route. Only the year/month
    // pickers (which need every date to list what exists) stay unbounded, and
    // those read just the two fields they use.
    // The cumulative modes with no range of their own are the ones a promoted
    // cohort used to leak into - bound them to one academic year.
    const rangeIsUnbounded = tillNow || (summaryParam && allTimeParam && !fromParam && !toParam);
    let yearCfg: AcademicYearConfig | null = null;
    let academicWindow: AcademicYearWindow | null = null;
    if (rangeIsUnbounded) {
      yearCfg = await loadAcademicYearConfig(db, session.collegeId);
      const yearRequest = resolveAcademicYearRequest(searchParams.get("academicYear"), yearCfg);
      if (yearRequest.error) return NextResponse.json({ error: yearRequest.error }, { status: 400 });
      academicWindow = yearRequest.window ?? null;
    }
    let dateFrom: string | null = null;
    let dateTo: string | null = null;
    if (rangeIsUnbounded && academicWindow) {
      dateFrom = academicWindow.from;
      dateTo = academicWindow.to;
    } else if (summaryParam && (fromParam || toParam)) {
      dateFrom = fromParam;
      dateTo = toParam;
    } else if (!summaryParam && fromParam && toParam) {
      dateFrom = fromParam;
      dateTo = toParam;
    } else if (!tillNow && !allTimeParam && yearParam && /^\d{4}$/.test(yearParam)) {
      if (monthParam && Number(monthParam) >= 1 && Number(monthParam) <= 12) {
        const mm = String(Number(monthParam)).padStart(2, "0");
        dateFrom = `${yearParam}-${mm}-01`;
        dateTo = `${yearParam}-${mm}-31`;
      } else {
        dateFrom = `${yearParam}-01-01`;
        dateTo = `${yearParam}-12-31`;
      }
    }
    const listingDatesOnly = !tillNow && !allTimeParam && !fromParam && !toParam && !summaryParam && !dateParam && !(yearParam && monthParam);
    let sessionsQuery: FirebaseFirestore.Query = collegeRef.collection("studentAttendance")
      .where("sectionId", "==", sectionId)
      .where("status", "==", "SUBMITTED");
    if (dateFrom) sessionsQuery = sessionsQuery.where("date", ">=", dateFrom);
    if (dateTo) sessionsQuery = sessionsQuery.where("date", "<=", dateTo);
    if (listingDatesOnly) sessionsQuery = sessionsQuery.select("date", "semester", "subjectId");
    const sessionsSnap = await sessionsQuery.get();
    // Filtered once here (same leniency as currentSectionSubjects above) -
    // every mode below derives from this single list, so this is the one
    // place a semester filter needs to apply for all of them to be correct.
    const allSessions = sessionsSnap.docs
      .map((d) => d.data() as StudentAttendanceSession)
      .filter((r) => requestedSemester == null || matchesCurrentSemester(r.semester, requestedSemester))
      // A stamped session belongs to its own academic year; an unstamped one was
      // placed by its date in the query above.
      .filter((r) => !rangeIsUnbounded || !yearCfg || sessionInAcademicYear(r, academicWindow));

    // The held-classes definition for the two cumulative modes below. Resolved
    // (and the not-posted periods loaded) only when the request asks for the
    // timetable denominator or a comparison - the default path reads nothing extra.
    const denominator: HeldDenominatorMode = (summaryParam && (fromParam || toParam || allTimeParam)) || tillNow || (fromParam && toParam)
      ? await resolveDenominatorMode(db, session.collegeId, searchParams.get("denominator"))
      : "SUBMITTED";
    const loadNotPosted = async (submitted: StudentAttendanceSession[]): Promise<DenominatorResult | null> => {
      if (denominator !== "TIMETABLE" && !compare) return null;
      // The published timetable describes the CURRENT cohort, so the not-posted
      // periods are only ever computed inside the current academic year - whatever
      // range the report itself covers (a past year is reported as unavailable).
      const cfg = yearCfg ?? await loadAcademicYearConfig(db, session.collegeId);
      const currentWindow = windowForAcademicYear(cfg.currentLabel, cfg);
      return loadNotPostedIndex({
        db, collegeId: session.collegeId, section: { id: sectionId, courseId: section.courseId, year: section.year },
        from: fromParam ?? academicWindow?.from ?? currentWindow?.from ?? `${new Date().getFullYear()}-01-01`,
        to: toParam ?? academicWindow?.to ?? istDateKey(),
        window: academicWindow && !academicWindow.isCurrent ? academicWindow : currentWindow,
        requestedSemester,
        submittedSessions: submitted.map((r) => ({ assignmentId: r.assignmentId, date: r.date, periodNumber: r.periodNumber })),
      });
    };

    // "Period" (from/to) or "Till now" (allTime, no bounds) - every student
    // x every subject's Held/Attend/% across an arbitrary range, mirroring
    // /api/college/student-attendance-history's own range logic but for the
    // whole section at once. Subjects are derived from whatever sessions
    // actually fall in range - not the CURRENT teaching-assignment roster
    // (see currentSectionSubjects, used by the month-scoped summary/date
    // branches below) - so a subject from an earlier semester/session still
    // appears in a long-enough Period or a Till-now report instead of
    // silently vanishing once teaching assignments move on. No weekly
    // breakdown (unlike the month summary below) - a range spanning more
    // than one month has no single calendar grid to align weeks against.
    // Gated on `summary=true` specifically so it never collides with the
    // independently-built Period/Till-Now mode right after it, which never
    // sends that flag.
    if (summaryParam && (fromParam || toParam || allTimeParam)) {
      const inRange = allSessions.filter((r) => {
        if (fromParam && r.date < fromParam) return false;
        if (toParam && r.date > toParam) return false;
        return true;
      });

      const subjectsMap = new Map<string, { subjectName: string; subjectCode: string }>();
      for (const r of inRange) {
        if (!subjectsMap.has(r.subjectId)) subjectsMap.set(r.subjectId, { subjectName: r.subjectName, subjectCode: r.subjectCode });
      }
      // Periods the timetable says were held but nobody posted (only loaded on request).
      const notPosted = await loadNotPosted(inRange);
      // A subject nobody has posted a single session for yet has no session to
      // derive a column from - exactly the case the timetable denominator is for.
      if (denominator === "TIMETABLE" && notPosted) {
        for (const p of notPosted.index.periods) {
          const meta = notPosted.subjects?.get(p.subjectId);
          if (!subjectsMap.has(p.subjectId)) subjectsMap.set(p.subjectId, { subjectName: meta?.subjectName ?? "", subjectCode: meta?.subjectCode ?? "" });
        }
      }
      const subjects = Array.from(subjectsMap.entries())
        .map(([subjectId, v]) => ({ subjectId, subjectName: v.subjectName, subjectCode: v.subjectCode }))
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

      // Every submitted session is one period (see lib/studentAttendance/counting.ts).
      const indexedInRange = indexSessions(inRange);

      const roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });

      let students = roster
        .map((stu) => {
          type Cell = { held: number; attend: number; percent: number | null };
          const bySubject: Record<string, Cell & { alt?: Cell & { mode: HeldDenominatorMode } }> = {};
          const tallies = tallyStudentBySubject(indexedInRange, stu.id);
          const owed = notPosted?.index.forStudent(stu);
          let aHeld = 0, aAttend = 0;
          for (const sub of subjects) {
            const { main, alt } = denominatorNumbers(tallies.get(sub.subjectId), owed?.get(sub.subjectId) ?? 0, denominator);
            bySubject[sub.subjectId] = {
              held: main.held, attend: main.attended, percent: main.percentage,
              ...(compare ? { alt: { mode: alt.mode, held: alt.held, attend: alt.attended, percent: alt.percentage } } : {}),
            };
            aHeld += alt.held; aAttend += alt.attended;
          }
          // consolidated overall for this range
          let cHeld = 0, cAttend = 0;
          for (const v of Object.values(bySubject)) { cHeld += v.held; cAttend += v.attend; }
          const overall = {
            held: cHeld, attended: cAttend, percentage: calcPercent(cAttend, cHeld),
            ...(compare ? { alt: { held: aHeld, attended: aAttend, percentage: calcPercent(aAttend, aHeld) } } : {}),
          };
          return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, bySubject, overall };
        })
        // compareStudentsForList, not rollNumber.localeCompare: a student with no
        // roll number sorts last by name instead of throwing.
        .sort(compareStudentsForList);

      // Apply absentOnly / shortage / subjectFilter / consolidated filters
      if (subjectFilter) {
        // keep original but filter downstream: shortage/absent checks only that subject
      }
      if (absentOnly) {
        students = students.filter((s) => {
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && v.held > 0 && v.attend < v.held;
          }) || (consolidated && s.overall.held > 0 && s.overall.attended < s.overall.held);
        });
      }
      if (shortage) {
        students = students.filter((s) => {
          if (consolidated) return isShortageByPercent(s.overall.percentage, threshold);
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && isShortageByPercent(v.percent, threshold);
          });
        });
      }

      return NextResponse.json({
        subjects, students,
        meta: {
          absentOnly, shortage, threshold, consolidated, subjectFilter, total: students.length,
          academicYear: rangeIsUnbounded ? (academicWindow?.label ?? "all") : undefined,
          denominator,
          ...(notPosted?.unavailable ? { denominatorUnavailable: notPosted.unavailable } : {}),
        },
      });
    }

    // A second, independently built Period/Till Now mode (bare `from`/`to`,
    // or `tillNow=true`, never `summary=true`) - attendance % per subject
    // (and overall) per student, computed from every SUBMITTED session (any
    // date, any period) in range - not scoped to one calendar day like the
    // Monthly drill-down below, and never carrying forward/merging periods
    // (each submitted session is already one independently-held period -
    // see types/studentAttendance.ts's doc id). Kept alongside the mode
    // above rather than merged into it: this one fixes its subject list to
    // the section's CURRENT teaching-assignment roster (via
    // currentSectionSubjects) rather than deriving it from sessions in
    // range, and shapes each student's per-subject stats and the response's
    // own section-wide `summary` footer differently.
    if (tillNow || (fromParam && toParam)) {
      if (!tillNow && (!DATE_RE.test(fromParam!) || !DATE_RE.test(toParam!))) {
        return NextResponse.json({ error: "from and to must be valid dates (YYYY-MM-DD)" }, { status: 400 });
      }
      const rangeSessions = tillNow
        ? allSessions
        : allSessions.filter((r) => r.date >= fromParam! && r.date <= toParam!);

      const subjects = await currentSectionSubjects(collegeRef, sectionId, requestedSemester);
      const sessionsBySubject = new Map<string, StudentAttendanceSession[]>();
      for (const r of rangeSessions) {
        if (!sessionsBySubject.has(r.subjectId)) sessionsBySubject.set(r.subjectId, []);
        sessionsBySubject.get(r.subjectId)!.push(r);
      }
      const indexedRange = indexSessions(rangeSessions);

      let roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });
      roster = filterByHosteller(roster as unknown as { hosteller?: boolean }[]) as typeof roster;

      // Periods the timetable says were held but nobody posted (only loaded on request).
      const notPosted = await loadNotPosted(rangeSessions);

      let students = roster
        .map((stu) => {
          let overallHeld = 0;
          let overallAttended = 0;
          let altHeld = 0;
          let altAttended = 0;
          type Cell = { held: number; attended: number; percentage: number | null };
          const bySubject: Record<string, Cell & { alt?: Cell & { mode: HeldDenominatorMode } }> = {};
          const tallies = tallyStudentBySubject(indexedRange, stu.id);
          const owed = notPosted?.index.forStudent(stu);
          for (const s of subjects) {
            const { main, alt } = denominatorNumbers(tallies.get(s.subjectId), owed?.get(s.subjectId) ?? 0, denominator);
            bySubject[s.subjectId] = { ...main, ...(compare ? { alt } : {}) };
            overallHeld += main.held;
            overallAttended += main.attended;
            altHeld += alt.held;
            altAttended += alt.attended;
          }
          const overallPercentage = calcPercent(overallAttended, overallHeld);
          return {
            studentId: stu.id,
            rollNumber: stu.rollNumber,
            name: stu.name,
            labBatch: stu.labBatch ?? "",
            absentDays: countFullyAbsentDays(indexedRange, stu.id),
            bySubject,
            overall: {
              held: overallHeld, attended: overallAttended, percentage: overallPercentage,
              ...(compare ? { alt: { held: altHeld, attended: altAttended, percentage: calcPercent(altAttended, altHeld) } } : {}),
            },
          };
        })
        .sort((a, b) =>
          compareStudentsForList({ id: a.studentId, rollNumber: a.rollNumber, name: a.name }, { id: b.studentId, rollNumber: b.rollNumber, name: b.name }));

      if (absentOnly) {
        students = students.filter((s: {
          bySubject: Record<string, { held: number; attended: number; percentage: number | null }>;
          overall: { held: number; attended: number; percentage: number | null };
        }) => {
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && v.held > 0 && v.attended < v.held;
          }) || (consolidated && s.overall.held > 0 && s.overall.attended < s.overall.held);
        }) as typeof students;
      }
      if (shortage) {
        students = students.filter((s: {
          bySubject: Record<string, { held: number; attended: number; percentage: number | null }>;
          overall: { held: number; attended: number; percentage: number | null };
        }) => {
          if (consolidated) return isShortageByPercent(s.overall.percentage, threshold);
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && isShortageByPercent(v.percentage, threshold);
          });
        }) as typeof students;
      }

      // Section-wide summary for the "Total Attendance" footer - Held is a
      // period count (sum of every subject's held sessions, same for every
      // student); Attended/Percentage are marks-based (sum of presentCount /
      // totalStudents across every session in range, using each session's
      // own stored roster size rather than today's roster - robust to
      // students joining/leaving mid-range, same approach as the Faculty
      // Attendance Report's subject-percentage feature).
      const totalPeriodsHeld = subjects.reduce((sum, s) => sum + (sessionsBySubject.get(s.subjectId)?.length ?? 0), 0);
      const totalPresentMarks = rangeSessions.reduce((sum, r) => sum + r.presentCount, 0);
      const totalPossibleMarks = rangeSessions.reduce((sum, r) => sum + r.totalStudents, 0);
      const summary = {
        totalPeriodsHeld,
        totalPeriodsAttended: totalPresentMarks,
        overallPercentage: totalPossibleMarks > 0 ? Math.round((totalPresentMarks / totalPossibleMarks) * 100) : 0,
      };

      return NextResponse.json({
        subjects, students, summary,
        meta: {
          academicYear: rangeIsUnbounded ? (academicWindow?.label ?? "all") : undefined,
          denominator,
          ...(notPosted?.unavailable ? { denominatorUnavailable: notPosted.unavailable } : {}),
        },
      });
    }

    if (!yearParam) {
      const years = Array.from(new Set(allSessions.map((r) => Number(r.date.slice(0, 4))))).sort((a, b) => b - a);
      return NextResponse.json({ years });
    }

    const year = Number(yearParam);
    const inYear = allSessions.filter((r) => Number(r.date.slice(0, 4)) === year);

    if (!monthParam) {
      const months = Array.from(new Set(inYear.map((r) => Number(r.date.slice(5, 7))))).sort((a, b) => a - b);
      return NextResponse.json({ months });
    }

    const monthStr = String(Number(monthParam)).padStart(2, "0");
    const inMonth = inYear.filter((r) => r.date.slice(5, 7) === monthStr);

    if (summaryParam && !dateParam) {
      const subjects = await currentSectionSubjects(collegeRef, sectionId, requestedSemester);

      // Sun-Sat calendar-row week boundaries for this month, matching the
      // month-picker grid on the page that consumes this - week 0 starts
      // wherever day 1 falls in its own Sun-Sat row, so the first and last
      // week can be partial.
      const daysInMonth = new Date(year, Number(monthParam), 0).getDate();
      const firstWeekday = new Date(year, Number(monthParam) - 1, 1).getDay(); // 0 = Sunday
      const lastWeekIndex = Math.floor((daysInMonth - 1 + firstWeekday) / 7);
      const weekRanges = Array.from({ length: lastWeekIndex + 1 }, (_, w) => {
        const startDay = Math.max(1, w * 7 - firstWeekday + 1);
        const endDay = Math.min(daysInMonth, (w + 1) * 7 - firstWeekday);
        return { startDay, endDay, label: startDay === endDay ? `${startDay}` : `${startDay}–${endDay}` };
      });
      const weekIndexForDate = (dateStr: string) => {
        const day = Number(dateStr.slice(8, 10));
        return Math.floor((day - 1 + firstWeekday) / 7);
      };

      // Every submitted session is one period (see lib/studentAttendance/counting.ts).
      const indexedBySubject = new Map<string, ReturnType<typeof indexSessions<StudentAttendanceSession>>>();
      for (const ix of indexSessions(inMonth)) {
        const arr = indexedBySubject.get(ix.session.subjectId) ?? [];
        arr.push(ix);
        indexedBySubject.set(ix.session.subjectId, arr);
      }

      let roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });
      roster = filterByHosteller(roster as unknown as { hosteller?: boolean }[]) as typeof roster;

      let students = roster
        .map((stu) => {
          const bySubject: Record<string, { weeks: (number | null)[]; monthPresent: number; monthTotal: number; monthPercent: number | null }> = {};
          for (const sub of subjects) {
            const weekPresent = new Array(weekRanges.length).fill(0) as number[];
            const weekTotal = new Array(weekRanges.length).fill(0) as number[];
            for (const { session: r, marks } of indexedBySubject.get(sub.subjectId) ?? []) {
              if (!marks.has(stu.id)) continue; // not on this session's roster (other lab batch / joined later)
              const wi = weekIndexForDate(r.date);
              weekTotal[wi] += 1;
              if (marks.get(stu.id) === "PRESENT") weekPresent[wi] += 1;
            }
            const weeks = weekPresent.map((p, i) => (weekTotal[i] > 0 ? Math.round((p / weekTotal[i]) * 100) : null));
            const monthTotal = weekTotal.reduce((a, b) => a + b, 0);
            const monthPresent = weekPresent.reduce((a, b) => a + b, 0);
            bySubject[sub.subjectId] = {
              weeks, monthPresent, monthTotal,
              monthPercent: monthTotal > 0 ? Math.round((monthPresent / monthTotal) * 100) : null,
            };
          }
          return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, bySubject };
        })
        .sort(compareStudentsForList);

      // Apply absentOnly / shortage filters for month view
      if (absentOnly) {
        students = students.filter((s: {
          bySubject: Record<string, { weeks: (number | null)[]; monthPresent: number; monthTotal: number; monthPercent: number | null }>;
        }) => {
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && v.monthTotal > 0 && v.monthPresent < v.monthTotal;
          });
        }) as typeof students;
      }
      if (shortage) {
        students = students.filter((s: {
          bySubject: Record<string, { monthPercent: number | null }>;
        }) => {
          if (consolidated) {
            let cHeld = 0, cAtt = 0;
            for (const v of Object.values(s.bySubject) as unknown as { monthPresent: number; monthTotal: number }[]) { cHeld += (v as { monthTotal: number }).monthTotal; cAtt += (v as { monthPresent: number }).monthPresent; }
            return isShortageByPercent(calcPercent(cAtt, cHeld), threshold);
          }
          const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubject);
          return keys.some((k) => {
            const v = s.bySubject[k];
            return v && isShortageByPercent(v.monthPercent, threshold);
          });
        }) as typeof students;
      }

      return NextResponse.json({ subjects, weekLabels: weekRanges.map((w) => w.label), students, meta: { absentOnly, shortage, threshold } });
    }

    if (!dateParam) {
      const dates = Array.from(new Set(inMonth.map((r) => r.date))).sort((a, b) => b.localeCompare(a));
      return NextResponse.json({ dates });
    }

    // Every subject currently assigned to this section, any faculty - the
    // report's stable column set.
    const subjects = await currentSectionSubjects(collegeRef, sectionId, requestedSemester);

    const dayRecords = inMonth.filter((r) => r.date === dateParam);
    const indexedDay = indexSessions(dayRecords);
    const sessionBySubject = new Map<string, StudentAttendanceSession>();
    for (const r of dayRecords) {
      if (!sessionBySubject.has(r.subjectId)) sessionBySubject.set(r.subjectId, r);
    }

    const classwork = subjects
      .filter((s) => sessionBySubject.has(s.subjectId))
      .map((s) => {
        const r = sessionBySubject.get(s.subjectId)!;
        return { subjectId: s.subjectId, subjectName: s.subjectName, classNotes: r.classNotes ?? "" };
      });

      let roster = await fetchSectionStudents(collegeRef, {
        department: section.department,
        sectionName: section.name,
        year: section.year,
        courseId: section.courseId,
      });
      roster = filterByHosteller(roster as unknown as { hosteller?: boolean }[]) as typeof roster;

      let students = roster
      .map((stu) => {
        const statusBySubject: Record<string, StudentAttendanceMark | null> = {};
        for (const s of subjects) {
          const r = sessionBySubject.get(s.subjectId);
          const entry = r?.entries.find((e) => e.studentId === stu.id);
          statusBySubject[s.subjectId] = entry?.status ?? null;
        }
        // also compute percent per subject for this single day (1 held if session exists)
        const bySubjectDaily: Record<string, { held: number; attend: number; percent: number | null }> = {};
        const dayTallies = tallyStudentBySubject(indexedDay, stu.id);
        for (const s of subjects) {
          const { held: has, attended: present } = dayTallies.get(s.subjectId) ?? { held: 0, attended: 0 };
          bySubjectDaily[s.subjectId] = { held: has, attend: present, percent: calcPercent(present, has) };
        }
        let cHeld = 0, cAtt = 0;
        for (const v of Object.values(bySubjectDaily)) { cHeld += v.held; cAtt += v.attend; }
        const overall = { held: cHeld, attended: cAtt, percentage: calcPercent(cAtt, cHeld) };
        return { id: stu.id, rollNumber: stu.rollNumber, name: stu.name, statusBySubject, bySubjectDaily, overall };
      })
      .sort(compareStudentsForList);

    if (absentOnly) {
      students = students.filter((s) => {
        const keys = subjectFilter ? [subjectFilter] : Object.keys(s.statusBySubject);
        return keys.some((k) => s.statusBySubject[k] === "ABSENT") || (consolidated && s.overall.held > 0 && s.overall.attended < s.overall.held);
      });
    }
    if (shortage) {
      students = students.filter((s) => {
        if (consolidated) return isShortageByPercent(s.overall.percentage, threshold);
        const keys = subjectFilter ? [subjectFilter] : Object.keys(s.bySubjectDaily);
        return keys.some((k) => {
          const v = s.bySubjectDaily[k];
          return v && isShortageByPercent(v.percent, threshold);
        });
      });
    }
    // dailyPercent flag: if requested, client can read bySubjectDaily/overall percent directly

    return NextResponse.json({ subjects, students, classwork, meta: { absentOnly, shortage, threshold, dailyPercent } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-attendance-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
