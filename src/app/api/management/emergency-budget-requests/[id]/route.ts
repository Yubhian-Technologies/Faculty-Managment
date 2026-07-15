export const dynamic = "force-dynamic";

// This is the sole, deliberate write exception to MANAGEMENT's otherwise read-only
// convention (see the comment on requireManagement() in verifySession.ts). Don't
// copy this pattern elsewhere without the same justification: Management approving
// an emergency budget request is the one workflow step that role must perform.

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { applyManagementDecision, type ManagementDecisionAction } from "@/lib/budget/managementApproval";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireManagement();
    const { id } = await params;
    const body = (await request.json()) as {
      collegeId?: string;
      action?: ManagementDecisionAction;
      remarks?: string;
    };

    if (!body.collegeId) {
      return NextResponse.json({ error: "collegeId required" }, { status: 400 });
    }
    if (!body.action || !["APPROVE", "REJECT", "RETURN"].includes(body.action)) {
      return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
    }

    const db = getAdminDb();
    const userSnap = await db.collection("systemUsers").doc(session.uid).get();
    const performerName = (userSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Management";

    await applyManagementDecision(db, body.collegeId, id, body.action, session.uid, performerName, body.remarks);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "REMARKS_REQUIRED") {
      return NextResponse.json({ error: "remarks required" }, { status: 400 });
    }
    if (err instanceof Error && (err.message === "NOT_PERMITTED" || err.message === "STALE_STATUS")) {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }
    console.error("[management/emergency-budget-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
