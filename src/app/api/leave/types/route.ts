export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { loadResolvedLeaveTypes } from "@/lib/leave/resolveLeaveTypes";

export async function GET() {
  try {
    const session = await requireRole(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
      "SUPER_ADMIN"
    );

    // SUPER_ADMIN has no single college context here - falls back to the
    // built-in seed (unmodified). Every college-scoped role gets their own
    // college's Settings > Leave Policy overrides merged in - see
    // resolveLeaveTypes.ts.
    if (!session.collegeId) {
      return NextResponse.json({ leaveTypes: LEAVE_TYPE_SEED });
    }
    const db = getAdminDb();
    const leaveTypes = await loadResolvedLeaveTypes(db, session.collegeId);
    return NextResponse.json({ leaveTypes });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/types GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
