export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, StudentAttendanceMark, StudentAttendanceSession, TeachingAssignment } from "@/types";

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
//   sectionId only                  -> { years: number[] }
//   sectionId + year                -> { months: number[] }
//   sectionId + year + month        -> { dates: string[] }, newest first
//   sectionId + year + month + date -> { subjects, students, classwork }
//
// `subjects` is the section's CURRENT teaching-assignment roster (every
// subject an HOD has actually assigned to it, any faculty) - stable across
// dates, not filtered to "had a class that day", so the column set doesn't
// shift date to date. `classwork`/per-subject status only appear for
// subjects that actually had a submitted session on the selected date.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const sectionId = searchParams.get("sectionId");
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const dateParam = searchParams.get("date");

    if (!sectionId) {
      return NextResponse.json({ error: "sectionId is required" }, { status: 400 });
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

    const sessionsSnap = await collegeRef.collection("studentAttendance")
      .where("sectionId", "==", sectionId)
      .where("status", "==", "SUBMITTED")
      .get();
    const allSessions = sessionsSnap.docs.map((d) => d.data() as StudentAttendanceSession);

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

    if (!dateParam) {
      const dates = Array.from(new Set(inMonth.map((r) => r.date))).sort((a, b) => b.localeCompare(a));
      return NextResponse.json({ dates });
    }

    // Every subject currently assigned to this section, any faculty - the
    // report's stable column set.
    const assignmentsSnap = await collegeRef.collection("teachingAssignments")
      .where("sectionId", "==", sectionId)
      .get();
    const bySubject = new Map<string, TeachingAssignment>();
    for (const doc of assignmentsSnap.docs) {
      const a = doc.data() as TeachingAssignment;
      if (a.isPast) continue;
      if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
    }
    const subjects = Array.from(bySubject.values())
      .map((a) => ({ subjectId: a.subjectId, subjectName: a.subjectName, subjectCode: a.subjectCode }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const dayRecords = inMonth.filter((r) => r.date === dateParam);
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

    const roster = await fetchSectionStudents(collegeRef, {
      department: section.department,
      sectionName: section.name,
      year: section.year,
      courseId: section.courseId,
    });

    const students = roster
      .map((stu) => {
        const statusBySubject: Record<string, StudentAttendanceMark | null> = {};
        for (const s of subjects) {
          const r = sessionBySubject.get(s.subjectId);
          const entry = r?.entries.find((e) => e.studentId === stu.id);
          statusBySubject[s.subjectId] = entry?.status ?? null;
        }
        return { rollNumber: stu.rollNumber, name: stu.name, statusBySubject };
      })
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    return NextResponse.json({ subjects, students, classwork });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/section-attendance-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
