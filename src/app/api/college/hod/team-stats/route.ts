export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveHodDepartments } from "@/lib/budget/departmentScope";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { getISTParts } from "@/lib/attendance/istTime";
import { toDate } from "@/lib/utils";
import type { AttendanceSummary } from "@/types";
import type { LeaveRequest } from "@/types/leave";

// HOD dashboard widget data: this department's leave usage and attendance %
// for the current month - see hod/page.tsx's "Team Leave & Attendance" card.
// Both figures are simple department-wide aggregates, not per-faculty
// breakdowns (the dashboard is a KPI glance, not a report - per-faculty
// detail already lives on the department's own Leave/Attendance pages).
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);

    const depts = await resolveHodDepartments(db, session.collegeId, session.uid);
    if (depts.length === 0) {
      return NextResponse.json({ leaveByType: [], totalLeaveDays: 0, attendancePercent: null });
    }

    const { year, month } = getISTParts();

    // Leave usage this month: every APPROVED request whose own department is
    // one of this HOD's, starting in the current month - same "simple
    // aggregate, not exact day-clipping across a month boundary" scope as
    // every other KPI tile here.
    const leaveSnap = await REQUESTS_COL(session.collegeId, db).where("status", "==", "APPROVED").get();
    const leaveByType = new Map<string, number>();
    for (const d of leaveSnap.docs) {
      const r = d.data() as LeaveRequest;
      if (!r.department || !depts.includes(r.department)) continue;
      const from = toDate(r.fromDate);
      if (!from || from.getFullYear() !== year || from.getMonth() + 1 !== month) continue;
      const key = r.isOtherRequest ? "OTHER" : (r.leaveTypeCode ?? "OTHER");
      leaveByType.set(key, (leaveByType.get(key) ?? 0) + r.totalDays);
    }
    const totalLeaveDays = Array.from(leaveByType.values()).reduce((a, b) => a + b, 0);

    // Attendance %: department's own materialized monthly summaries (see
    // api/college/attendance's own use of this same collection) - a
    // department-wide sum of present/totalWorkingDays, not a live per-day
    // recomputation (that path also reconciles today's not-yet-summarized
    // attendance, which a whole-department KPI tile doesn't need to be
    // second-accurate about).
    const summarySnap = await collegeRef.collection("attendanceSummaries")
      .where("year", "==", year).where("month", "==", month).get();
    let present = 0;
    let totalWorkingDays = 0;
    for (const d of summarySnap.docs) {
      const s = d.data() as AttendanceSummary;
      if (!depts.includes(s.department)) continue;
      present += s.present;
      totalWorkingDays += s.totalWorkingDays;
    }
    const attendancePercent = totalWorkingDays > 0 ? (present / totalWorkingDays) * 100 : null;

    return NextResponse.json({
      leaveByType: Array.from(leaveByType, ([leaveTypeCode, days]) => ({ leaveTypeCode, days })),
      totalLeaveDays,
      attendancePercent,
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/hod/team-stats GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
