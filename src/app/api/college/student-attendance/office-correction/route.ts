export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { istDateFromParts, istMidnightUTC } from "@/lib/attendance/istTime";
import { fetchSectionStudents } from "@/lib/students/sectionRoster";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { FacultyMember, Section, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Department Office correction flow: a faculty member only gets a live
// window to post student attendance themselves (see checkFacultyPeriodWindow
// in POST /api/college/student-attendance) - if that window closes with
// nothing submitted, this is the ONLY other way it can ever be recorded (the
// live route never accepts a non-today date, and there is no other writer of
// this collection - see student-attendance/[id]/route.ts). HOD acts here
// directly; DEPARTMENT_OFFICE reaches the same authorization because it's
// normalized to role "HOD" in the session (see UserRole's own doc-comment in
// src/types/core.ts) - no separate role branch needed. PRINCIPAL/VICE_PRINCIPAL
// get every department, same convention as faculty-attendance-completion.
// Reuses this collection's existing two-step shape (POST loads/creates a
// DRAFT + roster, PATCH at .../office-correction/[id] edits and submits) -
// matching the faculty-facing student-attendance route this mirrors.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as {
      facultyId?: string;
      assignmentId?: string;
      date?: string;
      periodNumber?: number;
      reason?: string;
    };
    const facultyId = body.facultyId?.trim();
    const assignmentId = body.assignmentId?.trim();
    const date = body.date?.trim();
    const periodNumber = body.periodNumber;
    const reason = body.reason?.trim();

    if (!facultyId || !assignmentId || !date || !DATE_RE.test(date) || periodNumber == null) {
      return NextResponse.json(
        { error: "facultyId, assignmentId, a valid date (YYYY-MM-DD) and periodNumber are required" },
        { status: 400 }
      );
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required to post attendance on a faculty member's behalf" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
    if (!facultySnap.exists) {
      return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
    }
    const faculty = facultySnap.data() as FacultyMember;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodManageFacultyDepartment(scope, faculty.department)) {
        return NextResponse.json({ error: "That faculty is not in your department" }, { status: 403 });
      }
    }

    const [y, m, d] = date.split("-").map(Number);
    const docDate = istDateFromParts(y, m, d);
    if (docDate > istMidnightUTC(new Date())) {
      return NextResponse.json({ error: "Cannot post attendance for a future date" }, { status: 400 });
    }
    if (!isManualEditWindowOpen(docDate)) {
      return NextResponse.json({ error: MANUAL_EDIT_WINDOW_CLOSED_MESSAGE }, { status: 403 });
    }

    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(assignmentId).get();
    if (!assignmentSnap.exists) {
      return NextResponse.json({ error: "Teaching assignment not found" }, { status: 404 });
    }
    const assignment = assignmentSnap.data() as TeachingAssignment;
    if (assignment.facultyId !== facultyId || assignment.isPast) {
      return NextResponse.json({ error: "This assignment does not belong to that faculty member" }, { status: 400 });
    }

    // Confirms a real PUBLISHED period exists for this exact
    // (assignment, date, period) - never invented from the request body -
    // and gives us the period's own scheduled end time, needed to refuse a
    // period that hasn't ended yet (the faculty still has their own window;
    // see resolvePeriodCompletionStatus's PENDING vs NOT_MARKED split, the
    // same rule the "Not Posted Faculty" report already applies).
    const periodsForDate = await getFacultyPeriodsForDate(db, session.collegeId, facultyId, date);
    const matchedPeriod = periodsForDate.find(
      (p) => p.slot.assignmentId === assignmentId && p.slot.periodNumber === periodNumber
    );
    if (!matchedPeriod) {
      return NextResponse.json(
        { error: "No published class period matches this faculty/assignment/date/period combination" },
        { status: 400 }
      );
    }
    const completionStatus = resolvePeriodCompletionStatus({ dateISO: date, endTime: matchedPeriod.endTime, session: null });
    if (completionStatus === "PENDING") {
      return NextResponse.json(
        { error: "This period hasn't ended yet - the faculty member should mark it themselves." },
        { status: 403 }
      );
    }

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

    const id = `${assignmentId}_${date}_${periodNumber}`;
    const ref = collegeRef.collection("studentAttendance").doc(id);

    // A submitted session is a locked historical record - safe to just read
    // back (e.g. a prior office attempt landing after the faculty already
    // submitted) without clobbering. If we land on an existing DRAFT, hand
    // it back rather than overwriting the marks already entered.
    const existingSnap = await ref.get();
    if (existingSnap.exists) {
      const existing = existingSnap.data() as StudentAttendanceSession;
      if (existing.status === "SUBMITTED") {
        return NextResponse.json({ error: "Attendance for this period has already been submitted" }, { status: 409 });
      }
      return NextResponse.json({ session: { ...existing, id } });
    }

    // department/sectionName/year/courseId were already resolved off the
    // assignment (and its Section doc, when it has one) above - reuse them
    // rather than re-fetching the same Section doc a second time. Also
    // narrows to the matched period's own labBatch (split lab period, see
    // TimetableSlot.labBatch) so an office-corrected roster is never wider
    // than the roster the faculty's own live session would have used (see
    // student-attendance/route.ts's own POST).
    const labBatch = matchedPeriod.slot.labBatch ?? undefined;
    const students = (await fetchSectionStudents(collegeRef, { department, sectionName, year, courseId, labBatch }))
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

    const markerSnap = await collegeRef.collection("users").doc(session.uid).get();
    const markerName = (markerSnap.data() as { name?: string } | undefined)?.name ?? "";
    const now = new Date();

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
      // StudentAttendanceSession.facultyId is the LOGIN uid (what class-work-
      // records/route.ts queries by), NOT the facultyMembers doc id the rest
      // of this route works in (assignment.facultyId, the `facultyId` param
      // above) - resolve via the target's own FacultyMember.userUid so a
      // faculty who's had their attendance office-corrected still sees it on
      // their own Attendance Report.
      facultyId: faculty.userUid ?? facultyId,
      facultyName: assignment.facultyName ?? facultyDisplayName(faculty),
      date,
      periodNumber,
      ...(labBatch ? { labBatch } : {}),
      status: "DRAFT" as const,
      entries: students.map((s) => ({ studentId: s.id, rollNumber: s.rollNumber, name: s.name, status: null })),
      totalStudents: students.length,
      presentCount: 0,
      classNotes: "",
      submittedAt: null,
      postedBy: "OFFICE" as const,
      correctedByUid: session.uid,
      correctedByName: markerName,
      correctionReason: reason,
      createdAt: now,
      updatedAt: now,
    };

    const conflictSession = await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(ref);
      if (freshSnap.exists) {
        return freshSnap.data() as StudentAttendanceSession;
      }
      tx.set(ref, attendanceSession);
      return null;
    });

    if (conflictSession) {
      if (conflictSession.status === "SUBMITTED") {
        return NextResponse.json({ error: "Attendance for this period has already been submitted" }, { status: 409 });
      }
      return NextResponse.json({ session: { ...conflictSession, id } });
    }

    return NextResponse.json({ session: { id, ...attendanceSession } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/office-correction POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
