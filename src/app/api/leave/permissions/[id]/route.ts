export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveEmployeeIdentity } from "@/lib/leave/identity";
import { notifyPermissionDecision } from "@/lib/leave/permissionNotify";
import { PENDING_PERMISSION_STATUSES, type PermissionRequest } from "@/types/permission";

const COL = "permissionRequests";

const ROLES = [
  "PANEL_MEMBER", "HOD", "VICE_PRINCIPAL", "PRINCIPAL", "MANAGEMENT",
  "COLLEGE_OFFICE", "COLLEGE_STAFF", "ACCOUNTS", "FINANCE", "ACADEMICS", "IQAC_COORDINATOR",
  "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER", "PLACEMENT_DEPT", "PURCHASE_DEPT",
] as const;

/** APPROVE / REJECT by the approver, or CANCEL by the requester. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...ROLES);
    const { id } = await params;
    const body = (await request.json()) as { action?: string; note?: string };
    const action = body.action;
    const note = (body.note ?? "").trim();

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection(COL).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const req = { id, ...snap.data() } as PermissionRequest & { id: string };

    // Terminal guard - a decided request is never re-decided, the same rule
    // the hiring and leave flows apply.
    if (!PENDING_PERMISSION_STATUSES.includes(req.status)) {
      return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
    }

    if (action === "CANCEL") {
      if (req.uid !== session.uid) {
        return NextResponse.json({ error: "You can only cancel your own request" }, { status: 403 });
      }
      await ref.update({ status: "CANCELLED", updatedAt: new Date() });
      return NextResponse.json({ ok: true });
    }

    if (action !== "APPROVE" && action !== "REJECT") {
      return NextResponse.json({ error: "action must be APPROVE, REJECT or CANCEL" }, { status: 400 });
    }

    // Nobody decides their own, whatever role they hold.
    if (req.uid === session.uid) {
      return NextResponse.json({ error: "You can't decide your own permission request" }, { status: 403 });
    }

    // The tier it was routed to is what decides it - checked against the
    // stored status rather than re-deriving the routing, which may have been
    // changed in Settings since this was raised.
    if (req.status === "PENDING_HOD") {
      if (session.role !== "HOD") {
        return NextResponse.json({ error: "This request is waiting on the department's HOD" }, { status: 403 });
      }
      const mine = await resolveEmployeeIdentity(db, session.collegeId, session.uid);
      if (!mine?.department || mine.department !== req.department) {
        return NextResponse.json({ error: "That request belongs to another department" }, { status: 403 });
      }
    } else if (req.status === "PENDING_PRINCIPAL") {
      if (session.role !== "PRINCIPAL") {
        return NextResponse.json({ error: "This request is waiting on the Principal" }, { status: 403 });
      }
    } else if (req.status === "PENDING_VICE_PRINCIPAL") {
      if (session.role !== "PRINCIPAL" && session.role !== "VICE_PRINCIPAL") {
        return NextResponse.json({ error: "This request is waiting on the Vice Principal" }, { status: 403 });
      }
    } else if (req.status === "PENDING_MANAGEMENT") {
      if (session.role !== "MANAGEMENT") {
        return NextResponse.json({ error: "This request is waiting on Management" }, { status: 403 });
      }
    }

    if (action === "REJECT" && !note) {
      return NextResponse.json({ error: "A reason is required to reject" }, { status: 400 });
    }

    const deciderName = session.email || "Approver";
    const updates = {
      status: action === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedByUid: session.uid,
      decidedByName: deciderName,
      decidedAt: new Date(),
      ...(note ? { decisionNote: note } : {}),
      updatedAt: new Date(),
    };
    await ref.update(updates);

    try {
      await notifyPermissionDecision(
        db, session.collegeId,
        { ...req, decisionNote: note || undefined },
        action === "APPROVE",
        deciderName
      );
    } catch (notifyErr) {
      // The decision is recorded; a failed notification must not undo it.
      console.error("[leave/permissions PATCH] notify failed:", notifyErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/permissions PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
