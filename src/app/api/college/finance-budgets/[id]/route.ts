export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";

async function getUserName(db: Firestore, collegeId: string, uid: string): Promise<string> {
  if (!collegeId || !uid) return "Unknown";
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action: "REVISE" | "CLOSE";
      revisedAmount?: number;
      reason?: string;
    };

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgets")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const budget = snap.data() as { allocatedAmount: number; revisions?: unknown[] };
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    if (body.action === "REVISE") {
      if (!body.revisedAmount || !body.reason) {
        return NextResponse.json({ error: "revisedAmount and reason required" }, { status: 400 });
      }
      const revision = {
        previousAmount: budget.allocatedAmount,
        revisedAmount: Number(body.revisedAmount),
        reason: body.reason,
        revisedBy: session.uid,
        revisedByName: byName,
        revisedAt: now,
      };
      await ref.update({
        allocatedAmount: Number(body.revisedAmount),
        status: "REVISED",
        revisions: [...(budget.revisions ?? []), revision],
        updatedAt: now,
      });
      await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
        collegeId: session.collegeId,
        action: "BUDGET_REVISED",
        performedBy: session.uid,
        performedByName: byName,
        targetId: id,
        details: revision,
        timestamp: now,
      });
    } else if (body.action === "CLOSE") {
      await ref.update({ status: "CLOSED", updatedAt: now });
      await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
        collegeId: session.collegeId,
        action: "BUDGET_CLOSED",
        performedBy: session.uid,
        performedByName: byName,
        targetId: id,
        timestamp: now,
      });
    } else {
      return NextResponse.json({ error: 'action must be "REVISE" or "CLOSE"' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budgets/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
