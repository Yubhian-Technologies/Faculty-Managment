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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeMember("FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      status: "PROCESSED" | "VERIFIED";
      paymentReference?: string;
    };

    if (!body.status || (body.status !== "PROCESSED" && body.status !== "VERIFIED")) {
      return NextResponse.json({ error: 'status must be "PROCESSED" or "VERIFIED"' }, { status: 400 });
    }

    const db = getAdminDb();
    const ref = db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePayments")
      .doc(id);
    const snap = await ref.get();
    if (!snap.exists || (snap.data() as { collegeId?: string })?.collegeId !== session.collegeId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const byName = await getUserName(db, session.collegeId, session.uid);
    const now = new Date();

    await ref.update({
      status: body.status,
      ...(body.paymentReference !== undefined && { paymentReference: body.paymentReference }),
      processedBy: session.uid,
      processedByName: byName,
      processedAt: now,
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").add({
      collegeId: session.collegeId,
      action: body.status === "PROCESSED" ? "PAYMENT_PROCESSED" : "PAYMENT_VERIFIED",
      performedBy: session.uid,
      performedByName: byName,
      targetId: id,
      details: body.paymentReference !== undefined ? { paymentReference: body.paymentReference } : {},
      timestamp: now,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-payments/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
