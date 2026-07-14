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
    const session = await requireCollegeMember("FINANCE", "PURCHASE_DEPT", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const department = searchParams.get("department");
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgets")
      .orderBy("createdAt", "desc")
      .get();

    let budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (department) budgets = budgets.filter((b) => (b as { department?: string }).department === department);
    if (status) budgets = budgets.filter((b) => (b as { status?: string }).status === status);

    return NextResponse.json({ budgets });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budgets GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      department: string;
      purpose: string;
      fiscalYear: string;
      allocatedAmount: number;
    };

    const { department, purpose, fiscalYear, allocatedAmount } = body;
    if (!department || !purpose || !fiscalYear || !allocatedAmount) {
      return NextResponse.json(
        { error: "department, purpose, fiscalYear, allocatedAmount required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgets")
      .add({
        collegeId: session.collegeId,
        department,
        purpose,
        fiscalYear,
        allocatedAmount: Number(allocatedAmount),
        utilizedAmount: 0,
        status: "ACTIVE",
        revisions: [],
        createdBy: session.uid,
        createdByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "BUDGET_CREATED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { department, fiscalYear, allocatedAmount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budgets POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
