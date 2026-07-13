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

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const budgetId = searchParams.get("budgetId");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeFundAllocations")
      .orderBy("createdAt", "desc")
      .get();

    let allocations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (budgetId) allocations = allocations.filter((a) => (a as { budgetId?: string }).budgetId === budgetId);

    return NextResponse.json({ allocations });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-fund-allocations GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      budgetId: string;
      targetType: "DEPARTMENT" | "PROJECT" | "EVENT" | "PURCHASE";
      targetName: string;
      amount: number;
    };

    const { budgetId, targetType, targetName, amount } = body;
    if (!budgetId || !targetType || !targetName || !amount) {
      return NextResponse.json(
        { error: "budgetId, targetType, targetName, amount required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const budgetRef = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgets")
      .doc(budgetId);
    const budgetSnap = await budgetRef.get();
    if (!budgetSnap.exists) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }
    const budget = budgetSnap.data() as { allocatedAmount: number; utilizedAmount: number };
    const available = budget.allocatedAmount - budget.utilizedAmount;
    if (Number(amount) > available) {
      return NextResponse.json(
        { error: `Allocation exceeds remaining budget balance (available: ${available})` },
        { status: 400 }
      );
    }

    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeFundAllocations")
      .add({
        collegeId: session.collegeId,
        budgetId,
        targetType,
        targetName,
        amount: Number(amount),
        remainingAmount: Number(amount),
        status: "ACTIVE",
        history: [],
        createdBy: session.uid,
        createdByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await budgetRef.update({ utilizedAmount: budget.utilizedAmount + Number(amount), updatedAt: now });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "FUND_ALLOCATED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { budgetId, targetType, targetName, amount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-fund-allocations POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
