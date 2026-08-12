export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { resolveUserDepartment } from "@/lib/budget/departmentScope";
import type { LeaveRequest } from "@/types/leave";

function toDate(v: unknown): Date | null {
  const ts = v as { toDate?: () => Date } | undefined;
  return ts?.toDate?.() ?? null;
}

// Calendar-day comparison (not millisecond) - a leave request's fromDate/
// toDate are stored as midnight timestamps, so this avoids an off-by-one
// from time-of-day differences.
function coversToday(today: Date, from: Date, to: Date): boolean {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const f = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const l = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return t >= f && t <= l;
}

export interface ActiveLeaveEntry {
  id: string;
  uid: string;
  employeeName: string;
  department?: string;
  leaveTypeCode?: LeaveRequest["leaveTypeCode"];
  isOtherRequest?: boolean;
  fromDate: LeaveRequest["fromDate"];
  toDate: LeaveRequest["toDate"];
}

// Everyone currently on APPROVED leave that covers today - the "Active Now"
// module at the top of the Leave History tab (see ActiveLeaveNowCard.tsx),
// not folded into the register like a completed, historical entry. HOD gets
// their own department only; Principal/VP/College Office get the whole
// college, including non-departmental roles (no `department` filter - unlike
// absent-today's department-grouped counts, which those roles are invisible to).
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE");
    const db = getAdminDb();
    const today = new Date();

    let dept: string | undefined;
    if (session.role === "HOD") {
      dept = (await resolveUserDepartment(db, session.collegeId, session.uid)) || undefined;
      if (!dept) return NextResponse.json({ entries: [] });
    }

    const snap = await REQUESTS_COL(session.collegeId, db).where("status", "==", "APPROVED").get();

    const entries: ActiveLeaveEntry[] = [];
    for (const doc of snap.docs) {
      const r = doc.data() as LeaveRequest;
      if (dept && r.department !== dept) continue;
      const from = toDate(r.fromDate);
      const to = toDate(r.toDate);
      if (!from || !to || !coversToday(today, from, to)) continue;
      entries.push({
        id: doc.id,
        uid: r.uid,
        employeeName: r.employeeName,
        department: r.department,
        leaveTypeCode: r.leaveTypeCode,
        isOtherRequest: r.isOtherRequest,
        fromDate: r.fromDate,
        toDate: r.toDate,
      });
    }
    entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName));

    return NextResponse.json({ entries });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave-history-report/active-now GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
