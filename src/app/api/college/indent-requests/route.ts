export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Firestore } from "firebase-admin/firestore";
import type { IndentItem, IndentRequest, IndentRequestType } from "@/types";

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
    const session = await requireCollegeContext(request, "HOD", "PURCHASE_DEPT", "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("indentRequests")
      .orderBy("createdAt", "desc")
      .get();

    let requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as IndentRequest);

    if (session.role === "HOD") {
      requests = requests.filter((r) => r.hodUid === session.uid);
    }
    if (status) {
      requests = requests.filter((r) => r.status === status);
    }

    return NextResponse.json({ requests });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/indent-requests GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, "HOD", "SUPER_ADMIN");
    const body = (await request.json()) as {
      title: string;
      category: string;
      requestType: IndentRequestType;
      items: IndentItem[];
    };

    const { title, category, requestType } = body;
    const items = Array.isArray(body.items) ? body.items : [];

    if (!title || !category || items.length === 0) {
      return NextResponse.json(
        { error: "title, category, and at least one item are required" },
        { status: 400 }
      );
    }
    if (requestType !== "GOODS" && requestType !== "NON_GOODS") {
      return NextResponse.json(
        { error: "requestType must be GOODS or NON_GOODS" },
        { status: 400 }
      );
    }
    if (items.some((i) => !i.description || !(i.quantity > 0) || i.estimatedUnitPrice < 0)) {
      return NextResponse.json(
        { error: "Every item needs a description, a quantity greater than 0, and a non-negative estimated price" },
        { status: 400 }
      );
    }

    const db = getAdminDb();
    const { name: hodName, department } = await getUser(db, session.collegeId, session.uid);
    if (!department) {
      return NextResponse.json(
        { error: "Your profile has no department set. Contact your administrator before raising an indent." },
        { status: 400 }
      );
    }

    const now = new Date();
    // GOODS indents go to Purchase Dept for quotation sourcing; NON_GOODS skip
    // straight to Finance for direct approval (see IndentStatus in src/types/indent.ts).
    const isGoods = requestType === "GOODS";
    const initialStatus = isGoods ? "PENDING_PURCHASE_REVIEW" : "PENDING_FINANCE_REVIEW";

    const ref = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("indentRequests")
      .add({
        collegeId: session.collegeId,
        hodUid: session.uid,
        hodName,
        department,
        title: title.trim(),
        category,
        requestType,
        items,
        status: initialStatus,
        quotations: [],
        history: [],
        createdAt: now,
        updatedAt: now,
      });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "INDENT_SUBMITTED",
      performedBy: session.uid,
      performedByName: hodName,
      targetId: ref.id,
      details: { title, department, requestType },
      timestamp: now,
    });

    // PURCHASE_DEPT and FINANCE are GLOBAL roles (systemUsers), not in the college users subcollection.
    const notifyRoleName = isGoods ? "PURCHASE_DEPT" : "FINANCE";
    const notifyLink = isGoods ? "/purchase/indents" : "/finance/indent-approvals";
    const recipientSnap = await db
      .collection("systemUsers")
      .where("role", "==", notifyRoleName)
      .get();

    const batch = db.batch();
    for (const p of recipientSnap.docs) {
      const notifRef = db.collection("colleges").doc(session.collegeId).collection("notifications").doc();
      batch.set(notifRef, {
        collegeId: session.collegeId,
        toUid: p.id,
        type: "INDENT_SUBMITTED",
        title: "New Indent Request",
        message: `${hodName} raised an indent "${title}" for ${department}.`,
        link: notifyLink,
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
    console.error("[college/indent-requests POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
