export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHolidayNameForDate } from "@/lib/leave/holidaysCount";
import { isOnApprovedLeaveToday } from "@/lib/leave/leaveStatusToday";
import { COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";
import { isSunday } from "@/lib/attendance/attendanceWindow";
import { isWorkingDayForRole } from "@/lib/attendance/workingDays";
import type { UserRole } from "@/types";

// Whether today is a declared holiday, the hardcoded Sunday rule (unless a
// Working Day override names this caller's own role - see
// college-office/holidays/page.tsx and lib/attendance/workingDays.ts), or
// covered by the signed-in user's own approved leave - feeds the
// self-attendance pages' pre-Check-In banner (see SelfAttendancePage.tsx and
// its hod/panel/principal near-duplicates). check-in/route.ts re-checks all
// of this server-side regardless - this is purely so the UI can show the
// right message instead of a dead-end button.
export async function GET() {
  try {
    const session = await requireCollegeMember("PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_STAFF", ...COLLEGE_STAFF_UNIT_HEAD_ROLES);
    const db = getAdminDb();
    const today = new Date();

    const [holidayName, isOnLeave, isWorkingSunday] = await Promise.all([
      getHolidayNameForDate(db, session.collegeId, today),
      isOnApprovedLeaveToday(db, session.collegeId, session.uid, today),
      isSunday() ? isWorkingDayForRole(db, session.collegeId, today, session.role as UserRole) : Promise.resolve(false),
    ]);

    return NextResponse.json({
      isSunday: isSunday() && !isWorkingSunday,
      isHoliday: !!holidayName,
      holidayName,
      isOnLeave,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/today-status GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
