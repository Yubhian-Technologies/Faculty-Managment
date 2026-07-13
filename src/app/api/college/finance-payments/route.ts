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
    const type = searchParams.get("type");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePayments")
      .orderBy("createdAt", "desc")
      .get();

    let payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (status) payments = payments.filter((p) => (p as { status?: string }).status === status);
    if (type) payments = payments.filter((p) => (p as { type?: string }).type === type);

    return NextResponse.json({ payments });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-payments GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      type: "VENDOR" | "STAFF_REIMBURSEMENT" | "STUDENT_REFUND";
      payeeName: string;
      amount: number;
      purpose: string;
      relatedExpenseId?: string;
    };

    const { type, payeeName, amount, purpose, relatedExpenseId } = body;
    if (!type || !payeeName || !amount || !purpose) {
      return NextResponse.json(
        { error: "type, payeeName, amount, purpose required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePayments")
      .add({
        collegeId: session.collegeId,
        type,
        payeeName,
        amount: Number(amount),
        purpose,
        relatedExpenseId: relatedExpenseId ?? null,
        status: "PENDING",
        createdBy: session.uid,
        createdByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "PAYMENT_CREATED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { type, payeeName, amount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-payments POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
