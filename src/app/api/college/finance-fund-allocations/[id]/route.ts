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
      remainingAmount?: number;
      status?: "ACTIVE" | "MODIFIED" | "EXHAUSTED" | "CLOSED";
      reason: string;
    };

    if (!body.reason) {
      return NextResponse.json({ error: "reason required" }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeFundAllocations")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = snap.data() as { history?: unknown[]; remainingAmount: number };
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const newRemaining = body.remainingAmount ?? existing.remainingAmount;

    await ref.update({
      remainingAmount: newRemaining,
      status: body.status ?? "MODIFIED",
      history: [
        ...(existing.history ?? []),
        { amount: newRemaining, reason: body.reason, changedBy: session.uid, changedByName: byName, changedAt: now },
      ],
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "FUND_ALLOCATION_MODIFIED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: id,
      details: { reason: body.reason, remainingAmount: newRemaining },
      timestamp: now,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-fund-allocations/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
