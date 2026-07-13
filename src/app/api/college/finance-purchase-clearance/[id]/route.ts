export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
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

const VALID_ACTIONS = ["APPROVED", "REJECTED", "RETURNED"];

const ACTION_TO_AUDIT: Record<string, string> = {
  APPROVED: "PURCHASE_CLEARANCE_APPROVED",
  REJECTED: "PURCHASE_CLEARANCE_REJECTED",
  RETURNED: "PURCHASE_CLEARANCE_RETURNED",
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action: "APPROVED" | "REJECTED" | "RETURNED";
      remarks?: string;
    };

    const { action, remarks } = body;
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'action must be "APPROVED", "REJECTED", or "RETURNED"' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const existing = snap.data() as { history?: unknown[] };
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const historyEntry = { action, by: session.uid, byName, at: now, ...(remarks !== undefined && { remarks }) };

    await ref.update({
      status: action,
      financeComments: remarks ?? "",
      history: [...(existing.history ?? []), historyEntry],
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: ACTION_TO_AUDIT[action],
      performedBy: session.uid,
      performedByName: byName,
      targetId: id,
      details: remarks !== undefined ? { remarks } : {},
      timestamp: now,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
