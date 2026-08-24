export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import type { CourseYearTiming, StudentAttendanceSession, StudentRecord } from "@/types";

function toDateStr(v: unknown): string {
  const d = (v as { toDate?: () => Date })?.toDate ? (v as { toDate: () => Date }).toDate() : new Date(v as string);
  return d.toISOString().slice(0, 10);
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
      const timingSnap = await collegeRef
        .collection("courseYearTimings")
        .doc(`${student.courseId}_year${student.year}`)
        .get();
      const timing = timingSnap.exists ? (timingSnap.data() as CourseYearTiming) : null;
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
    // carries) as a practical narrowing - correct for the overwhelming
    // majority of students, who never change department. A rare
    // cross-department transfer's PRE-transfer history wouldn't be
    // included; every candidate is still individually confirmed by an
    // actual matching `entries` row below, never assumed from the
    // department match alone.
    const sessionsSnap = await collegeRef.collection("studentAttendance")
      .where("department", "==", student.department)
      .where("status", "==", "SUBMITTED")
      .get();

    const monthStr = monthParam ? String(Number(monthParam)).padStart(2, "0") : null;

    const inRange = sessionsSnap.docs
      .map((d) => d.data() as StudentAttendanceSession)
      .filter((r) => {
        if (semesterFrom && r.date < semesterFrom) return false;
        if (semesterTo && r.date > semesterTo) return false;
        if (yearParam && r.date.slice(0, 4) !== yearParam) return false;
        if (monthStr && r.date.slice(5, 7) !== monthStr) return false;
        if (fromParam && r.date < fromParam) return false;
        if (toParam && r.date > toParam) return false;
        return true;
      })
      .filter((r) => r.entries.some((e) => e.studentId === studentId));

    // One session per subject per date - a faculty double-submitting the
    // same class shouldn't double-count it (mirrors section-attendance-
    // report's own dedupe).
    const seen = new Set<string>();
    const bySubject = new Map<string, { subjectName: string; subjectCode: string; held: number; attend: number }>();
    for (const r of inRange) {
      const key = `${r.subjectId}|${r.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = r.entries.find((e) => e.studentId === studentId)!;
      const cur = bySubject.get(r.subjectId) ?? { subjectName: r.subjectName, subjectCode: r.subjectCode, held: 0, attend: 0 };
      cur.held += 1;
      if (entry.status === "PRESENT") cur.attend += 1;
      bySubject.set(r.subjectId, cur);
    }

    const subjects = Array.from(bySubject.entries())
      .map(([subjectId, v]) => ({
        subjectId, subjectName: v.subjectName, subjectCode: v.subjectCode,
        held: v.held, attend: v.attend,
        percent: v.held > 0 ? Math.round((v.attend / v.held) * 10000) / 100 : 0,
      }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const totalHeld = subjects.reduce((a, s) => a + s.held, 0);
    const totalAttend = subjects.reduce((a, s) => a + s.attend, 0);

    return NextResponse.json({
      student: {
        rollNumber: student.rollNumber,
        name: student.name,
        department: student.department,
        course: student.course ?? null,
        year: student.year,
        section: student.section,
        semester: student.semester ?? null,
      },
      subjects,
      total: {
        held: totalHeld,
        attend: totalAttend,
        percent: totalHeld > 0 ? Math.round((totalAttend / totalHeld) * 10000) / 100 : 0,
      },
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
