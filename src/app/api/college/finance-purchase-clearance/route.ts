export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import { notifyRole } from "@/lib/notify";

async function getUserProfile(db: Firestore, collegeId: string, uid: string): Promise<{ name: string; department: string }> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const data = snap.data() as { name?: string; department?: string } | undefined;
    return { name: data?.name ?? "Unknown", department: data?.department ?? "" };
  } catch {
    return { name: "Unknown", department: "" };
  }
}

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // HOD sees only the requests they themselves raised
    if (session.role === "HOD") {
      requests = requests.filter((r) => (r as { hodUid?: string }).hodUid === session.uid);
    }
    if (status) requests = requests.filter((r) => (r as { status?: string }).status === status);
    requests.sort((a, b) => toMillis((b as { createdAt?: unknown }).createdAt) - toMillis((a as { createdAt?: unknown }).createdAt));

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
    const session = await requireCollegeContext(request, "HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      items: string;
      estimatedAmount: number;
      budgetId?: string;
    };

    const { items, estimatedAmount, budgetId } = body;
    if (!items || !estimatedAmount) {
      return NextResponse.json({ error: "items and estimatedAmount are required" }, { status: 400 });
    }

    const db = getAdminDb();
    const { name: hodName, department } = await getUserProfile(db, session.collegeId, session.uid);
    if (!department) {
      return NextResponse.json(
        { error: "Your profile has no department set. Contact your administrator before raising a purchase request." },
        { status: 400 }
      );
    }

    const now = new Date();
    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("financePurchaseClearance")
      .add({
        collegeId: session.collegeId,
        hodUid: session.uid,
        hodName,
        department,
        items,
        estimatedAmount: Number(estimatedAmount),
        budgetId: budgetId ?? null,
        status: "PENDING_PURCHASE_REVIEW",
        quotations: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "PURCHASE_CLEARANCE_SUBMITTED",
      performedBy: session.uid,
      performedByName: hodName,
      targetId: ref.id,
      details: { department, estimatedAmount },
      timestamp: now,
    });

    await notifyRole(
      db, session.collegeId, "PURCHASE_DEPT",
      "PURCHASE_CLEARANCE_SUBMITTED", "New Purchase Clearance Request",
      `${hodName} raised a purchase clearance request for "${items}" (${department}).`,
      "/purchase/indents"
    );

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/finance-purchase-clearance POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
