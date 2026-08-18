export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getCurrentTimetableSlot } from "@/lib/timetable/currentPeriod";
import type { TeachingAssignment } from "@/types";

// Resolves the faculty member's currently-active period from the published
// HOD Timetable (see CLAUDE.md's "HOD Timetable" -> "Faculty Dashboard"
// connection) so Student Attendance can auto-load the right class instead of
// a manual dropdown. Denormalized display fields (courseName, sectionName)
// come from the slot's own TeachingAssignment - the same doc
// POST /api/college/student-attendance keys the roster/session off - so the
// two stay in lockstep.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);

    const current = await getCurrentTimetableSlot(db, session.collegeId, facultyMemberId);
    if (!current) {
      return NextResponse.json({ active: false });
    }

    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(current.slot.assignmentId).get();
    if (!assignmentSnap.exists) {
      // The slot points at an assignment that's since been deleted - treat as
      // no active class rather than surfacing a broken/partial period.
      return NextResponse.json({ active: false });
    }
    const assignment = assignmentSnap.data() as TeachingAssignment;

    return NextResponse.json({
      active: true,
      assignmentId: current.slot.assignmentId,
      periodNumber: current.slot.periodNumber,
      startTime: current.startTime,
      endTime: current.endTime,
      department: current.slot.department,
      courseId: current.slot.courseId,
      courseName: assignment.courseName ?? "",
      year: current.slot.year,
      sectionId: current.slot.sectionId,
      sectionName: assignment.sectionName ?? "",
      subjectId: current.slot.subjectId,
      subjectName: current.slot.subjectName,
      subjectCode: assignment.subjectCode ?? "",
      classroom: current.slot.classroom ?? null,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/current-period GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
