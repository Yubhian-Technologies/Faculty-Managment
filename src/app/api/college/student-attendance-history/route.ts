export const dynamic = "force-dynamic";

import { loadEffectiveTiming } from "@/lib/college/semester";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { computeStudentAttendanceHistory, studentDepartmentsForHistory } from "@/lib/studentAttendance/history";
import type { StudentRecord } from "@/types";

function toDateStr(v: unknown): string {
  const d = (v as { toDate?: () => Date })?.toDate ? (v as { toDate: () => Date }).toDate() : new Date(v as string);
  return d.toISOString().slice(0, 10);
}

// Intersects two optional inclusive bounds (e.g. a Semester tab's own
// start/end alongside an explicit from/to param) into the single tighter
// bound computeStudentAttendanceHistory's `range` takes - date strings
// ("YYYY-MM-DD") compare lexicographically the same as chronologically.
function laterDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
function earlierDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

// Cumulative per-subject Held/Attend/% for ONE student, across a
// caller-chosen range - Monthly (year+month), Period (from+to), or Till now
// (no range params at all). Unlike section-attendance-report's summary=true
// branch (one month, every student in a section, subjects narrowed to that
// section's CURRENT teaching-assignment roster), this scans every SUBMITTED
// session and keeps whichever ones actually list this student in `entries` -
// so a subject taken in an earlier semester/section still shows up under
// "Till now", and a mid-year section transfer doesn't silently drop history.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get("studentId");
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    }

    // Monthly: year (+ optional month). Period: from/to ("YYYY-MM-DD").
    // Till now: none of these - every match, unbounded.
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const semesterParam = searchParams.get("semester");
    // Metadata-only call - just this student's configured semester numbers,
    // for the range picker's Semester tab. Skips the (potentially large)
    // attendance-session scan below entirely.
    const optionsOnly = searchParams.get("optionsOnly") === "true";
    // A reversed range wouldn't error out below - the date filter would
    // just never match anything, silently returning an empty (not wrong,
    // but confusing) report instead of the mistake it actually is. Caught
    // here as a backstop even though the picker page itself already
    // validates this, since this route is reachable directly by URL too.
    if (fromParam && toParam && fromParam > toParam) {
      return NextResponse.json({ error: "From date must be before the To date" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").doc(studentId).get();
    if (!studentSnap.exists) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const student = { id: studentSnap.id, ...studentSnap.data() } as StudentRecord;

    // HOD stays scoped to their own department tree, matching
    // section-attendance-report's convention. PRINCIPAL/VICE_PRINCIPAL have
    // no restriction.
    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, student.department)) {
        return NextResponse.json({ error: "This student isn't in your department" }, { status: 403 });
      }
    }

    // This student's configured semester numbers (from their course-year's
    // CourseYearTiming), plus - when a specific one was requested - the
    // date range to filter attendance sessions by. A course-year with no
    // semesters configured has none to offer; the Semester tab stays hidden
    // client-side in that case.
    let semesterOptions: number[] = [];
    let semesterFrom: string | null = null;
    let semesterTo: string | null = null;
    if (student.courseId) {
      const timing = await loadEffectiveTiming(db, session.collegeId, student.courseId, student.year);
      semesterOptions = (timing?.semesters ?? []).map((s) => s.semester).sort((a, b) => a - b);
      if (semesterParam) {
        const match = timing?.semesters?.find((s) => s.semester === Number(semesterParam));
        if (!match) {
          return NextResponse.json({ error: "That semester isn't configured for this student's course-year" }, { status: 400 });
        }
        semesterFrom = toDateStr(match.startDate);
        semesterTo = toDateStr(match.endDate);
      }
    }

    if (optionsOnly) {
      return NextResponse.json({ availableSemesters: semesterOptions });
    }

    // Scoped by department (an indexed scalar field every session doc
    // carries) as a practical narrowing - every department the student has
    // been in (current, shared-first-year branch, departmentHistory), so a
    // promoted student's earlier years are still found. Every candidate is
    // still individually confirmed by an actual matching `entries` row, never
    // assumed from the department match alone. (See computeStudentAttendanceHistory.)
    const departments = await studentDepartmentsForHistory(db, session.collegeId, student);
    const { subjects, total } = await computeStudentAttendanceHistory(
      db,
      session.collegeId,
      studentId,
      departments,
      {
        from: laterDate(semesterFrom, fromParam),
        to: earlierDate(semesterTo, toParam),
        year: yearParam,
        month: monthParam,
      }
    );

    return NextResponse.json({
      student: {
        rollNumber: student.rollNumber,
        name: student.name,
        department: student.department,
        course: student.course ?? null,
        year: student.year,
        section: student.section,
      },
      subjects,
      total,
      availableSemesters: semesterOptions,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance-history GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
