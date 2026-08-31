export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import type { LeaveRequest, PeriodSubstitution } from "@/types/leave";

// Every still-open adjustment request (substitute/handover) addressed to the
// caller - one row per LeaveRequest they've been named on, trimmed to just
// what they need to decide (not the requester's full leave record). Feeds
// the accept/decline inbox at /leave/adjustments - see
// /api/leave/applications/[id]/adjustment-response for the actual response.
// The display detail (day, period number, subject, section) for each covered
// period, taken from whichever substitution list holds it. A proposal awaiting
// acceptance is in pendingPeriodSubstitutions; one already in force is in
// periodSubstitutions.
function detailByKey(r: LeaveRequest) {
  const map = new Map<string, PeriodSubstitution>();
  for (const p of r.periodSubstitutions ?? []) map.set(`${p.date}|${p.timetableSlotId}`, p);
  for (const p of r.pendingPeriodSubstitutions ?? []) map.set(`${p.date}|${p.timetableSlotId}`, p);
  return map;
}

export async function GET() {
  try {
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const db = getAdminDb();
    // PENDING_ACCEPTANCE was once the only status that could hold a PENDING
    // entry, but PROPOSE_COVERAGE (a HOD/Principal naming a substitute from
    // the approval queue, or adjusting an already-approved leave) adds them
    // while the request sits at PENDING_HOD or APPROVED. Bounding the query to
    // PENDING_ACCEPTANCE hid exactly those: the assignee was notified and had
    // a PENDING entry on record, but their inbox said "Nothing pending your
    // response". REJECTED/CANCELLED are excluded - a pending entry there is
    // moot.
    const snap = await REQUESTS_COL(session.collegeId, db)
      .where("status", "in", [
        "PENDING_ACCEPTANCE", "PENDING_HOD", "PENDING_PRINCIPAL", "PENDING_MANAGEMENT", "APPROVED",
      ])
      .get();

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
            // Driven by the entry's own still-PENDING periods rather than by
            // filtering periodSubstitutions on assigneeFacultyId: a proposal
            // that hasn't been accepted yet lives in pendingPeriodSubstitutions
            // (periodSubstitutions only takes effect on acceptance), so keying
            // off the committed list alone showed an empty period list for
            // every HOD-proposed cover. Both lists feed the lookup, the
            // pending one winning where a period appears in both.
            periods: a.kind === "SUBSTITUTE"
              ? (a.periods ?? [])
                  .filter((p) => p.status === "PENDING")
                  .map((p) => {
                    const detail = detailByKey(r).get(`${p.date}|${p.timetableSlotId}`);
                    return {
                      date: p.date, timetableSlotId: p.timetableSlotId,
                      day: detail?.day, periodNumber: detail?.periodNumber,
                      subjectName: detail?.subjectName, sectionName: detail?.sectionName ?? null,
                    };
                  })
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
