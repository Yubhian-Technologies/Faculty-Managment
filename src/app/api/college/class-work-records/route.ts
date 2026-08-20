export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { DAY_BY_JS_DAY } from "@/lib/timetable/currentPeriod";
import { loadDepartmentCodes, formatSectionLabel } from "@/lib/attendance/sectionLabel";
import type { StudentAttendanceMark, StudentAttendanceSession, TimetableSlot } from "@/types";

// Drill-down reader over the "Record of the Class Work" already saved on
// each SUBMITTED student-attendance session (see student-attendance/route.ts) -
// deliberately not a separate class-work collection, per CLAUDE.md's Faculty
// Dashboard <-> HOD Timetable connect pattern of reusing existing data.
// DRAFT sessions are excluded: classNotes on those may be empty/unfinished
// (submission is what enforces it being filled in - see
// student-attendance/[id]/route.ts PATCH).
//
// Faculty (PANEL_MEMBER) always see their own records - any `facultyId` they
// pass is ignored. HOD must pass `facultyId` (the target's login uid, same
// value student-attendance sessions key `facultyId` off) and may only look at
// faculty in their own department (not sub-departments/managed branches -
// deliberately narrower than canHodEditDepartment, matching GET
// /api/college/faculty?scope=own, the same "own department" faculty list this
// feature's Faculty-tile step reuses).
//
// Drill levels, selected by which query params are present:
//   (none)                                -> { years:  number[] }
//   ?year=YYYY                            -> { months: number[] }
//   ?year=Y&month=M                       -> { records: DailyRecord[] }        (HOD Monthly Records - unchanged)
//   ?year=Y&month=M&sectionId=S           -> { days: number[] }                (Faculty Attendance Report calendar)
//   ?year=Y&month=M&sectionId=S&date=YYYY-MM-DD -> { classWork, periods, students } (Faculty Attendance Report day view)
// `sectionId` (a real Section doc id) also scopes the years/months levels to
// just that section - see /api/college/class-work-records/sections for the
// Faculty's own section tiles this is driven from.

interface DailyRecord {
  section: string;
  date: string;
  periodNumber: number | null;
  classNotes: string;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD");
    const { searchParams } = new URL(request.url);
    const requestedFacultyId = searchParams.get("facultyId");
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const sectionIdParam = searchParams.get("sectionId");
    const dateParam = searchParams.get("date");

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    let facultyId: string;
    if (session.role === "HOD") {
      if (!requestedFacultyId) {
        return NextResponse.json({ error: "facultyId is required" }, { status: 400 });
      }
      const facSnap = await collegeRef.collection("facultyMembers")
        .where("userUid", "==", requestedFacultyId).limit(1).get();
      if (facSnap.empty) {
        return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
      }
      const facultyDept = (facSnap.docs[0].data() as { department?: string }).department ?? "";
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!scope.departmentName || facultyDept !== scope.departmentName) {
        return NextResponse.json({ error: "That faculty is not in your department" }, { status: 403 });
      }
      facultyId = requestedFacultyId;
    } else {
      facultyId = session.uid;
    }

    const recordsSnap = await collegeRef.collection("studentAttendance")
      .where("facultyId", "==", facultyId)
      .where("status", "==", "SUBMITTED")
      .get();
    const all = recordsSnap.docs.map((d) => d.data() as StudentAttendanceSession);
    const filtered = sectionIdParam ? all.filter((r) => r.sectionId === sectionIdParam) : all;

    if (!yearParam) {
      const years = Array.from(new Set(filtered.map((r) => Number(r.date.slice(0, 4))))).sort((a, b) => b - a);
      return NextResponse.json({ years });
    }

    const year = Number(yearParam);
    const inYear = filtered.filter((r) => Number(r.date.slice(0, 4)) === year);

    if (!monthParam) {
      const months = Array.from(new Set(inYear.map((r) => Number(r.date.slice(5, 7))))).sort((a, b) => a - b);
      return NextResponse.json({ months });
    }

    const monthStr = String(Number(monthParam)).padStart(2, "0");
    const inMonth = inYear.filter((r) => r.date.slice(5, 7) === monthStr);

    // Attendance Report calendar step: which days of this month have a
    // record for this section, before committing to one specific date.
    if (sectionIdParam && !dateParam) {
      const days = Array.from(new Set(inMonth.map((r) => Number(r.date.slice(8, 10))))).sort((a, b) => a - b);
      return NextResponse.json({ days });
    }

    // Everything below needs each record's real period number - the stored
    // field, falling back to the PUBLISHED timetable (this faculty's own
    // assignment, on the record date's weekday) for sessions saved before
    // StudentAttendanceSession.periodNumber existed.
    const needsPeriodLookup = inMonth.some((r) => r.periodNumber == null);
    const periodByAssignmentDay = new Map<string, number>();
    if (needsPeriodLookup) {
      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, facultyId);
      const slotsSnap = await collegeRef.collection("timetableSlots")
        .where("facultyId", "==", facultyMemberId)
        .get();
      for (const d of slotsSnap.docs) {
        const s = d.data() as TimetableSlot;
        const key = `${s.assignmentId}:${s.day}`;
        const existing = periodByAssignmentDay.get(key);
        if (existing == null || s.periodNumber < existing) {
          periodByAssignmentDay.set(key, s.periodNumber);
        }
      }
    }
    function resolvePeriodNumber(r: StudentAttendanceSession): number | null {
      if (r.periodNumber != null) return r.periodNumber;
      const [y, m, d] = r.date.split("-").map(Number);
      const day = DAY_BY_JS_DAY[new Date(y, m - 1, d).getDay()];
      if (!day) return null;
      return periodByAssignmentDay.get(`${r.assignmentId}:${day}`) ?? null;
    }

    // Attendance Report day view: Class Work + a Regd No/Name x Period pivot,
    // covering only the period(s) this faculty actually taught this section
    // on this exact date (distinct assignments that day - e.g. two different
    // subjects - surface as separate period columns; a lab block spanning
    // several periods still collapses to the one period its session was
    // created under).
    if (sectionIdParam && dateParam) {
      const dayRecords = inMonth.filter((r) => r.date === dateParam);

      const byPeriod = new Map<number, StudentAttendanceSession>();
      for (const r of dayRecords) {
        const p = resolvePeriodNumber(r);
        if (p != null && !byPeriod.has(p)) byPeriod.set(p, r);
      }
      const periods = Array.from(byPeriod.keys()).sort((a, b) => a - b);

      const classWork = periods.map((p) => {
        const r = byPeriod.get(p)!;
        return { periodNumber: p, subjectName: r.subjectName, classNotes: r.classNotes ?? "" };
      });

      const studentMap = new Map<string, {
        studentId: string;
        rollNumber: string;
        name: string;
        statusByPeriod: Record<number, StudentAttendanceMark | null>;
      }>();
      for (const p of periods) {
        const r = byPeriod.get(p)!;
        for (const e of r.entries) {
          let row = studentMap.get(e.studentId);
          if (!row) {
            row = { studentId: e.studentId, rollNumber: e.rollNumber, name: e.name, statusByPeriod: {} };
            studentMap.set(e.studentId, row);
          }
          row.statusByPeriod[p] = e.status;
        }
      }
      const students = [...studentMap.values()]
        .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

      // Subject-wise attendance percentage - one group per distinct
      // assignmentId among today's periods (== one per subject, since a
      // section+subject+faculty combo is exactly one assignmentId). Computed
      // from this faculty's FULL submission history for that assignment
      // (`all`, loaded above before any year/month/date filtering was
      // applied), not just this date/month - "classes conducted" for a
      // subject is every SUBMITTED session doc for its assignmentId (doc id
      // `${assignmentId}_${date}_${periodNumber}`, one per class PERIOD - two
      // consecutive periods of the same assignment on one day are two
      // separate classes, each independently attended/absent), matching what
      // the Faculty actually taught, never a hard-coded period count.
      const assignmentIds = Array.from(new Set(periods.map((p) => byPeriod.get(p)!.assignmentId)));
      const subjects = assignmentIds.map((assignmentId) => {
        const sessionsForAssignment = all.filter(
          (r) => r.assignmentId === assignmentId && r.sectionId === sectionIdParam
        );
        const samplePeriod = periods.find((p) => byPeriod.get(p)!.assignmentId === assignmentId)!;
        const sample = byPeriod.get(samplePeriod)!;
        const subjectPeriods = periods.filter((p) => byPeriod.get(p)!.assignmentId === assignmentId);

        const totalClasses = sessionsForAssignment.length;
        const totalPresentMarks = sessionsForAssignment.reduce((sum, s) => sum + s.presentCount, 0);
        const totalPossibleMarks = sessionsForAssignment.reduce((sum, s) => sum + s.totalStudents, 0);
        const overallPercentage = totalPossibleMarks > 0 ? Math.round((totalPresentMarks / totalPossibleMarks) * 100) : 0;

        const presentByStudent = new Map<string, number>();
        for (const s of sessionsForAssignment) {
          for (const e of s.entries) {
            if (e.status === "PRESENT") presentByStudent.set(e.studentId, (presentByStudent.get(e.studentId) ?? 0) + 1);
          }
        }
        const percentageByStudent: Record<string, number> = {};
        for (const row of students) {
          percentageByStudent[row.studentId] =
            totalClasses > 0 ? Math.round(((presentByStudent.get(row.studentId) ?? 0) / totalClasses) * 100) : 0;
        }

        return {
          subjectId: sample.subjectId,
          subjectName: sample.subjectName,
          periods: subjectPeriods,
          totalClasses,
          overallPercentage,
          percentageByStudent,
        };
      });

      return NextResponse.json({ classWork, periods, students, subjects });
    }

    // HOD's Monthly Records daily view - unchanged.
    const codeByName = await loadDepartmentCodes(collegeRef, inMonth.map((r) => r.department));
    const records: DailyRecord[] = inMonth
      .map((r) => ({
        section: formatSectionLabel(r.department, r.sectionName, codeByName),
        date: r.date,
        periodNumber: resolvePeriodNumber(r),
        classNotes: r.classNotes ?? "",
      }))
      .sort((a, b) => (a.date === b.date ? (a.periodNumber ?? 0) - (b.periodNumber ?? 0) : a.date.localeCompare(b.date)));

    return NextResponse.json({ records });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/class-work-records GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
