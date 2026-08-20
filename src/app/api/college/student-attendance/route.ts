export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { checkFacultyPeriodWindow, periodWindowMessage } from "@/lib/timetable/currentPeriod";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import type { Section, StudentAttendanceEntry, StudentAttendanceSession, TeachingAssignment } from "@/types";

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
    // name, with no Section doc and no course "year" to resolve. Department,
    // section name and year are read from the SECTION DOC itself whenever one
    // exists - the canonical record - rather than the assignment's own
    // (denormalized, can drift after a section is edited) copies, so this
    // roster query can never disagree with the Faculty Attendance Report's
    // section-tile count, which resolves the same way (see
    // lib/students/sectionRoster.ts).
    let sectionId: string | undefined;
    let department: string;
    let sectionName: string;
    let year: number | undefined;
    let courseId: string | undefined;

    if (assignment.sectionId) {
      const sectionSnap = await collegeRef.collection("sections").doc(assignment.sectionId).get();
      if (!sectionSnap.exists) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }
      const section = sectionSnap.data() as Section;
      sectionId = assignment.sectionId;
      department = section.department;
      sectionName = section.name;
      year = section.year;
      courseId = section.courseId;
    } else {
      department = assignment.department;
      sectionName = assignment.section?.trim() || "Section";
    }

    const now = new Date();

    // Resolved BEFORE the session doc id is built (not after) because the id
    // itself is keyed by period number - see below. Also gates everything
    // past this point (creating a session, or reconciling a DRAFT's roster)
    // on the PUBLISHED timetable actually having this faculty member
    // teaching this exact assignment right now, same as before. Mirrors the
    // check the PATCH route re-runs before actually saving marks, so a
    // request can't be replayed/crafted for a period that hasn't started yet
    // or has already ended.
    const windowCheck = await checkFacultyPeriodWindow(db, session.collegeId, facultyMemberId, assignmentId, date, now);
    if (!windowCheck.ok) {
      return NextResponse.json({ error: periodWindowMessage(windowCheck) }, { status: 403 });
    }
    const periodNumber = windowCheck.slot.periodNumber;

    // One session per (assignment, date, period) — NOT just (assignment,
    // date). The same faculty/section/subject can occupy consecutive
    // TimetableSlot periods on the same day (e.g. Period 1 then Period 2 of
    // the same assignment); each must be its own independent attendance
    // record, never carried forward or shared, so the period number
    // resolved above (the published timetable's own identifier for "which
    // class session this is") is part of the id itself. A doc saved before
    // this field existed sits at the old `${assignmentId}_${date}` id, which
    // is simply never looked up again - orphaned, not migrated, same as
    // this codebase's other doc-id scheme changes.
    const id = `${assignmentId}_${date}_${periodNumber}`;
    const ref = collegeRef.collection("studentAttendance").doc(id);

    const existingSnap = await ref.get();

    // A submitted session is a locked historical record - safe to just read
    // back (e.g. faculty re-polling mid-period after already submitting)
    // without redoing the roster fetch below.
    if (existingSnap.exists) {
      const existing = existingSnap.data() as StudentAttendanceSession;
      if (existing.status === "SUBMITTED") {
        return NextResponse.json({ session: { ...existing, id } });
      }
    }

    // Current roster, ordered for a stable S.No. column. Section-scoped
    // assignments resolve to a real section (department+section+year); the
    // semester-scoped shape has no course "year" to filter by, so it matches
    // on department+section name alone (best-effort until this college's data
    // has been migrated to real sections). A shared-first-year student in
    // this section stays filed under their common department (preserved
    // until promotion) with secondaryDepartment naming this section's real
    // branch instead - fetchSectionStudents matches both and merges them, or
    // the roster (and therefore attendance for the whole class) would come
    // up empty. Also scoped by `courseId` when this is a section-scoped
    // assignment (a department can run a same-named section under more than
    // one course - see StudentRecord.courseId's doc-comment - without this,
    // attendance could be taken against the wrong course's roster entirely).
    const students = (await fetchSectionStudents(collegeRef, { department, sectionName, year, courseId }))
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    if (!existingSnap.exists) {
      const entries: StudentAttendanceEntry[] = students.map((s) => ({
        studentId: s.id,
        rollNumber: s.rollNumber,
        name: s.name,
        status: null,
      }));

      const attendanceSession = {
        collegeId: session.collegeId,
        department,
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
        periodNumber: windowCheck.slot.periodNumber,
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

    // Only a DRAFT session reaches here (SUBMITTED already returned above).
    // Roster may have changed since it was created (student added/moved
    // section) — reconcile while still a draft, preserving marks already
    // entered for students who are still in the section.
    const existing = existingSnap.data() as StudentAttendanceSession;
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
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
