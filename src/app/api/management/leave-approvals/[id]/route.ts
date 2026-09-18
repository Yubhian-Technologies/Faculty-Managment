export const dynamic = "force-dynamic";

// A deliberate write exception to MANAGEMENT's otherwise read-only convention
// (see requireManagement()'s comment in verifySession.ts), same justification
// as management/emergency-budget-requests/[id]/route.ts: a Principal's own
// leave request has no one else within the college to decide it, so Management
// is the one workflow step this role must perform here too.

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { REQUESTS_COL } from "@/lib/leave/balanceEngine";
import { decideFinalStageLeave } from "@/lib/leave/decideFinalStage";
import { notifyODProofDecision } from "@/lib/leave/odProofNotify";
import type { LeaveRequest } from "@/types/leave";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireManagement();
    const { id } = await params;
    const body = (await request.json()) as {
      collegeId?: string;
      action?: "APPROVE" | "REJECT" | "VERIFY_OD_PROOF" | "REJECT_OD_PROOF";
      remarks?: string;
      isPaidLeave?: boolean;
      reason?: string;
    };

    if (!body.collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }
    const isProofReview = body.action === "VERIFY_OD_PROOF" || body.action === "REJECT_OD_PROOF";
    if (!isProofReview && body.action !== "APPROVE" && body.action !== "REJECT") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    if (body.action === "REJECT_OD_PROOF" && !body.reason?.trim()) {
      return NextResponse.json({ error: "A reason is required to reject proof of duty" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(body.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

    // ─── On Duty proof, for a Principal's own OD ──────────────────────────────
    // Management approved it, so nobody inside the college may verify its proof
    // (api/leave/applications/[id] refuses anything that isn't HOD- or
    // Principal-approved). Same writes and the same guards as that route's
    // branch - deliberately duplicated rather than shared, the way these two
    // files already duplicate their role guards around decideFinalStageLeave.
    if (isProofReview) {
      if (req.odProofStatus !== "PENDING_VERIFICATION") {
        return NextResponse.json({ error: "There is no proof awaiting verification on this request" }, { status: 400 });
      }
      if (!req.managementAction) {
        return NextResponse.json({ error: "This request wasn't decided by Management" }, { status: 403 });
      }
      const now = new Date();
      const verified = body.action === "VERIFY_OD_PROOF";
      await ref.update({
        odProofStatus: verified ? "VERIFIED" : "REJECTED",
        odProofReviewedBy: session.uid,
        odProofReviewedByName: session.email || "Management",
        odProofReviewedAt: now,
        odProofRejectionReason: verified ? "" : (body.reason ?? "").trim(),
        updatedAt: now,
      });
      await db.collection("colleges").doc(body.collegeId).collection("auditLogs").add({
        collegeId: body.collegeId,
        action: verified ? "LEAVE_OD_PROOF_VERIFIED" : "LEAVE_OD_PROOF_REJECTED",
        performedBy: session.uid, performedByName: session.email || "Management", targetId: id,
        details: { reason: body.reason ?? null }, timestamp: now,
      });
      await notifyODProofDecision(db, body.collegeId, { ...req, id }, verified, body.reason);
      return NextResponse.json({ ok: true });
    }

    // Re-stated (rather than relying on the guard above) so the decision path
    // below narrows to the two actions decideFinalStageLeave accepts.
    if (body.action !== "APPROVE" && body.action !== "REJECT") {
      return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
    }

    if (req.status !== "PENDING_MANAGEMENT") {
      return NextResponse.json({ error: "This request is no longer pending" }, { status: 400 });
    }

    // A Principal's own Other leave has no HOD in its chain to have already
    // tagged paid/unpaid (see the same requirement on the Principal's own
    // PENDING_PRINCIPAL decision, applications/[id]/route.ts) - Management
    // decides it themselves, in the same Approve action, since there's no
    // further stage to forward to.
    if (body.action === "APPROVE" && req.isOtherRequest && req.isPaidLeave === undefined) {
      if (typeof body.isPaidLeave !== "boolean") {
        return NextResponse.json({ error: "Select paid or unpaid before approving" }, { status: 400 });
      }
    }

    await decideFinalStageLeave({
      db, collegeId: body.collegeId, id, req,
      action: body.action, remarks: body.remarks,
      decidedByUid: session.uid, decidedByEmail: session.email,
      decider: "MANAGEMENT",
      isPaidLeave: body.isPaidLeave,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/leave-approvals/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
