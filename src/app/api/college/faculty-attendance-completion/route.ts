export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import type { Timestamp } from "firebase-admin/firestore";
import { requireCollegeMember, isCollegeAdmin } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope, canHodEditDepartment } from "@/lib/departments/scope";
import { resolveMergedCourseIds } from "@/lib/departments/courseGrouping";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import { resolvePeriodCompletionStatus } from "@/lib/attendance/periodAttendanceStatus";
import { aggregateNotPosted, type PeriodSlotWithStatus } from "@/lib/studentAttendance/notPostedAggregation";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { istDateFromParts, istDateKey } from "@/lib/attendance/istTime";
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
    const fromParam = searchParams.get("from")?.trim() || "";
    const toParam = searchParams.get("to")?.trim() || "";
    const allTime = searchParams.get("allTime") === "true" || searchParams.get("tillNow") === "true";
    const yearParam = searchParams.get("year")?.trim() || "";
    const monthParam = searchParams.get("month")?.trim() || "";
    const hasRange = !!(fromParam || toParam || allTime || (yearParam && monthParam));

    if (!DATE_RE.test(date) && !hasRange) {
      return NextResponse.json({ error: "A valid date (YYYY-MM-DD) or range (from/to or allTime or year+month) is required" }, { status: 400 });
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

      // Aggregated range mode for not-posted reports (monthly/period/tillNow)
      if (hasRange) {
        const dates: string[] = [];
        if (allTime) {
          // Cap at 365 days back to bound reads. Anchored on the IST calendar
          // day (istDateKey/istDateFromParts - same helpers currentPeriod.ts's
          // collegeNow uses), not a raw `new Date()` local-server day - a
          // UTC-hosted function is 5h30 behind India, so during the first
          // ~5.5h of every IST day, local Date getters would report
          // yesterday's date and silently drop the most recent day from range.
          const todayIST = istDateKey();
          const [ty, tm, td] = todayIST.split("-").map(Number);
          for (let i = 0; i < 365; i++) {
            const anchor = istDateFromParts(ty, tm, td);
            const d = new Date(anchor.getTime() - i * 24 * 60 * 60 * 1000);
            dates.unshift(istDateKey(d));
          }
        } else if (yearParam && monthParam) {
          const y = Number(yearParam), m = Number(monthParam);
          const dim = new Date(y, m, 0).getDate();
          for (let d = 1; d <= dim; d++) dates.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
        } else if (fromParam && toParam) {
          if (!DATE_RE.test(fromParam) || !DATE_RE.test(toParam) || fromParam > toParam) {
            return NextResponse.json({ error: "Valid from/to (YYYY-MM-DD) with from <= to required" }, { status: 400 });
          }
          const start = new Date(fromParam + "T00:00:00");
          const end = new Date(toParam + "T00:00:00");
          for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
            dates.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
          }
          if (dates.length > 365) return NextResponse.json({ error: "Range too large (max 365 days)" }, { status: 400 });
        } else {
          return NextResponse.json({ error: "Provide from/to, allTime, or year+month for range" }, { status: 400 });
        }
        // Independent per-date lookups - run concurrently instead of one
        // await per date (an allTime request spans up to 365 dates, which
        // serialized into hundreds of round trips otherwise).
        const perDateResults = await Promise.all(dates.map(async (d) => {
          const slotsR = await getFacultyPeriodsForDate(db, session.collegeId, facultyId, d);
          if (slotsR.length === 0) return null;
          const snaps = await Promise.all(slotsR.map((p) => collegeRef.collection("studentAttendance").doc(`${p.slot.assignmentId}_${d}_${p.slot.periodNumber}`).get()));
          const slotStatuses: PeriodSlotWithStatus[] = slotsR.map((p, i) => {
            const sess = snaps[i].exists ? (snaps[i].data() as StudentAttendanceSession) : null;
            const status = resolvePeriodCompletionStatus({ dateISO: d, endTime: p.endTime, session: sess });
            return { periodNumber: p.slot.periodNumber, startTime: p.startTime, endTime: p.endTime, assignmentId: p.slot.assignmentId, status };
          });
          return { date: d, slotStatuses };
        }));

        const byDate: Record<string, { periods: number; notMarked: number }> = {};
        const allStatuses: PeriodSlotWithStatus[] = [];
        for (const r of perDateResults) {
          if (!r) continue;
          const dayAgg = aggregateNotPosted(r.slotStatuses);
          byDate[r.date] = { periods: dayAgg.totalPeriods, notMarked: dayAgg.notMarked };
          allStatuses.push(...r.slotStatuses);
        }
        const overall = aggregateNotPosted(allStatuses);
        return NextResponse.json({
          facultyId, facultyName: facultyDisplayName(faculty), dates,
          totalPeriods: overall.totalPeriods, onTime: overall.onTime, late: overall.late,
          notMarked: overall.notMarked, pending: overall.pending, notPosted: overall.notPosted,
          byDate,
        });
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
          assignmentId: p.slot.assignmentId,
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

      return NextResponse.json({ facultyId, facultyName: facultyDisplayName(faculty), date, periods });
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
        return { facultyId: s.id, name: facultyDisplayName(f), designation: f.designation };
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
