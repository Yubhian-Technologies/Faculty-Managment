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
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgetRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) requests = requests.filter((r) => (r as { status?: string }).status === status);

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budget-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      department: string;
      requestedAmount: number;
      purpose: string;
      justification?: string;
    };

    const { department, requestedAmount, purpose, justification } = body;
    if (!department || !requestedAmount || !purpose) {
      return NextResponse.json(
        { error: "department, requestedAmount, purpose required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeBudgetRequests")
      .add({
        collegeId: session.collegeId,
        department,
        requestedAmount: Number(requestedAmount),
        purpose,
        justification: justification ?? "",
        status: "PENDING",
        history: [],
        loggedBy: session.uid,
        loggedByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "BUDGET_REQUEST_LOGGED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { department, requestedAmount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-budget-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
