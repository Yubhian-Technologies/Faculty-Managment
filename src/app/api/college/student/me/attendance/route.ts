export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { loadEffectiveTiming } from "@/lib/college/semester";
import { formatShortCourseName } from "@/lib/academic/format";
import { istDateKey } from "@/lib/attendance/istTime";
import { computeStudentAttendanceHistory, studentDepartmentsForHistory } from "@/lib/studentAttendance/history";
import { calcPercent } from "@/lib/studentAttendance/percentage";
import {
  batchStartYear,
  classLabel,
  currentSemesterOf,
  isReportView,
  resolveReportRange,
  semesterOptionsForStudent,
  type SemesterRange,
  type YearTiming,
} from "@/lib/studentAttendance/studentReportRange";
import type { Course, CourseYearTiming, StudentRecord } from "@/types";

const UNLINKED_MESSAGE =
  "Your login is not linked to a student record yet. Please contact your College Office.";

// Course-year timing dates are stored as UTC-midnight Timestamps (the timing
// route does `new Date("YYYY-MM-DD")`), so the UTC date is the configured one.
function toDateStr(v: unknown): string {
  const d = (v as { toDate?: () => Date })?.toDate ? (v as { toDate: () => Date }).toDate() : new Date(v as string);
  return d.toISOString().slice(0, 10);
}

// The student's own, range-aware attendance report - Month / Period / Semester /
// Till now - per subject (held, attended, %). Always resolved from session.uid;
// a student can never ask for someone else's. `optionsOnly=true` returns just
// what the pickers need (reachable semesters, month-picker year bounds) without
// scanning any attendance sessions.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("STUDENT");
    const { searchParams } = new URL(request.url);
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const studentSnap = await collegeRef.collection("students").where("uid", "==", session.uid).limit(1).get();
    if (studentSnap.empty) {
      return NextResponse.json({ error: UNLINKED_MESSAGE }, { status: 404 });
    }
    const studentDoc = studentSnap.docs[0];
    const student = { ...(studentDoc.data() as StudentRecord), id: studentDoc.id };

    // Semesters this student has actually reached: every configured semester of
    // years 1..current whose start date has passed (see semesterOptionsForStudent).
    let semesters: SemesterRange[] = [];
    if (student.courseId && student.year >= 1) {
      const courseId = student.courseId;
      const timings = await Promise.all(
        Array.from({ length: student.year }, (_, i) => i + 1).map(async (year): Promise<YearTiming | null> => {
          const timing: CourseYearTiming | null = await loadEffectiveTiming(db, session.collegeId, courseId, year);
          if (!timing?.semesters?.length) return null;
          return {
            year,
            semesters: timing.semesters.map((s) => ({
              semester: s.semester,
              startDate: toDateStr(s.startDate),
              endDate: toDateStr(s.endDate),
            })),
          };
        })
      );
      semesters = semesterOptionsForStudent(
        timings.filter((t): t is YearTiming => t !== null),
        student.year,
        istDateKey(new Date())
      );
    }

    if (searchParams.get("optionsOnly") === "true") {
      return NextResponse.json({ semesters, batchStartYear: batchStartYear(student.batch) });
    }

    const view = searchParams.get("view");
    if (!isReportView(view)) {
      return NextResponse.json({ error: "view must be month, period, semester or tillnow" }, { status: 400 });
    }
    const range = resolveReportRange(
      view,
      {
        year: searchParams.get("year"),
        month: searchParams.get("month"),
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        semester: searchParams.get("semester"),
      },
      semesters
    );
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }

    const departments = await studentDepartmentsForHistory(db, session.collegeId, student);
    const { subjects } = await computeStudentAttendanceHistory(db, session.collegeId, student.id, departments, {
      from: range.from,
      to: range.to,
    });

    // Short codes only on the report: the subject's short code, the course's
    // short name ("B.Tech"), the branch's department code ("CSE"). A shared-
    // first-year student's real branch is their secondaryDepartment.
    const branchName = student.secondaryDepartment || student.department;
    const [courseSnap, deptSnap, collegeSnap] = await Promise.all([
      student.courseId ? collegeRef.collection("courses").doc(student.courseId).get() : Promise.resolve(null),
      collegeRef.collection("departments").where("name", "==", branchName).limit(1).get(),
      collegeRef.get(),
    ]);
    const course = courseSnap?.exists ? (courseSnap.data() as Course) : null;
    const branchCode = (deptSnap.docs[0]?.data() as { code?: string } | undefined)?.code?.trim() || branchName;
    const college = collegeSnap.data() as { name?: string; logoUrl?: string; address?: string; contactPhone?: string } | undefined;

    const rows = subjects
      .map((s) => ({
        subjectId: s.subjectId,
        code: s.shortCode || s.subjectCode,
        held: s.held,
        attended: s.attend,
        percent: calcPercent(s.attend, s.held),
      }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const held = rows.reduce((n, r) => n + r.held, 0);
    const attended = rows.reduce((n, r) => n + r.attended, 0);

    // The "III/IV Semester-I" line: the semester asked for, else today's.
    const shownSemester =
      view === "semester"
        ? semesters.find((s) => s.semester === Number(searchParams.get("semester"))) ?? null
        : currentSemesterOf(semesters, istDateKey(new Date()));

    return NextResponse.json({
      college: {
        name: college?.name ?? "",
        address: college?.address ?? "",
        phone: college?.contactPhone ?? "",
        logoUrl: college?.logoUrl ?? "",
      },
      scope: { view, label: range.label, from: range.from, to: range.to },
      student: {
        rollNumber: student.rollNumber,
        name: student.name,
        course: formatShortCourseName(course?.name ?? student.course, course?.code),
        branch: branchCode,
        classLabel: classLabel(student.year, course?.durationYears, shownSemester),
      },
      subjects: rows,
      total: { held, attended, percent: calcPercent(attended, held) },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student/me/attendance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
