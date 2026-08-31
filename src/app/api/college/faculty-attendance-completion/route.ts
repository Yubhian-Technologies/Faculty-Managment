export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { Timestamp } from "firebase-admin/firestore";
import { requireCollegeMember, isCollegeAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveMergedCourseIds } from "@/lib/departments/courseGrouping";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import type { Course, FacultyMember, StudentAttendanceSession, TeachingAssignment } from "@/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// "HH:MM" in the college's local calendar - sent to the client instead of the
// raw Firestore Timestamp so it doesn't need its own Timestamp deserialization
// (same Asia/Kolkata convention as lib/timetable/currentPeriod.ts's collegeNow).
function formatISTTime(ts: Timestamp | null | undefined): string | null {
  if (!ts) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ts.toDate());
}

// "Attendance Completion": did a faculty member actually submit student
// attendance for each of their scheduled periods on a given date, and on
// time - distinct from /api/college/attendance/report (staff self check-in)
// and /api/college/section-attendance-report (per-section subject grid).
// Principal/VP see every department; HOD is locked to their own department
// tree (getHodDepartmentScope/canHodEditDepartment, same convention as
// GET /api/college/faculty). Deliberately excludes COLLEGE_ADMIN even though
// its session reads role="PRINCIPAL" - see verifySession.isCollegeAdmin.
//
// Two modes, selected by which query params are present:
//   date + department + courseId (no facultyId) -> { faculty: [...] }
//     Faculty who actually teach that course (via teachingAssignments), not
//     just anyone in the department - narrows the picker to relevant people.
//   date + facultyId (no courseId)               -> { periods: [...] }
//     That faculty's FULL day for `date`, across every course/section they
//     teach - not just the course used to find them above - since the point
//     is "did they complete all their classes", not one course's worth.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    if (isCollegeAdmin(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? "";
    const department = searchParams.get("department") ?? "";
    const courseId = searchParams.get("courseId") ?? "";
    const facultyId = searchParams.get("facultyId") ?? "";

    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "A valid date (YYYY-MM-DD) is required" }, { status: 400 });
    }

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    if (facultyId) {
      const facultySnap = await collegeRef.collection("facultyMembers").doc(facultyId).get();
      if (!facultySnap.exists) {
        return NextResponse.json({ error: "Faculty not found" }, { status: 404 });
      }
      const faculty = facultySnap.data() as FacultyMember;

      if (session.role === "HOD") {
        const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
        if (!canHodEditDepartment(scope, faculty.department)) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
      }

      const slots = await getFacultyPeriodsForDate(db, session.collegeId, facultyId, date);

      // Deterministic session doc ids (`${assignmentId}_${date}_${periodNumber}`)
      // - direct gets, no query, same lookup StudentAttendanceSession itself
      // documents. TimetableSlot has no sectionName of its own - resolved via
      // the same assignmentId from teachingAssignments (which already
      // denormalizes it) so the UI can show "which year/section" per period.
      const [sessions, assignments] = await Promise.all([
        Promise.all(
          slots.map((p) =>
            collegeRef
              .collection("studentAttendance")
              .doc(`${p.slot.assignmentId}_${date}_${p.slot.periodNumber}`)
              .get()
          )
        ),
        Promise.all(slots.map((p) => collegeRef.collection("teachingAssignments").doc(p.slot.assignmentId).get())),
      ]);

      const periods = slots.map((p, i) => {
        const sessionSnap = sessions[i];
        const attendanceSession = sessionSnap.exists ? (sessionSnap.data() as StudentAttendanceSession) : null;
        const status = resolvePeriodCompletionStatus({
          dateISO: date,
          endTime: p.endTime,
          session: attendanceSession,
        });
        const assignmentSnap = assignments[i];
        const sectionName = assignmentSnap.exists
          ? (assignmentSnap.data() as TeachingAssignment).sectionName ?? null
          : null;
        return {
          periodNumber: p.slot.periodNumber,
          startTime: p.startTime,
          endTime: p.endTime,
          courseId: p.slot.courseId,
          year: p.slot.year,
          sectionName,
          subjectName: p.slot.subjectName,
          status,
          submittedAtDisplay: formatISTTime(attendanceSession?.submittedAt),
        };
      });

      return NextResponse.json({ facultyId, facultyName: faculty.name, date, periods });
    }

    if (!department || !courseId) {
      return NextResponse.json({ error: "department and courseId are required" }, { status: 400 });
    }

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      if (!canHodEditDepartment(scope, department)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
      }
    }

    // The Course dropdown this courseId came from can legally list two
    // different doc ids for the same conceptual course (a legacy pre-catalog
    // doc alongside a properly catalog-linked one - see
    // lib/departments/courseGrouping.ts) - teachingAssignments may be
    // attached to either one. Resolve the full duplicate-group id set here,
    // live, rather than trusting the caller to have already deduped, so
    // faculty don't silently disappear depending on which duplicate got
    // picked.
    let courseIdsToQuery = [courseId];
    const courseSnap = await collegeRef.collection("courses").doc(courseId).get();
    if (courseSnap.exists) {
      const courseDeptId = (courseSnap.data() as Course).departmentId;
      const siblingsSnap = await collegeRef.collection("courses").where("departmentId", "==", courseDeptId).get();
      const siblings = siblingsSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Course & { id: string });
      courseIdsToQuery = resolveMergedCourseIds(siblings, courseId);
    }

    const assignmentsSnap = await collegeRef
      .collection("teachingAssignments")
      .where("department", "==", department)
      .where("courseId", "in", courseIdsToQuery)
      .get();
    const facultyIds = Array.from(
      new Set(assignmentsSnap.docs.map((d) => (d.data() as TeachingAssignment).facultyId).filter(Boolean))
    );

    if (facultyIds.length === 0) {
      return NextResponse.json({ faculty: [] });
    }

    const facultySnaps = await Promise.all(
      facultyIds.map((id) => collegeRef.collection("facultyMembers").doc(id).get())
    );
    const faculty = facultySnaps
      .filter((s) => s.exists)
      .map((s) => {
        const f = s.data() as FacultyMember;
        return { facultyId: s.id, name: f.name, designation: f.designation };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty-attendance-completion GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
