export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { normalizeBudgetRequest, type BudgetCategoryGroup, type BudgetRequest } from "@/types";
import { resolveUserProfile, scopeBudgetQueryByDepartment } from "@/lib/budget/departmentScope";
import { applySalaryStructurePricing } from "@/lib/budget/applySalaryStructurePricing";

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "FINANCE", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const baseQuery = db.collection("colleges").doc(session.collegeId).collection("budgetRequests");
    const scopedQuery = await scopeBudgetQueryByDepartment(db, baseQuery, session);
    const snap = await scopedQuery.get();

    let requests = snap.docs.map((d) => normalizeBudgetRequest({ id: d.id, ...d.data() } as BudgetRequest));

    if (status) {
      requests = requests.filter((r) => (r as { status?: string }).status === status);
    }

    // In-memory sort (avoids a composite index for where(department) + orderBy(createdAt))
    requests.sort((a, b) => toMillis((b as { createdAt?: unknown }).createdAt) - toMillis((a as { createdAt?: unknown }).createdAt));

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
    const session = await requireCollegeContext(request, "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const body = (await request.json()) as {
      academicYear: string;
      title: string;
      requestDate?: string;
      nonRecurring?: BudgetCategoryGroup[];
      recurring?: BudgetCategoryGroup[];
      isEmergency?: boolean;
      department?: string;
      emergencyReason?: string;
    };

    const isEmergencyRequester = session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL";

    if (isEmergencyRequester && !body.isEmergency) {
      return NextResponse.json(
        { error: "Only emergency budget requests can be raised from this role." },
        { status: 400 }
      );
    }
    if (!isEmergencyRequester && body.isEmergency) {
      return NextResponse.json(
        { error: "Only Principal or Vice Principal can raise an emergency budget request." },
        { status: 400 }
      );
    }

    const { academicYear, title } = body;
    const submittedNonRecurring = Array.isArray(body.nonRecurring) ? body.nonRecurring : [];
    const submittedRecurring = Array.isArray(body.recurring) ? body.recurring : [];
    const allGroups = [...submittedNonRecurring, ...submittedRecurring];

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
    const now = new Date();

    if (isEmergencyRequester) {
      const department = body.department?.trim();
      const emergencyReason = body.emergencyReason?.trim();
      if (!department || !emergencyReason) {
        return NextResponse.json(
          { error: "department and emergencyReason are required for an emergency budget request" },
          { status: 400 }
        );
      }

      // Staff-salary items are re-priced/re-counted from server-side records —
      // see applySalaryStructurePricing for why the client values aren't trusted.
      const nonRecurring = await applySalaryStructurePricing(db, session.collegeId, submittedNonRecurring, department);
      const recurring = await applySalaryStructurePricing(db, session.collegeId, submittedRecurring, department);

      if (nonRecurring.length > 0 && recurring.length > 0) {
        return NextResponse.json(
          { error: "An emergency request must use either Non-Recurring (Goods) or Recurring (Non-Goods) items, not both" },
          { status: 400 }
        );
      }
      // Server-derived, never trusted from the client.
      const emergencyType = nonRecurring.length > 0 ? "GOODS" : "NON_GOODS";
      const { name: requesterName } = await resolveUserProfile(db, session.collegeId, session.uid);

      const ref = await db
        .collection("colleges")
        .doc(session.collegeId)
        .collection("budgetRequests")
        .add({
          collegeId: session.collegeId,
          hodUid: session.uid,
          hodName: requesterName,
          department,
          academicYear: academicYear.trim(),
          title: title.trim(),
          requestDate: body.requestDate ?? now.toISOString(),
          nonRecurring,
          recurring,
          status: "PENDING_MANAGEMENT_APPROVAL",
          history: [],
          isEmergency: true,
          emergencyReason,
          emergencyType,
          createdAt: now,
          updatedAt: now,
        });

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "BUDGET_REQUEST_SUBMITTED",
        performedBy: session.uid,
        performedByName: requesterName,
        targetId: ref.id,
        details: { title, department, isEmergency: true, emergencyType },
        timestamp: now,
      });

      // Nothing to notify — Management works pull-style (visits the page to see
      // what's pending), since notifications are gated on collegeId and MANAGEMENT
      // sessions carry none.
      return NextResponse.json({ id: ref.id }, { status: 201 });
    }

    const { name: hodName, department } = await resolveUserProfile(db, session.collegeId, session.uid);
    if (!department) {
      return NextResponse.json(
        { error: "Your profile has no department set. Contact your administrator before submitting a budget request." },
        { status: 400 }
      );
    }

    // Staff-salary items are re-priced/re-counted from server-side records —
    // see applySalaryStructurePricing for why the client values aren't trusted.
    const nonRecurring = await applySalaryStructurePricing(db, session.collegeId, submittedNonRecurring, department);
    const recurring = await applySalaryStructurePricing(db, session.collegeId, submittedRecurring, department);

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
