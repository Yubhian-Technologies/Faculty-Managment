export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { canAccessLeaveProfile } from "@/lib/leave/access";
import { istMonthBounds, getISTParts } from "@/lib/attendance/istTime";
import { toAttendanceDate } from "@/lib/attendance/closeMissedCheckouts";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import type { AttendanceRecord, AttendanceStatus } from "@/types";

export interface LeaveCalendarDay {
  day: number;
  status: AttendanceStatus;
  late: boolean;
}

// One month of a single person's own attendance, reduced to just what the
// "My Leave" calendar (LeaveCalendar.tsx) needs to color a day - not the full
// attendance-report machinery (fillMissingDays' Absent synthesis, Working Day
// overrides, ...), since several roles with a Leave page (ACADEMICS, FINANCE,
// ...) never do self-attendance check-in at all and have no concept of
// "Absent" to synthesize. Only real attendanceRecords days are returned; a
// day with none is simply absent from the array.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const { searchParams } = new URL(request.url);
    const targetUid = searchParams.get("uid") || session.uid;
    const nowIST = getISTParts();
    const year = parseInt(searchParams.get("year") ?? String(nowIST.year), 10);
    const month = parseInt(searchParams.get("month") ?? String(nowIST.month), 10);

    const db = getAdminDb();
    if (!(await canAccessLeaveProfile(db, session.collegeId, session.role, session.uid, targetUid))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { monthStart, monthEnd } = istMonthBounds(year, month);
    const snap = await db.collection("colleges").doc(session.collegeId).collection("attendanceRecords")
      .where("facultyId", "==", targetUid)
      .get();

    const days: LeaveCalendarDay[] = snap.docs
      .map((d) => d.data() as AttendanceRecord)
      .map((rec) => ({ rec, date: toAttendanceDate(rec.date) }))
      .filter((r): r is { rec: AttendanceRecord; date: Date } => !!r.date && r.date >= monthStart && r.date < monthEnd)
      .map(({ rec, date }) => ({
        day: date.getDate(),
        status: rec.status,
        late: rec.status === "PRESENT" && isLateCheckIn(rec.checkIn, rec.permittedCheckInTime),
      }));

    return NextResponse.json({ days });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/attendance-calendar GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
