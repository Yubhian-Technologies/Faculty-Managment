export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { isAdjustmentManager } from "@/lib/leave/staffAdjustmentScope";
import { notify } from "@/lib/notify";
import type { StaffAdjustment } from "@/types/leave";

// Cancel an adjustment - by whoever created it, or by the Principal / Vice
// Principal (who oversee every adjustment). The timetable overlay and every
// availability check read status === "ACTIVE", so this frees the cover
// people again immediately.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD", "COLLEGE_OFFICE");
    if (!isAdjustmentManager(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = (await request.json()) as { action?: "CANCEL" };
    if (body.action !== "CANCEL") return NextResponse.json({ error: "action must be CANCEL" }, { status: 400 });

    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const ref = collegeRef.collection("staffAdjustments").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const adj = { id: snap.id, ...snap.data() } as StaffAdjustment;

    const oversees = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL";
    if (adj.createdBy !== session.uid && !oversees) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (adj.status !== "ACTIVE") {
      return NextResponse.json({ error: "This adjustment is already cancelled" }, { status: 400 });
    }

    const actorSnap = await collegeRef.collection("users").doc(session.uid).get();
    const actorName = (actorSnap.data() as { name?: string } | undefined)?.name ?? session.email ?? "Unknown";
    const now = new Date();
    await ref.update({ status: "CANCELLED", cancelledAt: now, cancelledByName: actorName });

    await collegeRef.collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "STAFF_ADJUSTMENT_CANCELLED" as string,
      performedBy: session.uid,
      performedByName: actorName,
      targetId: id,
      details: { subject: adj.subjectName, fromDate: adj.fromDate, toDate: adj.toDate },
      timestamp: now,
    });

    const span = adj.fromDate === adj.toDate ? adj.fromDate : `${adj.fromDate} to ${adj.toDate}`;
    const message = `The adjustment for ${adj.subjectName} on ${span} was cancelled by ${actorName}.`;
    const uids = new Set<string>([adj.subjectUid]);
    if (adj.coverUid) uids.add(adj.coverUid);
    for (const uid of uids) {
      if (uid !== session.uid) await notify(db, session.collegeId, uid, "STAFF_ADJUSTMENT", "Adjustment cancelled", message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[leave/staff-adjustments/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
