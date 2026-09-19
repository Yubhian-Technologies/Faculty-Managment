export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { listHandoverCandidates } from "@/lib/leave/handoverPool";

// Who the caller can name as an optional handover/point-of-contact for a leave
// request (LeaveRequest.handoverToUid, see LeaveApplyForm.tsx) - open to any
// leave-applicant role, unlike GET /api/college/users which is admin-facing.
// The pool depends on the caller's own role (a supporting-staff member is
// offered supporting staff, not classroom teachers - see lib/leave/
// handoverPool.ts), and when the requested leave dates are passed, anyone on
// leave or otherwise tied up in that range is left out.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const url = new URL(request.url);
    const fromISO = url.searchParams.get("fromDate");
    const toISO = url.searchParams.get("toDate");
    const db = getAdminDb();

    const identity = await resolveEmployeeIdentity(db, session.collegeId, session.uid);
    const candidates = await listHandoverCandidates(
      db, session.collegeId,
      { uid: session.uid, role: session.role, department: identity?.department ?? "" },
      fromISO && toISO && toISO >= fromISO ? { fromISO, toISO } : undefined
    );

    return NextResponse.json({ candidates: candidates.map((c) => ({ uid: c.uid, name: c.name, department: c.department })) });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/handover-candidates GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
