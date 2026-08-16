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
import type { LeaveRequest } from "@/types/leave";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireManagement();
    const { id } = await params;
    const body = (await request.json()) as {
      collegeId?: string;
      action?: "APPROVE" | "REJECT";
      remarks?: string;
      isPaidLeave?: boolean;
    };

    if (!body.collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }
    if (body.action !== "APPROVE" && body.action !== "REJECT") {
      return NextResponse.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = REQUESTS_COL(body.collegeId, db).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id: snap.id, ...snap.data() } as LeaveRequest;

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
