export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import type { LeaveRequest } from "@/types/leave";

// Every still-open adjustment request (substitute/handover) addressed to the
// caller - one row per LeaveRequest they've been named on, trimmed to just
// what they need to decide (not the requester's full leave record). Feeds
// the accept/decline inbox at /leave/adjustments - see
// /api/leave/applications/[id]/adjustment-response for the actual response.
export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    // Bounded to PENDING_ACCEPTANCE - the only status where any entry can
    // still be PENDING (a request only leaves this status once every entry
    // is ACCEPTED).
    const snap = await REQUESTS_COL(session.collegeId, db).where("status", "==", "PENDING_ACCEPTANCE").get();

    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as LeaveRequest)
      .flatMap((r) =>
        (r.adjustmentRequests ?? [])
          .filter((a) => a.assigneeUid === session.uid && a.status === "PENDING")
          .map((a) => ({
            requestId: r.id,
            kind: a.kind,
            employeeName: r.employeeName,
            department: r.department ?? null,
            fromDate: r.fromDate,
            toDate: r.toDate,
            totalDays: r.totalDays,
            reason: r.reason,
            periods: a.kind === "SUBSTITUTE"
              ? (r.periodSubstitutions ?? [])
                  .filter((p) => p.substituteFacultyId === a.assigneeFacultyId)
                  .map((p) => ({
                    date: p.date, timetableSlotId: p.timetableSlotId, day: p.day, periodNumber: p.periodNumber,
                    subjectName: p.subjectName, sectionName: p.sectionName ?? null,
                  }))
              : undefined,
            handoverNote: a.kind === "HANDOVER" ? r.handoverNote ?? null : undefined,
          }))
      );

    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/adjustment-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
