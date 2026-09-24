export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodManageFacultyDepartment } from "@/lib/departments/scope";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { istDateFromParts } from "@/lib/attendance/istTime";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import type { StudentAttendanceEntry, StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const VALID_MARKS: StudentAttendanceMark[] = ["PRESENT", "ABSENT"];

// Companion to POST /api/college/student-attendance/office-correction - saves
// marks and (once every student is marked, same rule as the faculty-facing
// route) submits, locking the record exactly the same way a faculty's own
// submission does. Re-validates the department-office window on every save
// (same "re-check on every write, not just at creation" convention as
// checkFacultyPeriodWindow on the faculty side) so this can't be used to
// correct a record once its own month has closed.
//
// Deliberately does NOT require the DRAFT to have been created through the
// office-correction POST above - an HOD/office can also step in and finish a
// DRAFT the faculty started themselves but never submitted (same underlying
// problem: nothing got SUBMITTED). Either way, reaching this route to submit
// stamps postedBy/correctedBy* - the audit trail always reflects who actually
// finished the record, not just who created the draft row.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const body = (await request.json()) as {
      entries?: { studentId: string; status: StudentAttendanceMark | null }[];
      classNotes?: string;
      reason?: string;
      submit?: boolean;
    };

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("studentAttendance").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const existing = snap.data() as StudentAttendanceSession;
    if (existing.status === "SUBMITTED") {
      return NextResponse.json({ error: "Attendance has already been submitted and cannot be edited" }, { status: 409 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodManageFacultyDepartment(scope, existing.department)) {
        return NextResponse.json({ error: "That faculty is not in your department" }, { status: 403 });
      }
    }

    const [y, m, d] = existing.date.split("-").map(Number);
    const docDate = istDateFromParts(y, m, d);
    if (!isManualEditWindowOpen(docDate)) {
      return NextResponse.json({ error: MANUAL_EDIT_WINDOW_CLOSED_MESSAGE }, { status: 403 });
    }
    if (existing.periodNumber != null) {
      // existing.facultyId is the login uid (see office-correction/route.ts's
      // own comment), but getFacultyPeriodsForDate keys off the FacultyMember
      // doc id (same as timetableSlots/teachingAssignments) - without this
      // resolution the lookup always misses and the "period hasn't ended yet"
      // guard below silently never fires.
      const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, existing.facultyId);
      const periodsForDate = await getFacultyPeriodsForDate(db, session.collegeId, facultyMemberId, existing.date);
      const matchedPeriod = periodsForDate.find(
        (p) => p.slot.assignmentId === existing.assignmentId && p.slot.periodNumber === existing.periodNumber
      );
      if (matchedPeriod) {
        const completionStatus = resolvePeriodCompletionStatus({ dateISO: existing.date, endTime: matchedPeriod.endTime, session: null });
        if (completionStatus === "PENDING") {
          return NextResponse.json(
            { error: "This period hasn't ended yet - the faculty member should mark it themselves." },
            { status: 403 }
          );
        }
      }
    }

    let entries: StudentAttendanceEntry[] = existing.entries;
    if (body.entries) {
      const updates = new Map(body.entries.map((e) => [e.studentId, e.status]));
      for (const status of updates.values()) {
        if (status !== null && !VALID_MARKS.includes(status)) {
          return NextResponse.json({ error: "Attendance status must be PRESENT or ABSENT" }, { status: 400 });
        }
      }
      entries = existing.entries.map((e) => (updates.has(e.studentId) ? { ...e, status: updates.get(e.studentId) ?? null } : e));
    }
    const presentCount = entries.filter((e) => e.status === "PRESENT").length;
    const markedCount = entries.filter((e) => e.status != null).length;

    const now = new Date();
    const update: Record<string, unknown> = { entries, presentCount, updatedAt: now };
    if (body.classNotes !== undefined) {
      update.classNotes = body.classNotes.trim();
    }

    if (body.submit) {
      if (markedCount < existing.totalStudents || existing.totalStudents === 0) {
        return NextResponse.json({ error: "Please mark attendance for all students before submitting" }, { status: 400 });
      }
      const classNotes = ((update.classNotes as string | undefined) ?? existing.classNotes ?? "").trim();
      if (!classNotes) {
        return NextResponse.json({ error: "Record of the Class Work is required before submitting attendance" }, { status: 400 });
      }
      const reason = body.reason?.trim() || existing.correctionReason;
      if (!reason) {
        return NextResponse.json({ error: "A reason is required to post attendance on a faculty member's behalf" }, { status: 400 });
      }
      const markerSnap = await collegeRef.collection("users").doc(session.uid).get();
      update.status = "SUBMITTED";
      update.submittedAt = now;
      update.postedBy = "OFFICE";
      update.correctedByUid = session.uid;
      update.correctedByName = (markerSnap.data() as { name?: string } | undefined)?.name ?? "";
      update.correctionReason = reason;

      await collegeRef.collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "STUDENT_ATTENDANCE_OFFICE_CORRECTED",
        performedBy: session.uid,
        performedByName: update.correctedByName,
        targetId: id,
        details: { facultyId: existing.facultyId, facultyName: existing.facultyName, date: existing.date, periodNumber: existing.periodNumber, subjectName: existing.subjectName, reason },
        timestamp: now,
      });
    }

    await ref.update(update);
    return NextResponse.json({ session: { ...existing, ...update, id } });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/office-correction/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
