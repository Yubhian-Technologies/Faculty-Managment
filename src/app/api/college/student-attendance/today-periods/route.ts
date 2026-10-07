export const dynamic = "force-dynamic";

import { effectiveLabBatch, loadLabBatchModes } from "@/lib/students/labBatchMode";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getNoClassReason } from "@/lib/studentAttendance/classDay";
import { getFacultyPeriodsForDate, UNAVAILABLE_MESSAGES } from "@/lib/timetable/currentPeriod";
import { dateInRanges, getAllocatedPeriodsForDate, loadFacultyAllocations } from "@/lib/studentAttendance/labAllocation";
import { facultyActiveOn, loadLabWindows } from "@/lib/students/labFacultyWindow";
import type { StudentAttendanceSession, TeachingAssignment } from "@/types";

// "Today" for attendance purposes is the college's calendar day (IST, Asia/Kolkata),
// not the UTC day the deployment host happens to run in. `todayStrIST()` is the
// date that must be compared against the stored `date` field and passed to
// getFacultyPeriodsForDate - a UTC-based "today" would silently return an empty
// list for hours in the IST morning/evening boundary and would also produce a
// false "no periods" result for the day the host crosses midnight UTC.
function todayStrIST(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}

function toMinutes(hhmm: string): number {
  // A period whose timing can't be resolved has no time: sorted last, never open.
  if (!hhmm) return Number.MAX_SAFE_INTEGER;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function collegeNowMinutes(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return Number(v("hour")) * 60 + Number(v("minute"));
}

// The faculty's own lab allocations, as the date picker on Mark Attendance needs them.
function allocationSummaries(allocations: Awaited<ReturnType<typeof loadFacultyAllocations>>) {
  return allocations.map((a) => ({
    assignmentId: a.assignmentId, subjectName: a.subjectName, subjectCode: a.subjectCode,
    courseName: a.courseName, year: a.year, sectionName: a.sectionName, ranges: a.ranges,
  }));
}

// Returns ALL periods for today for this faculty, with isOpen gate computed server-side.
// isOpen = now in [start,closeTime) IST (closeTime = the year's college end time) and date is today. Session is fetched if exists (DRAFT/SUBMITTED) for display.
// This is a READ path — does NOT enforce window for reads (closed rows are shown read-only + "Contact Dept Office").
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if (!facultyMemberId) {
      return NextResponse.json({ date: todayStrIST(), periods: [] });
    }
    const today = todayStrIST();
    const nowMinutes = collegeNowMinutes();
    // `?date=` is honoured only for a past date inside a lab allocation of this
    // faculty member (see lib/studentAttendance/labAllocation.ts); anything else
    // is today.
    const dateParam = new URL(request.url).searchParams.get("date");
    const allocations = await loadFacultyAllocations(db, session.collegeId, facultyMemberId);
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam < today && allocations.some((a) => dateInRanges(dateParam, a.ranges))
      ? dateParam
      : today;
    const isToday = date === today;
    const [closedReason, ownSlots, allocatedSlots] = await Promise.all([
      getNoClassReason(db, session.collegeId, date),
      // A past date is only ever the allocated lab periods, never the day's ordinary classes.
      isToday ? getFacultyPeriodsForDate(db, session.collegeId, facultyMemberId, date, undefined, { lenient: true }) : Promise.resolve([]),
      getAllocatedPeriodsForDate(db, session.collegeId, facultyMemberId, allocations, date),
    ]);
    // Holiday / summer break / non-working day: nothing to mark today.
    if (closedReason) return NextResponse.json({ date, periods: [], allocations: allocationSummaries(allocations), noClassReason: closedReason });
    const allocatedKeys = new Set(allocatedSlots.map((a) => `${a.slot.assignmentId}_${a.slot.periodNumber}`));
    // A lab's faculty teach it on their own dates (set by the section's faculty incharge): outside
    // them the period is not theirs to take - unless an HOD/Incharge allocated it to them.
    const labWindows = await loadLabWindows(db, session.collegeId, ownSlots.map((s) => ({ sectionId: s.slot.sectionId, subjectId: s.slot.subjectId })));
    // An allocated period comes from the allocation (its own resolved times); the faculty's own
    // copy of it is not listed twice.
    const slots = [
      ...ownSlots.filter((o) =>
        !allocatedKeys.has(`${o.slot.assignmentId}_${o.slot.periodNumber}`)
        && facultyActiveOn(labWindows, o.slot.sectionId, o.slot.subjectId, o.slot.facultyId, date)),
      ...allocatedSlots,
    ].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

    const collegeRef = db.collection("colleges").doc(session.collegeId);
    // One batched read for the assignment docs and one for today's sessions,
    // instead of a sequential get() per assignment and per period.
    const assignmentIds = [...new Set(slots.map((s) => s.slot.assignmentId))];
    const assignMap = new Map<string, TeachingAssignment>();
    if (assignmentIds.length > 0) {
      const snaps = await db.getAll(...assignmentIds.map((id) => collegeRef.collection("teachingAssignments").doc(id)));
      for (const snap of snaps) if (snap.exists) assignMap.set(snap.id, snap.data() as TeachingAssignment);
    }
    const sessionIds = slots.map((s) => `${s.slot.assignmentId}_${date}_${s.slot.periodNumber}`);
    const sessionMap = new Map<string, StudentAttendanceSession & { id: string }>();
    if (sessionIds.length > 0) {
      const snaps = await db.getAll(...sessionIds.map((id) => collegeRef.collection("studentAttendance").doc(id)));
      for (const snap of snaps) {
        if (snap.exists) sessionMap.set(snap.id, { ...(snap.data() as StudentAttendanceSession), id: snap.id });
      }
    }

    // A lab the section's faculty incharge set to "no batch" shows (and rosters) as the whole section.
    const labModes = await loadLabBatchModes(db, session.collegeId, slots.map((s) => ({ sectionId: s.slot.sectionId, subjectId: s.slot.subjectId })));
    const periods = await Promise.all(
      slots.map(async ({ slot, startTime, endTime, closeTime, unavailableReason }) => {
        // An allocated lab period is open all day on its allocated dates.
        const allocated = allocatedKeys.has(`${slot.assignmentId}_${slot.periodNumber}`);
        const isOpen = allocated || (!unavailableReason && nowMinutes >= toMinutes(startTime) && nowMinutes < toMinutes(closeTime));
        // Where "now" sits against the period: not started yet, running, or over.
        const phase: "UPCOMING" | "OPEN" | "ENDED" = isOpen ? "OPEN" : unavailableReason || nowMinutes < toMinutes(startTime) ? "UPCOMING" : "ENDED";
        const id = `${slot.assignmentId}_${date}_${slot.periodNumber}`;
        const sess = sessionMap.get(id) ?? null;
        const assignment = assignMap.get(slot.assignmentId);
        return {
          assignmentId: slot.assignmentId,
          periodNumber: slot.periodNumber,
          startTime,
          endTime,
          closeTime,
          unavailableMessage: unavailableReason && !allocated ? UNAVAILABLE_MESSAGES[unavailableReason] : null,
          department: slot.department,
          courseId: slot.courseId,
          courseName: assignment?.courseName ?? "",
          year: slot.year,
          sectionId: slot.sectionId,
          sectionName: assignment?.sectionName ?? slot.sectionId ?? "",
          subjectId: slot.subjectId,
          subjectName: slot.subjectName,
          classroom: slot.classroom ?? null,
          sessionId: id,
          session: sess,
          sessionStatus: sess?.status ?? null,
          isOpen,
          phase,
          labBatch: effectiveLabBatch(slot.labBatch, labModes, slot.sectionId, slot.subjectId, slot.facultyId) ?? null,
          allocated,
        };
      })
    );

    return NextResponse.json({ date, periods, allocations: allocationSummaries(allocations) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/today-periods GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
