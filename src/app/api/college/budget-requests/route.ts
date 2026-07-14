export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import { normalizeBudgetRequest, type BudgetCategoryGroup, type BudgetRequest } from "@/types";

async function getUser(db: Firestore, collegeId: string, uid: string): Promise<{ name: string; department: string }> {
  try {
    const snap = await db.collection("colleges").doc(collegeId).collection("users").doc(uid).get();
    const data = snap.data() as { name?: string; department?: string } | undefined;
    return { name: data?.name ?? "Unknown", department: data?.department ?? "" };
  } catch {
    return { name: "Unknown", department: "" };
  }
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL", "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("budgetRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => normalizeBudgetRequest({ id: d.id, ...d.data() } as BudgetRequest));

    if (session.role === "HOD") {
      requests = requests.filter((r) => (r as { hodUid?: string }).hodUid === session.uid);
    }
    if (status) {
      requests = requests.filter((r) => (r as { status?: string }).status === status);
    }

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      academicYear: string;
      title: string;
      requestDate?: string;
      nonRecurring?: BudgetCategoryGroup[];
      recurring?: BudgetCategoryGroup[];
    };

    const { academicYear, title } = body;
    const nonRecurring = Array.isArray(body.nonRecurring) ? body.nonRecurring : [];
    const recurring = Array.isArray(body.recurring) ? body.recurring : [];
    const allGroups = [...nonRecurring, ...recurring];

    if (!academicYear || !title || allGroups.length === 0) {
      return NextResponse.json(
        { error: "academicYear, title, and at least one category with items are required" },
        { status: 400 }
      );
    }
    if (allGroups.some((g) => !g.category || !Array.isArray(g.items) || g.items.length === 0)) {
      return NextResponse.json(
        { error: "Every category must have a name and at least one item" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const { name: hodName, department } = await getUser(db, session.collegeId, session.uid);
    if (!department) {
      return NextResponse.json(
        { error: "Your profile has no department set. Contact your administrator before submitting a budget request." },
        { status: 400 }
      );
    }
    const now = new Date();

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("budgetRequests")
      .add({
        collegeId: session.collegeId,
        hodUid: session.uid,
        hodName,
        department,
        academicYear: academicYear.trim(),
        title: title.trim(),
        requestDate: body.requestDate ?? now.toISOString(),
        nonRecurring,
        recurring,
        status: "PENDING_PRINCIPAL_VERIFICATION",
        history: [],
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "BUDGET_REQUEST_SUBMITTED",
      performedBy: session.uid,
      performedByName: hodName,
      targetId: ref.id,
      details: { title, department },
      timestamp: now,
    });

    const principalsSnap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("users")
      .where("role", "==", "PRINCIPAL")
      .get();

    const batch = db.batch();
    for (const p of principalsSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      batch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: p.id,
        type: "BUDGET_REQUEST_SUBMITTED",
        title: "New Budget Request",
        message: `${hodName} submitted a budget request "${title}" for ${department}.`,
        link: "/principal/budget",
        read: false,
        createdAt: now,
      });
    }
    await batch.commit();

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
