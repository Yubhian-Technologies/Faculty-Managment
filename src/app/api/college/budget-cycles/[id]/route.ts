export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { BudgetCycle } from "@/types";
import { resolveUserName } from "@/lib/budget/departmentScope";
import { notify } from "@/lib/notify";
import { emitWorkflowNotification, resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(
      request, "FINANCE", "PRINCIPAL", "VICE_PRINCIPAL", "HOD", "SUPER_ADMIN"
    );
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db.collection("colleges").doc(session.collegeId).collection("budgetCycles").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ cycle: { id: snap.id, ...snap.data() } as BudgetCycle });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-cycles/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as { action?: "APPROVE" | "REJECT" | "RETURN"; remarks?: string };

    if (!body.action || !["APPROVE", "REJECT", "RETURN"].includes(body.action)) {
      return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
    }
    if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
      return NextResponse.json({ error: "remarks required" }, { status: 400 });
    }

    const db = getAdminDb();
    const cycleRef = db.collection("colleges").doc(session.collegeId).collection("budgetCycles").doc(id);
    const now = new Date();
    const actorName = await resolveUserName(db, session.collegeId, session.uid);
    const nextStatus = body.action === "APPROVE" ? "APPROVED" : body.action === "REJECT" ? "REJECTED" : "RETURNED";

    // Departments created in this approval (used for notifications after commit).
    let seededDepartments: { id: string; hodUid: string }[] = [];
    let cycleTitle = "";
    let cycleFinancialYear = "";

    await db.runTransaction(async (tx) => {
      const cycleSnap = await tx.get(cycleRef);
      const cycle = cycleSnap.data() as BudgetCycle | undefined;
      if (!cycleSnap.exists || !cycle || cycle.status !== "PENDING_APPROVAL") {
        throw new Error("STALE_STATUS");
      }
      cycleTitle = cycle.title;
      cycleFinancialYear = cycle.financialYear;

      // Firestore transactions require ALL reads before ANY writes - the
      // departments query must happen here, before the tx.update/tx.set
      // calls below, not after them.
      const deptsSnap = nextStatus === "APPROVED"
        ? await tx.get(
            db.collection("colleges").doc(session.collegeId).collection("departments").where("isActive", "==", true)
          )
        : null;

      tx.update(cycleRef, {
        status: nextStatus,
        approvedBy: session.uid,
        approvedByName: actorName,
        approvedAt: now,
        ...(body.remarks ? { remarks: body.remarks } : {}),
        updatedAt: now,
      });

      const auditRef = db.collection("colleges").doc(session.collegeId).collection("auditLogs").doc();
      tx.set(auditRef, {
        collegeId: session.collegeId,
        action: nextStatus === "APPROVED" ? "BUDGET_CYCLE_APPROVED"
          : nextStatus === "REJECTED" ? "BUDGET_CYCLE_REJECTED"
          : "BUDGET_CYCLE_RETURNED",
        performedBy: session.uid,
        performedByName: actorName,
        targetId: id,
        details: { title: cycle.title, financialYear: cycle.financialYear },
        timestamp: now,
      });

      if (!deptsSnap) return;

      // Seed a PENDING_SUBMISSION budgetRequests stub for every active
      // department. Deterministic doc id (`${cycleId}_${deptId}`) + tx.create()
      // means a retried/duplicate transaction attempt can never double-create
      // a department's budget - Firestore rejects create() over an existing
      // doc. Note: Firestore transactions cap at 500 writes; this is expected
      // to comfortably cover this app's department counts.
      const budgetRequestsColl = db.collection("colleges").doc(session.collegeId).collection("budgetRequests");
      const seeded: { id: string; hodUid: string }[] = [];
      for (const deptDoc of deptsSnap.docs) {
        const dept = deptDoc.data() as { name?: string; hodUid?: string; hodName?: string };
        if (!dept.hodUid) continue; // no HOD assigned yet - nothing to notify/own this budget
        const stubRef = budgetRequestsColl.doc(`${id}_${deptDoc.id}`);
        tx.create(stubRef, {
          collegeId: session.collegeId,
          budgetCycleId: id,
          hodUid: dept.hodUid,
          hodName: dept.hodName ?? "",
          department: dept.name ?? "",
          academicYear: cycle.financialYear,
          title: cycle.title,
          requestDate: now.toISOString(),
          nonRecurring: [],
          recurring: [],
          status: "PENDING_SUBMISSION",
          history: [],
          createdAt: now,
          updatedAt: now,
        });
        seeded.push({ id: stubRef.id, hodUid: dept.hodUid });
      }
      seededDepartments = seeded;
    });

    // The Principal/VP has now acted on this cycle either way - clears their
    // "awaiting approval" login popup (emitted in the POST above), regardless
    // of which of the three outcomes this was.
    await resolveWorkflowNotifications({ db, collegeId: session.collegeId, entityType: "budgetCycle", entityId: id });

    if (nextStatus === "APPROVED") {
      for (const dept of seededDepartments) {
        await emitWorkflowNotification({
          db, collegeId: session.collegeId, toUid: dept.hodUid,
          type: "DEPARTMENT_BUDGET_PENDING",
          title: "Department Budget Due",
          message: `Prepare and submit your department's budget for "${cycleTitle}" (${cycleFinancialYear}).`,
          link: "/hod/budget",
          entityType: "budgetRequest",
          entityId: dept.id,
          dedupeKey: `budget-cycle-pending:${dept.id}`,
        });
      }
    } else {
      const cycleSnap = await cycleRef.get();
      const cycle = cycleSnap.data() as BudgetCycle;
      await notify(
        db, session.collegeId, cycle.createdBy,
        nextStatus === "REJECTED" ? "BUDGET_CYCLE_REJECTED" : "BUDGET_CYCLE_RETURNED",
        nextStatus === "REJECTED" ? "Budget Cycle Rejected" : "Budget Cycle Returned",
        `${actorName} ${nextStatus === "REJECTED" ? "rejected" : "returned"} the "${cycle.title}" budget cycle.${body.remarks ? " Remarks: " + body.remarks : ""}`,
        "/finance/budget"
      );
    }

    return NextResponse.json({ ok: true, departmentsSeeded: seededDepartments.length });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "STALE_STATUS") {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }
    console.error("[college/budget-cycles/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
