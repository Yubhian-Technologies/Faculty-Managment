export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { allAdjustmentsAccepted, deriveSubstituteStatus } from "@/lib/leave/adjustmentRequests";
import { notify } from "@/lib/notify";
import type { LeaveRequest } from "@/types/leave";

// The named substitute/handover person's own accept/decline on ONE
// LeaveRequest - see types/leave.ts's AdjustmentRequest and PENDING_ACCEPTANCE.
// Accepting is what actually lets the request move on to its real approver
// once every other named person has also accepted; declining sends it back
// to the requester to pick someone else (see REVISE_ADJUSTMENT in
// applications/[id]/route.ts) rather than forwarding it anywhere.
//
// A SUBSTITUTE assignee covering several periods can respond PARTIAL - accept
// the rest, decline only the ones listed in `declinedPeriods` - instead of an
// all-or-nothing ACCEPT/DECLINE of the whole bundle. HANDOVER has no periods
// to split, so only ACCEPT/DECLINE apply there.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember(
      "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL",
      "COLLEGE_OFFICE", "ACCOUNTS", "FINANCE", "COLLEGE_STAFF",
      "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D",
      "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT"
    );
    const body = (await request.json()) as {
      response?: "ACCEPT" | "DECLINE" | "PARTIAL";
      declinedPeriods?: { date: string; timetableSlotId: string }[];
      declineReason?: string;
    };
    if (body.response !== "ACCEPT" && body.response !== "DECLINE" && body.response !== "PARTIAL") {
      return NextResponse.json({ error: "response must be ACCEPT, DECLINE or PARTIAL" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(session.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    // PENDING_ACCEPTANCE: the requester's own original submission (or a
    // still-pending revise) - see applications/route.ts POST. PENDING_HOD /
    // APPROVED: a HOD/Principal's own later PROPOSE_COVERAGE, which never
    // moves the request's overall status - only the entry lookup below
    // (must actually have a PENDING entry for this caller) gates it.
    if (req.status !== "PENDING_ACCEPTANCE" && req.status !== "PENDING_HOD" && req.status !== "APPROVED") {
      return NextResponse.json({ error: "This request is no longer awaiting acceptance" }, { status: 400 });
    }
    const list = req.adjustmentRequests ?? [];
    const idx = list.findIndex((a) => a.assigneeUid === session.uid && a.status === "PENDING");
    if (idx === -1) {
      return NextResponse.json({ error: "You have no pending adjustment request on this leave" }, { status: 404 });
    }
    const entry = list[idx];
    if (body.response === "PARTIAL" && entry.kind !== "SUBSTITUTE") {
      return NextResponse.json({ error: "PARTIAL only applies to a substitute's individual periods" }, { status: 400 });
    }

    const now = new Date();
    const nowTs = now as unknown as LeaveRequest["createdAt"];
    const updated = [...list];
    let declinedCount = 0;

    if (entry.kind === "SUBSTITUTE") {
      const declinedKeys = new Set((body.declinedPeriods ?? []).map((p) => `${p.date}|${p.timetableSlotId}`));
      const periods = (entry.periods ?? []).map((p) => {
        const key = `${p.date}|${p.timetableSlotId}`;
        const status = body.response === "ACCEPT" ? "ACCEPTED"
          : body.response === "DECLINE" ? "DECLINED"
          : declinedKeys.has(key) ? "DECLINED" : "ACCEPTED"; // PARTIAL
        if (status === "DECLINED") declinedCount++;
        return { ...p, status } as typeof p;
      });
      updated[idx] = {
        ...entry, periods, status: deriveSubstituteStatus(periods), respondedAt: nowTs,
        ...(declinedCount > 0 && body.declineReason?.trim() ? { declineReason: body.declineReason.trim() } : {}),
      };
    } else {
      declinedCount = body.response === "DECLINE" ? 1 : 0;
      updated[idx] = {
        ...entry,
        status: body.response === "ACCEPT" ? "ACCEPTED" : "DECLINED",
        respondedAt: nowTs,
        ...(body.response === "DECLINE" && body.declineReason?.trim() ? { declineReason: body.declineReason.trim() } : {}),
      };
    }

    // If any of the periods just responded to were a HOD/Principal PROPOSE_COVERAGE
    // proposal (not the requester's own original picks), commit the ACCEPTED
    // ones into the real periodSubstitutions now and drop every one of them -
    // accepted or declined - from pendingPeriodSubstitutions; a decline just
    // needs the HOD/Principal to propose someone else for that period.
    let periodSubstitutions = req.periodSubstitutions;
    let pendingPeriodSubstitutions = req.pendingPeriodSubstitutions;
    if (entry.kind === "SUBSTITUTE" && pendingPeriodSubstitutions?.length) {
      const thisEntryKeys = new Set((entry.periods ?? []).map((p) => `${p.date}|${p.timetableSlotId}`));
      const acceptedKeys = new Set(
        (updated[idx].periods ?? []).filter((p) => p.status === "ACCEPTED").map((p) => `${p.date}|${p.timetableSlotId}`)
      );
      const currentByKey = new Map((periodSubstitutions ?? []).map((p) => [`${p.date}|${p.timetableSlotId}`, p]));
      const remainingPending = [];
      let touched = false;
      for (const p of pendingPeriodSubstitutions) {
        const key = `${p.date}|${p.timetableSlotId}`;
        if (!thisEntryKeys.has(key)) { remainingPending.push(p); continue; }
        touched = true;
        if (acceptedKeys.has(key)) currentByKey.set(key, p);
      }
      if (touched) {
        periodSubstitutions = Array.from(currentByKey.values());
        pendingPeriodSubstitutions = remainingPending;
      }
    }

    const nowAllAccepted = req.status === "PENDING_ACCEPTANCE" && updated[idx].status === "ACCEPTED" && allAdjustmentsAccepted(updated);
    await ref.update({
      adjustmentRequests: updated,
      updatedAt: now,
      ...(periodSubstitutions !== req.periodSubstitutions ? { periodSubstitutions } : {}),
      ...(pendingPeriodSubstitutions !== req.pendingPeriodSubstitutions ? { pendingPeriodSubstitutions } : {}),
      ...(nowAllAccepted ? { status: req.postAcceptanceStatus } : {}),
    });

    const what = entry.kind === "SUBSTITUTE" ? "cover your class(es)" : "be your handover contact";
    if (declinedCount === 0) {
      await notify(
        db, session.collegeId, req.uid, "ADJUSTMENT_ACCEPTED", "Adjustment Accepted",
        `${entry.assigneeName} accepted your request to ${what} during your leave.` +
          (nowAllAccepted ? " Your leave request is now with your approver." : ""),
        "/panel/leave"
      );
    } else {
      const partial = entry.kind === "SUBSTITUTE" && declinedCount < (entry.periods?.length ?? 0);
      await notify(
        db, session.collegeId, req.uid, "ADJUSTMENT_DECLINED", "Adjustment Declined",
        `${entry.assigneeName} declined ${partial ? `${declinedCount} of ${entry.periods?.length} period(s)` : `your request to ${what}`} during your leave` +
          (updated[idx].declineReason ? ` (${updated[idx].declineReason})` : "") + " - pick someone else to continue.",
        "/panel/leave"
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/applications/[id]/adjustment-response POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
