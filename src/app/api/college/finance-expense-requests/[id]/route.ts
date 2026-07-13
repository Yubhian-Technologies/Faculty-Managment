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

const ACTION_TO_AUDIT: Record<string, string> = {
  APPROVED: "EXPENSE_REQUEST_APPROVED",
  REJECTED: "EXPENSE_REQUEST_REJECTED",
  RETURNED: "EXPENSE_REQUEST_RETURNED",
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
    if (!action || !ACTION_TO_AUDIT[action]) {
      return NextResponse.json(
        { error: 'action must be "APPROVED", "REJECTED", or "RETURNED"' },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeExpenseRequests")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const expense = snap.data() as { history?: unknown[]; budgetId: string; amount: number };

    // Verify available budget balance before approving
    if (action === "APPROVED") {
      const budgetRef = db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("financeBudgets")
        .doc(expense.budgetId);
      const budgetSnap = await budgetRef.get();
      if (!budgetSnap.exists) {
        return NextResponse.json({ error: "Linked budget not found" }, { status: 404 });
      }
      const budget = budgetSnap.data() as { allocatedAmount: number; utilizedAmount: number };
      const available = budget.allocatedAmount - budget.utilizedAmount;
      if (expense.amount > available) {
        return NextResponse.json(
          { error: `Expense exceeds remaining budget balance (available: ${available})` },
          { status: 400 }
        );
      }
      await budgetRef.update({ utilizedAmount: budget.utilizedAmount + expense.amount, updatedAt: new Date() });
    }

    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();
    const historyEntry = { action, by: session.uid, byName, at: now, ...(remarks !== undefined && { remarks }) };

    await ref.update({
      status: action,
      financeRemarks: remarks ?? "",
      history: [...(expense.history ?? []), historyEntry],
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
    console.error("[college/finance-expense-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
