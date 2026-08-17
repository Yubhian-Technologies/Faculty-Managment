export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { resolveFacultyMemberId } from "@/lib/faculty/resolveFacultyMemberId";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { buildPeriodCoverage } from "@/lib/leave/periodCoverage";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import type { LeaveRequest } from "@/types/leave";

// Which of a teaching faculty member's periods fall within a leave date
// range, and who's free to cover each one - see lib/leave/periodCoverage.ts.
// Two callers:
//  - The requester themselves, filling out the Apply form for a standard
//    leave type (CL/SL/SCL/EL/OD) - pass fromDate/toDate, resolved against
//    the caller's own identity/department.
//  - An HOD optionally adjusting/replacing periods on an already-submitted
//    "Other" request while tagging it paid/unpaid - pass requestId, resolved
//    against that request's own uid/department/dates instead. Only that
//    request's own department HOD may do this (same guard as the PENDING_HOD
//    stage in applications/[id]/route.ts).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const url = new URL(request.url);
    const requestId = url.searchParams.get("requestId");
    const db = getAdminDb();

    let targetUid: string;
    let fromDate: Date;
    let toDate: Date;
    let department: string | undefined;

    if (requestId) {
      if (session.role !== "HOD") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const snap = await REQUESTS_COL(session.collegeId, db).doc(requestId).get();
      if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const req = { id: snap.id, ...snap.data() } as LeaveRequest;
      const hodDept = await resolveUserDepartment(db, session.collegeId, session.uid);
      if (!hodDept || req.department !== hodDept) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      targetUid = req.uid;
      department = req.department;
      fromDate = (req.fromDate as unknown as { toDate(): Date }).toDate();
      toDate = (req.toDate as unknown as { toDate(): Date }).toDate();
    } else {
      const fromDateStr = url.searchParams.get("fromDate");
      const toDateStr = url.searchParams.get("toDate");
      if (!fromDateStr || !toDateStr) {
        return NextResponse.json({ error: "fromDate and toDate (or requestId) are required" }, { status: 400 });
      }
      fromDate = new Date(fromDateStr);
      toDate = new Date(toDateStr);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || toDate < fromDate) {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      targetUid = session.uid;
      const identity = await resolveEmployeeIdentity(db, session.collegeId, session.uid);
      department = identity?.department;
    }

    if (!department) {
      return NextResponse.json({ periods: [] });
    }

    const facultyMemberId = await resolveFacultyMemberId(db, session.collegeId, targetUid);
    const holidayDates = await getHolidayDateKeys(db, session.collegeId, fromDate, toDate);
    const periods = await buildPeriodCoverage(db, session.collegeId, facultyMemberId, department, fromDate, toDate, holidayDates);

    return NextResponse.json({ periods });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/period-coverage GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
