export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { getFacultyPeriodsForDate } from "@/lib/timetable/currentPeriod";
import type { StudentAttendanceSession, TeachingAssignment } from "@/types";

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

// Returns ALL periods for today for this faculty, with isOpen gate computed server-side.
// isOpen = now in [start,end) IST and date is today. Session is fetched if exists (DRAFT/SUBMITTED) for display.
// This is a READ path — does NOT enforce window for reads (closed rows are shown read-only + "Contact Dept Office").
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER");
    const db = getAdminDb();
    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, session.uid);
    if (!facultyMemberId) {
      return NextResponse.json({ date: todayStrIST(), periods: [] });
    }
    const today = todayStrIST();
    const nowMinutes = collegeNowMinutes();
    const slots = await getFacultyPeriodsForDate(db, session.collegeId, facultyMemberId, today);

    const collegeRef = db.collection("colleges").doc(session.collegeId);
    // Collect assignment names
    const assignmentIds = [...new Set(slots.map((s) => s.slot.assignmentId))];
    const assignMap = new Map<string, TeachingAssignment>();
    for (const id of assignmentIds) {
      const snap = await collegeRef.collection("teachingAssignments").doc(id).get();
      if (snap.exists) assignMap.set(id, snap.data() as TeachingAssignment);
    }

    const periods = await Promise.all(
      slots.map(async ({ slot, startTime, endTime }) => {
        const isOpen = nowMinutes >= toMinutes(startTime) && nowMinutes < toMinutes(endTime);
        const id = `${slot.assignmentId}_${today}_${slot.periodNumber}`;
        let sess: (StudentAttendanceSession & { id: string }) | null = null;
        try {
          const snap = await collegeRef.collection("studentAttendance").doc(id).get();
          if (snap.exists) sess = { ...(snap.data() as StudentAttendanceSession), id } as StudentAttendanceSession & { id: string };
        } catch {}
        const assignment = assignMap.get(slot.assignmentId);
        return {
          assignmentId: slot.assignmentId,
          periodNumber: slot.periodNumber,
          startTime,
          endTime,
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
          labBatch: slot.labBatch ?? null,
        };
      })
    );

    return NextResponse.json({ date: today, periods });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/student-attendance/today-periods GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
