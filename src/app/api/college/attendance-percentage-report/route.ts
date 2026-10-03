export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getDepartmentTreeNames } from "@/lib/departments/scope";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import { indexSessions, tallyStudentBySubject } from "@/lib/studentAttendance/counting";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { compareStudentsForList } from "@/lib/students/listOrder";
import { loadAcademicYearConfig, resolveAcademicYearRequest, sessionInAcademicYear, windowForAcademicYear } from "@/lib/studentAttendance/academicYearWindow";
import { loadNotPostedIndex, resolveDenominatorMode, withNotPosted, type DenominatorResult } from "@/lib/studentAttendance/heldDenominator";
import { istDateKey } from "@/lib/attendance/istTime";
import type { Section, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Cross-section attendance-percentage report: Department + Course + Year,
// optionally narrowed to one Section and/or one Semester (see the optional
// `semester` param below - distinct from `year`, the course's ordinal
// academic year, e.g. "2nd Year"), with a percentage range filter - for
// finding students below (or above) a threshold, e.g. exam-eligibility
// defaulters. Reuses the exact same roster (lib/students/sectionRoster.ts)
// and per-student Held/Attended/% math as section-attendance-report's own
// "till now" mode, just looped across every section in scope instead of one -
// there's no cross-section report like this today.
//
// Bounded by date (audit F-43) and by academic year (F-24): each submitted
// session carries its whole roster, and reading a section's ENTIRE history for
// a defaulter list was both the dominant cost of this route and the way a new
// cohort inherited the previous cohort's sessions. It now reads one academic
// year - the current one unless `academicYear=2025-26` (or `all`, the old
// unbounded behaviour) says otherwise - optionally narrowed further by
// `from`/`to`. A session's year is its own stamp, or - for one written before
// stamping existed - its date.
//
// `denominator=timetable` counts a published-timetable period nobody posted as
// held (audit F-25); the default keeps the original submitted-sessions-only
// numbers, and `compare=true` returns both so they can be checked side by side.
const READ_ROLES = ["EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"];

// Same leniency `matchesCurrentSemester` documents everywhere else - a
// subject never tagged with a semester (course-year has none configured)
// still counts regardless of which semester was requested, rather than
// silently disappearing.
async function sectionSubjectIds(
  collegeRef: FirebaseFirestore.DocumentReference,
  sectionId: string,
  requestedSemester: number | null
): Promise<string[]> {
  const snap = await collegeRef.collection("teachingAssignments").where("sectionId", "==", sectionId).get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const a = doc.data() as TeachingAssignment;
    if (a.isPast) continue;
    if (requestedSemester != null && !matchesCurrentSemester(a.timetableSemester, requestedSemester)) continue;
    ids.add(a.subjectId);
  }
  return Array.from(ids);
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...READ_ROLES);
    // Guard: requireCollegeMember only guarantees a member and a role present
    // in READ_ROLES. If the role list changes, an unknown role would otherwise
    // fall through to the section-scoped scan below - reject closed instead.
    if (!READ_ROLES.includes(session.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    const courseId = searchParams.get("courseId");
    const yearParam = searchParams.get("year");
    const sectionId = searchParams.get("sectionId");
    const semesterParam = searchParams.get("semester");
    const listSections = searchParams.get("listSections") === "true";
    const minPctParam = searchParams.get("minPct");
    const maxPctParam = searchParams.get("maxPct");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const compare = searchParams.get("compare") === "true";

    if (!department || !courseId || !yearParam) {
      return NextResponse.json({ error: "Department, Course and Year are required" }, { status: 400 });
    }
    const year = Number(yearParam);
    if (!Number.isFinite(year)) {
      return NextResponse.json({ error: "Year must be a valid number" }, { status: 400 });
    }
    // Optional - omitted keeps today's behavior (every semester mixed
    // together). Same fail-closed convention as minPct/maxPct below rather
    // than silently no-op-ing on a garbage value.
    const requestedSemester = semesterParam != null && semesterParam !== "" ? Number(semesterParam) : null;
    if (requestedSemester != null && !Number.isFinite(requestedSemester)) {
      return NextResponse.json({ error: "semester must be a valid number" }, { status: 400 });
    }
    // Never let a garbage minPct/maxPct silently no-op the filter (NaN
    // comparisons are always false) - fail closed on a bad param instead.
    if (minPctParam != null && !Number.isFinite(Number(minPctParam))) {
      return NextResponse.json({ error: "minPct must be a valid number" }, { status: 400 });
    }
    if (maxPctParam != null && !Number.isFinite(Number(maxPctParam))) {
      return NextResponse.json({ error: "maxPct must be a valid number" }, { status: 400 });
    }

    if ((fromParam && !DATE_RE.test(fromParam)) || (toParam && !DATE_RE.test(toParam))) {
      return NextResponse.json({ error: "from and to must be valid dates (YYYY-MM-DD)" }, { status: 400 });
    }
    if (fromParam && toParam && fromParam > toParam) {
      return NextResponse.json({ error: "From date must be before the To date" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const yearCfg = await loadAcademicYearConfig(db, session.collegeId);
    const yearRequest = resolveAcademicYearRequest(searchParams.get("academicYear"), yearCfg);
    if (yearRequest.error) return NextResponse.json({ error: yearRequest.error }, { status: 400 });
    const window = yearRequest.window ?? null;
    const currentWindow = windowForAcademicYear(yearCfg.currentLabel, yearCfg);
    const denominator = await resolveDenominatorMode(db, session.collegeId, searchParams.get("denominator"));
    // The date range actually read: the academic year, narrowed by from/to.
    // Absent both (academicYear=all, no from/to) it is the old unbounded read.
    const rangeFrom = [window?.from, fromParam].filter((v): v is string => !!v).sort().pop() ?? null;
    const rangeTo = [window?.to, toParam].filter((v): v is string => !!v).sort()[0] ?? null;

    let sections: Section[];
    if (sectionId) {
      const snap = await collegeRef.collection("sections").doc(sectionId).get();
      if (!snap.exists) return NextResponse.json({ error: "Section not found" }, { status: 404 });
      sections = [{ ...(snap.data() as Section), id: snap.id }];
    } else {
      // Include sub-departments (e.g. "Basic Science" covering its child
      // branches) so a parent-department pick doesn't silently drop their
      // sections from the defaulter report - same expansion already used by
      // GET /api/college/faculty and /api/college/subjects.
      const treeNames = await getDepartmentTreeNames(db, session.collegeId, department);
      const snap = await collegeRef.collection("sections")
        .where("department", "in", treeNames.slice(0, 30))
        .where("courseId", "==", courseId)
        .where("year", "==", year)
        .get();
      sections = snap.docs.map((d) => ({ ...(d.data() as Section), id: d.id }));
    }

    // Just a lookup for the Section picker - department/course/year are
    // already fixed by the time the frontend asks for this.
    if (listSections) {
      return NextResponse.json({
        sections: sections.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    const minPct = minPctParam ? Number(minPctParam) : null;
    const maxPct = maxPctParam ? Number(maxPctParam) : null;

    interface Alt { mode: "SUBMITTED" | "TIMETABLE"; held: number; attended: number; percentage: number | null }
    const results: {
      studentId: string; name: string; rollNumber: string; sectionName: string;
      held: number; attended: number; percentage: number | null;
      notPostedPeriods?: number; alt?: Alt;
    }[] = [];
    let denominatorUnavailable: DenominatorResult["unavailable"];

    for (const section of sections) {
      let sessionsQuery: FirebaseFirestore.Query = collegeRef.collection("studentAttendance")
        .where("sectionId", "==", section.id)
        .where("status", "==", "SUBMITTED");
      if (rangeFrom) sessionsQuery = sessionsQuery.where("date", ">=", rangeFrom);
      if (rangeTo) sessionsQuery = sessionsQuery.where("date", "<=", rangeTo);
      const [subjectIds, sessionsSnap, roster] = await Promise.all([
        sectionSubjectIds(collegeRef, section.id, requestedSemester),
        sessionsQuery.get(),
        fetchSectionStudents(collegeRef, {
          department: section.department, sectionName: section.name,
          year: section.year, courseId: section.courseId,
        }),
      ]);

      // Same leniency as sectionSubjectIds above - a session never tagged
      // with a semester still counts regardless of what was requested.
      const sessions = sessionsSnap.docs
        .map((d) => d.data() as StudentAttendanceSession)
        .filter((r) => requestedSemester == null || matchesCurrentSemester(r.semester, requestedSemester))
        // A stamped session belongs to its own academic year (a session written
        // before stamping existed was placed by its date, in the query above).
        .filter((r) => sessionInAcademicYear(r, window));
      // One shared definition of held/attended (lib/studentAttendance/counting.ts):
      // only sessions that list the student count, so a split lab's other
      // batch is never charged to them as an absence.
      const indexed = indexSessions(sessions);

      // Periods the published timetable says were held but nobody posted
      // (audit F-25). Only built when asked for - the default path reads nothing extra.
      let notPosted: DenominatorResult | null = null;
      if (denominator === "TIMETABLE" || compare) {
        notPosted = await loadNotPostedIndex({
          db, collegeId: session.collegeId, section: { id: section.id, courseId: section.courseId, year: section.year },
          // The published timetable describes the CURRENT cohort, so not-posted
          // periods are only computed inside the current academic year, whatever
          // range this report covers (a past year is reported as unavailable).
          from: rangeFrom ?? currentWindow?.from ?? `${new Date().getFullYear()}-01-01`, to: rangeTo ?? istDateKey(),
          window: window && !window.isCurrent ? window : currentWindow, requestedSemester,
          submittedSessions: sessions.map((r) => ({ assignmentId: r.assignmentId, date: r.date, periodNumber: r.periodNumber })),
        });
        if (notPosted.unavailable) denominatorUnavailable = notPosted.unavailable;
      }

      for (const stu of roster) {
        let held = 0;
        let attended = 0;
        let heldTimetable = 0;
        let notPostedCount = 0;
        const tallies = tallyStudentBySubject(indexed, stu.id);
        const owed = notPosted?.index.forStudent(stu);
        for (const subjectId of subjectIds) {
          const t = tallies.get(subjectId);
          const extra = owed?.get(subjectId) ?? 0;
          notPostedCount += extra;
          heldTimetable += withNotPosted(t, extra).held;
          if (!t) continue;
          held += t.held;
          attended += t.attended;
        }
        // null (not 0) when no periods have been held yet - a student with
        // no data recorded is not the same as a confirmed 0% attendance
        // defaulter (see lib/studentAttendance/percentage.ts's own
        // doc-comment), and must never be silently caught by a "below X%"
        // filter or shown with the same shortage styling as a real 0%.
        const submittedNumbers = { held, attended, percentage: calcPercent(attended, held) };
        const timetableNumbers = { held: heldTimetable, attended, percentage: calcPercent(attended, heldTimetable) };
        const main = denominator === "TIMETABLE" ? timetableNumbers : submittedNumbers;
        const other = denominator === "TIMETABLE" ? submittedNumbers : timetableNumbers;
        results.push({
          studentId: stu.id, name: stu.name, rollNumber: stu.rollNumber,
          sectionName: section.name, ...main,
          ...(notPosted ? { notPostedPeriods: notPostedCount } : {}),
          ...(compare ? { alt: { mode: denominator === "TIMETABLE" ? "SUBMITTED" as const : "TIMETABLE" as const, ...other } } : {}),
        });
      }
    }

    // A percentage-range filter can't meaningfully match a no-data (null)
    // student - exclude them whenever either bound is actually set, rather
    // than falling through the null/undefined comparison (which JS resolves
    // via numeric coercion, e.g. `null < 10` -> true) into the wrong side.
    const filtered = results.filter((r) => {
      if ((minPct != null || maxPct != null) && r.percentage == null) return false;
      if (minPct != null && r.percentage! < minPct) return false;
      if (maxPct != null && r.percentage! > maxPct) return false;
      return true;
    });
    // compareStudentsForList (not a bare rollNumber.localeCompare): a student
    // imported without a roll number must sort last by name, not crash the report.
    const byRoll = (a: (typeof filtered)[number], b: (typeof filtered)[number]) =>
      compareStudentsForList({ id: a.studentId, rollNumber: a.rollNumber, name: a.name }, { id: b.studentId, rollNumber: b.rollNumber, name: b.name });
    filtered.sort((a, b) => {
      if (a.percentage == null && b.percentage == null) return byRoll(a, b);
      if (a.percentage == null) return 1;
      if (b.percentage == null) return -1;
      return a.percentage - b.percentage || byRoll(a, b);
    });

    return NextResponse.json({
      students: filtered,
      totalStudents: results.length,
      matchedCount: filtered.length,
      sectionsCount: sections.length,
      meta: {
        academicYear: window?.label ?? "all",
        from: rangeFrom, to: rangeTo,
        denominator,
        ...(denominatorUnavailable ? { denominatorUnavailable } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance-percentage-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
