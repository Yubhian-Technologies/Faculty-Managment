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
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) requests = requests.filter((r) => (r as { status?: string }).status === status);

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "PURCHASE_DEPT", "SUPER_ADMIN");
    const body = (await request.json()) as {
      department: string;
      requestedByName: string;
      items: string;
      estimatedAmount: number;
      budgetId?: string;
    };

    const { department, requestedByName, items, estimatedAmount, budgetId } = body;
    if (!department || !requestedByName || !items || !estimatedAmount) {
      return NextResponse.json(
        { error: "department, requestedByName, items, estimatedAmount required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .add({
        collegeId: session.collegeId,
        department,
        requestedByName,
        items,
        estimatedAmount: Number(estimatedAmount),
        budgetId: budgetId ?? null,
        status: "PENDING",
        history: [],
        loggedBy: session.uid,
        loggedByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "PURCHASE_CLEARANCE_LOGGED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { department, estimatedAmount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
