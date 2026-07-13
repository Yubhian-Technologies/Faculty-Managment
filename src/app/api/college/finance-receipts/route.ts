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
    const relatedType = searchParams.get("relatedType");
    const relatedId = searchParams.get("relatedId");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeReceipts")
      .orderBy("createdAt", "desc")
      .get();

    let receipts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (relatedType) receipts = receipts.filter((r) => (r as { relatedType?: string }).relatedType === relatedType);
    if (relatedId) receipts = receipts.filter((r) => (r as { relatedId?: string }).relatedId === relatedId);

    return NextResponse.json({ receipts });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-receipts GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      relatedType: "BUDGET" | "EXPENSE" | "PAYMENT" | "ALLOCATION";
      relatedId: string;
      amount: number;
      description: string;
      fileUrl?: string;
    };

    const { relatedType, relatedId, amount, description, fileUrl } = body;
    if (!relatedType || !relatedId || !amount || !description) {
      return NextResponse.json(
        { error: "relatedType, relatedId, amount, description required" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financeReceipts")
      .add({
        collegeId: session.collegeId,
        relatedType,
        relatedId,
        amount: Number(amount),
        description,
        fileUrl: fileUrl ?? null,
        verified: false,
        createdBy: session.uid,
        createdByName: byName,
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: "RECEIPT_RECORDED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: ref.id,
      details: { relatedType, relatedId, amount },
      timestamp: now,
    });

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-receipts POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
