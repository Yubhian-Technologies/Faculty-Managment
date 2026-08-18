export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { Section, StudentAttendanceEntry, StudentAttendanceSession, StudentRecord, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const body = (await request.json()) as { assignmentId?: string; date?: string };
    const assignmentId = body.assignmentId?.trim();
    const date = body.date?.trim();

    if (!assignmentId || !date || !DATE_RE.test(date)) {
      return NextResponse.json({ error: "assignmentId and a valid date (YYYY-MM-DD) are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    // Only load a subject this faculty member is currently (not historically)
    // assigned to teach — prevents loading an arbitrary assignment's roster.
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    }
    const assignment = assignmentSnap.data() as TeachingAssignment;
    // teachingAssignments.facultyId is the facultyMembers doc id, not the
    // login uid (see resolveFacultyMemberId) — resolve before comparing.
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if (assignment.facultyId !== facultyMemberId || assignment.isPast) {
      return NextResponse.json({ error: "You are not assigned to teach this subject" }, { status: 403 });
    }

    // Two independent teachingAssignments shapes (see TeachingAssignment):
    // course/section-scoped ones link to a real Section doc; semester-scoped
    // ones (HOD's "Teaching Assignments" page) only carry a free-text section
    // name, with no Section doc and no course "year" to resolve.
    let sectionId: string | undefined;
    let sectionName: string;
    let year: number | undefined;

    if (assignment.sectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(assignment.sectionId).get();
      if (!sectionSnap.exists) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      const section = sectionSnap.data() as Section;
      sectionId = assignment.sectionId;
      sectionName = section.name;
      year = section.year;
    } else {
      sectionName = assignment.section?.trim() || "Section";
    }

    // One session per (assignment, date) — a subject can be attended multiple
    // times across the term, unlike the one-batch-per-assignment exam marks shape.
    const id = `${assignmentId}_${date}`;
    const ref = collegeRef.collection("studentAttendance").doc(id);
    const now = new Date();

    const existingSnap = await ref.get();

    // Current roster, ordered for a stable S.No. column. Section-scoped
    // assignments resolve to a real section (department+section+year); the
    // semester-scoped shape has no course "year" to filter by, so it matches
    // on department+section name alone (best-effort until this college's data
    // has been migrated to real sections). A shared-first-year student in
    // this section stays filed under their common department (preserved
    // until promotion) with secondaryDepartment naming this section's real
    // branch instead - matched separately and merged, or the roster (and
    // therefore attendance for the whole class) would come up empty.
    let primaryQuery = collegeRef.collection("students")
      .where("department", "==", assignment.department)
      .where("section", "==", sectionName);
    let secondaryQuery = collegeRef.collection("students")
      .where("secondaryDepartment", "==", assignment.department)
      .where("section", "==", sectionName);
    if (year != null) {
      primaryQuery = primaryQuery.where("year", "==", year);
      secondaryQuery = secondaryQuery.where("year", "==", year);
    }

    const [primarySnap, secondarySnap] = await Promise.all([primaryQuery.get(), secondaryQuery.get()]);
    const seenStudentIds = new Set<string>();
    const students: StudentRecord[] = [];
    for (const d of [...primarySnap.docs, ...secondarySnap.docs]) {
      if (seenStudentIds.has(d.id)) continue;
      seenStudentIds.add(d.id);
      students.push({ id: d.id, ...d.data() } as StudentRecord);
    }
    students.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    if (!existingSnap.exists) {
      const entries: StudentAttendanceEntry[] = students.map((s) => ({
        studentId: s.id,
        rollNumber: s.rollNumber,
        name: s.name,
        status: null,
      }));

      const attendanceSession = {
        collegeId: session.collegeId,
        department: assignment.department,
        assignmentId,
        ...(sectionId ? { sectionId } : {}),
        sectionName,
        ...(year != null ? { year } : {}),
        subjectId: assignment.subjectId,
        subjectName: assignment.subjectName,
        subjectCode: assignment.subjectCode,
        facultyId: session.uid,
        facultyName: assignment.facultyName ?? "",
        date,
        status: "DRAFT" as const,
        entries,
        totalStudents: entries.length,
        presentCount: 0,
        classNotes: "",
        submittedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(attendanceSession);
      return NextResponse.json({ session: { id, ...attendanceSession } }, { status: 201 });
    }

    const existing = existingSnap.data() as StudentAttendanceSession;

    // Roster may have changed since the session was created (student added/moved
    // section) — reconcile while still a draft, preserving marks already
    // entered for students who are still in the section. Once submitted, the
    // session is a locked record and is returned exactly as-is.
    if (existing.status === "DRAFT") {
      const existingByStudent = new Map(existing.entries.map((e) => [e.studentId, e]));
      const entries: StudentAttendanceEntry[] = students.map((s) => ({
        studentId: s.id,
        rollNumber: s.rollNumber,
        name: s.name,
        status: existingByStudent.get(s.id)?.status ?? null,
      }));
      const presentCount = entries.filter((e) => e.status === "PRESENT").length;

      await ref.update({
        entries,
        totalStudents: entries.length,
        presentCount,
        updatedAt: now,
      });

      return NextResponse.json({
        session: { ...existing, id, entries, totalStudents: entries.length, presentCount },
      });
    }

    return NextResponse.json({ session: { ...existing, id } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
