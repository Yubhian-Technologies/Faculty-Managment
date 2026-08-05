export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { BudgetCycle, BudgetType } from "@/types";
import { emitWorkflowNotification } from "@/lib/notifications/workflowNotifications";
import type { Firestore } from "firebase-admin/firestore";

// FINANCE is a GLOBAL role — its profile lives in systemUsers/{uid}, not
// colleges/{collegeId}/users/{uid} (see src/lib/budget/departmentScope.ts's
// resolveUserName, which only checks the latter and would return "Unknown"
// here).
async function resolveFinanceName(db: Firestore, uid: string): Promise<string> {
  try {
    const snap = await db.collection("systemUsers").doc(uid).get();
    return (snap.data() as { name?: string } | undefined)?.name ?? "Finance";
  } catch {
    return "Finance";
  }
}

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

const BUDGET_TYPES: BudgetType[] = ["ANNUAL", "REVISED", "EMERGENCY"];

export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(
      request, "FINANCE", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN"
    );
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("budgetCycles").get();
    let cycles = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BudgetCycle);

    if (status) cycles = cycles.filter((c) => c.status === status);
    cycles.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

    return NextResponse.json({ cycles });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-cycles GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeContext(request, "FINANCE", "SUPER_ADMIN");
    const body = (await request.json()) as {
      title?: string;
      financialYear?: string;
      budgetType?: BudgetType;
      submissionStartDate?: string;
      submissionDeadline?: string;
      description?: string;
      attachmentUrl?: string;
      attachmentName?: string;
      allowLateSubmission?: boolean;
    };

    const title = body.title?.trim();
    const financialYear = body.financialYear?.trim();
    const budgetType = body.budgetType;
    const submissionStartDate = body.submissionStartDate;
    const submissionDeadline = body.submissionDeadline;

    if (!title || !financialYear || !budgetType || !submissionStartDate || !submissionDeadline) {
      return NextResponse.json(
        { error: "title, financialYear, budgetType, submissionStartDate, and submissionDeadline are required" },
        { status: 400 }
      );
    }
    if (!BUDGET_TYPES.includes(budgetType)) {
      return NextResponse.json({ error: "Invalid budgetType" }, { status: 400 });
    }
    if (new Date(submissionDeadline).getTime() <= new Date(submissionStartDate).getTime()) {
      return NextResponse.json({ error: "Submission deadline must be after the submission start date" }, { status: 400 });
    }

    const db = getAdminDb();
    const now = new Date();
    const createdByName = await resolveFinanceName(db, session.uid);

    const ref = await db.collection("colleges").doc(session.collegeId).collection("budgetCycles").add({
      collegeId: session.collegeId,
      title,
      financialYear,
      budgetType,
      releaseDate: now,
      submissionStartDate,
      submissionDeadline,
      description: body.description?.trim() ?? "",
      attachmentUrl: body.attachmentUrl ?? "",
      attachmentName: body.attachmentName ?? "",
      allowLateSubmission: !!body.allowLateSubmission,
      status: "PENDING_APPROVAL",
      createdBy: session.uid,
      createdByName,
      createdAt: now,
      updatedAt: now,
    });

    await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
      collegeId: session.collegeId,
      action: "BUDGET_CYCLE_RELEASED",
      performedBy: session.uid,
      performedByName: createdByName,
      targetId: ref.id,
      details: { title, financialYear, budgetType },
      timestamp: now,
    });

    // Actionable (login-popup) notification — the Principal/VP is the next
    // responsible party until they approve/reject/return it (resolved in
    // src/app/api/college/budget-cycles/[id]/route.ts on that action).
    const approversSnap = await db
      .collection("colleges").doc(session.collegeId)
      .collection("users").where("role", "in", ["PRINCIPAL", "VICE_PRINCIPAL"]).get();
    for (const u of approversSnap.docs) {
      await emitWorkflowNotification({
        db, collegeId: session.collegeId, toUid: u.id,
        type: "BUDGET_CYCLE_RELEASED",
        title: "New Budget Cycle Awaiting Approval",
        message: `${createdByName} released the "${title}" (${financialYear}) budget cycle for approval.`,
        link: "/principal/budget",
        entityType: "budgetCycle",
        entityId: ref.id,
        dedupeKey: `budget-cycle-approval:${ref.id}:${u.id}`,
      });
    }

    return NextResponse.json({ id: ref.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-cycles POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
