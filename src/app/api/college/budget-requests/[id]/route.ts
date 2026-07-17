export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { BudgetCategoryGroup, BudgetRequest } from "@/types";
import { budgetRequestTotal, normalizeBudgetRequest } from "@/types";
import { resolveUserName } from "@/lib/budget/departmentScope";
import { notify, notifyRole } from "@/lib/notify";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;

    const db = getAdminDb();
    const snap = await db
      .collection("colleges")
      .doc(session.collegeId)
      .collection("budgetRequests")
      .doc(id)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = normalizeBudgetRequest({ id: snap.id, ...snap.data() } as BudgetRequest);
    // Ownership (hodUid === session.uid) is strictly narrower than department
    // membership — an HOD can only ever view a request they authored, so this
    // already fully prevents cross-department access without a separate check.
    if (session.role === "HOD" && req.hodUid !== session.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ request: req });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/budget-requests/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "FINANCE", "SUPER_ADMIN");
    const { id } = await params;
    const body = (await request.json()) as {
      action?: "VERIFY" | "REJECT" | "RETURN" | "APPROVE";
      remarks?: string;
      fiscalYear?: string;
      academicYear?: string;
      title?: string;
      requestDate?: string;
      nonRecurring?: BudgetCategoryGroup[];
      recurring?: BudgetCategoryGroup[];
      department?: string;
      emergencyReason?: string;
      reportFileUrl?: string;
      reportFileName?: string;
    };

    const db = getAdminDb();
    const ref = db.collection("colleges").doc(session.collegeId).collection("budgetRequests").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const req = normalizeBudgetRequest({ id: snap.id, ...snap.data() } as BudgetRequest);
    const now = new Date();

    // ── HOD edits and resubmits a returned request ─────────────────────────

    if (session.role === "HOD") {
      // Ownership check (same rationale as GET above): strictly narrower than
      // department membership, so no separate department check is needed.
      if (req.hodUid !== session.uid) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (req.status !== "RETURNED_TO_HOD") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      const nonRecurring = Array.isArray(body.nonRecurring) ? body.nonRecurring : [];
      const recurring = Array.isArray(body.recurring) ? body.recurring : [];
      const allGroups = [...nonRecurring, ...recurring];
      if (allGroups.length === 0 || allGroups.some((g) => !g.category || !Array.isArray(g.items) || g.items.length === 0)) {
        return NextResponse.json(
          { error: "Every category must have a name and at least one item" },
          { status: 400 }
        );
      }

      const hodName = await resolveUserName(db, session.collegeId, session.uid);
      const historyEntry = {
        action: "PENDING_PRINCIPAL_VERIFICATION" as const,
        byRole: "HOD" as const,
        byUid: session.uid,
        byName: hodName,
        at: now,
      };

      await ref.update({
        academicYear: (body.academicYear ?? req.academicYear).trim(),
        title: (body.title ?? req.title).trim(),
        requestDate: body.requestDate ?? req.requestDate ?? now.toISOString(),
        nonRecurring,
        recurring,
        status: "PENDING_PRINCIPAL_VERIFICATION",
        history: [...(req.history ?? []), historyEntry],
        updatedAt: now,
      });

      const principalsSnap = await db
        .collection("colleges").doc(session.collegeId)
        .collection("users").where("role", "==", "PRINCIPAL").get();
      for (const p of principalsSnap.docs) {
        await notify(
          db, session.collegeId, p.id,
          "BUDGET_REQUEST_SUBMITTED", "Budget Request Resubmitted",
          `${hodName} resubmitted the budget request "${req.title}" for ${req.department}.`,
          "/principal/budget"
        );
      }

      return NextResponse.json({ ok: true });
    }

    // ── Emergency request owner (Principal/VP) edits and resubmits a returned
    // request. Checked before the reviewer branch below since both key off the
    // same roles — req.hodUid === session.uid (the owner resubmitting their own
    // emergency request) is what separates this from "I'm reviewing someone
    // else's request" in that branch. A VICE_PRINCIPAL who raised the emergency
    // request is never the same person reviewing a normal HOD request.

    if (
      (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") &&
      req.isEmergency &&
      req.hodUid === session.uid &&
      req.status === "RETURNED_TO_PRINCIPAL"
    ) {
      const nonRecurring = Array.isArray(body.nonRecurring) ? body.nonRecurring : [];
      const recurring = Array.isArray(body.recurring) ? body.recurring : [];
      const allGroups = [...nonRecurring, ...recurring];
      if (allGroups.length === 0 || allGroups.some((g) => !g.category || !Array.isArray(g.items) || g.items.length === 0)) {
        return NextResponse.json(
          { error: "Every category must have a name and at least one item" },
          { status: 400 }
        );
      }
      if (nonRecurring.length > 0 && recurring.length > 0) {
        return NextResponse.json(
          { error: "An emergency request must use either Non-Recurring (Goods) or Recurring (Non-Goods) items, not both" },
          { status: 400 }
        );
      }
      const department = body.department?.trim();
      const emergencyReason = body.emergencyReason?.trim();
      if (!department || !emergencyReason) {
        return NextResponse.json(
          { error: "department and emergencyReason are required for an emergency budget request" },
          { status: 400 }
        );
      }
      const emergencyType = nonRecurring.length > 0 ? "GOODS" : "NON_GOODS";

      const requesterName = await resolveUserName(db, session.collegeId, session.uid);
      const historyEntry = {
        action: "PENDING_MANAGEMENT_APPROVAL" as const,
        byRole: session.role as "PRINCIPAL" | "VICE_PRINCIPAL",
        byUid: session.uid,
        byName: requesterName,
        at: now,
      };

      await ref.update({
        department,
        emergencyReason,
        emergencyType,
        academicYear: (body.academicYear ?? req.academicYear).trim(),
        title: (body.title ?? req.title).trim(),
        requestDate: body.requestDate ?? req.requestDate ?? now.toISOString(),
        nonRecurring,
        recurring,
        status: "PENDING_MANAGEMENT_APPROVAL",
        history: [...(req.history ?? []), historyEntry],
        updatedAt: now,
      });

      return NextResponse.json({ ok: true });
    }

    // ── Principal verifies (L1 freeze) / rejects / returns ──────────────────

    if (session.role === "PRINCIPAL" || session.role === "VICE_PRINCIPAL") {
      if (req.status !== "PENDING_PRINCIPAL_VERIFICATION") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
        return NextResponse.json({ error: "remarks required" }, { status: 400 });
      }

      const principalName = await resolveUserName(db, session.collegeId, session.uid);
      const nextStatus =
        body.action === "VERIFY" ? "L1_FROZEN"
        : body.action === "REJECT" ? "PRINCIPAL_REJECTED"
        : body.action === "RETURN" ? "RETURNED_TO_HOD"
        : null;

      if (!nextStatus) {
        return NextResponse.json({ error: "action must be VERIFY, REJECT, or RETURN" }, { status: 400 });
      }

      const historyEntry = {
        action: nextStatus,
        byRole: session.role as "PRINCIPAL" | "VICE_PRINCIPAL",
        byUid: session.uid,
        byName: principalName,
        at: now,
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      await ref.update({
        status: nextStatus,
        history: [...(req.history ?? []), historyEntry],
        updatedAt: now,
      });

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: nextStatus === "L1_FROZEN" ? "BUDGET_REQUEST_VERIFIED"
          : nextStatus === "PRINCIPAL_REJECTED" ? "BUDGET_REQUEST_REJECTED"
          : "BUDGET_REQUEST_RETURNED",
        performedBy: session.uid,
        performedByName: principalName,
        targetId: id,
        details: { title: req.title, department: req.department },
        timestamp: now,
      });

      if (nextStatus === "L1_FROZEN") {
        // FINANCE is a GLOBAL role (systemUsers), not in the college users subcollection.
        const financeSnap = await db
          .collection("systemUsers").where("role", "==", "FINANCE").get();
        for (const f of financeSnap.docs) {
          await notify(
            db, session.collegeId, f.id,
            "BUDGET_REQUEST_VERIFIED", "Budget Request Ready for Review",
            `${req.title} (${req.department}) was verified by ${principalName} and is ready for Finance review.`,
            "/finance/budget-approvals"
          );
        }
      } else {
        await notify(
          db, session.collegeId, req.hodUid,
          nextStatus === "PRINCIPAL_REJECTED" ? "BUDGET_REQUEST_REJECTED" : "BUDGET_REQUEST_RETURNED",
          nextStatus === "PRINCIPAL_REJECTED" ? "Budget Request Rejected" : "Budget Request Returned",
          `${principalName} ${nextStatus === "PRINCIPAL_REJECTED" ? "rejected" : "returned"} your budget request "${req.title}".${body.remarks ? " Remarks: " + body.remarks : ""}`,
          "/hod/budget"
        );
      }

      return NextResponse.json({ ok: true });
    }

    // ── Finance uploads a report for a completed Non-Goods emergency request ──
    // View-only artifact for the requesting Principal/VP; no status change.

    if (session.role === "FINANCE" && body.action === undefined && (body.reportFileUrl || body.reportFileName)) {
      if (!req.isEmergency || req.emergencyType !== "NON_GOODS" || req.status !== "FINANCE_APPROVED") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if (!body.reportFileUrl || !body.reportFileName) {
        return NextResponse.json({ error: "reportFileUrl and reportFileName are required" }, { status: 400 });
      }

      const financeName = await resolveUserName(db, session.collegeId, session.uid);
      await ref.update({
        reportFileUrl: body.reportFileUrl,
        reportFileName: body.reportFileName,
        reportUploadedBy: session.uid,
        reportUploadedByName: financeName,
        reportUploadedAt: now,
        updatedAt: now,
      });

      await db.collection("colleges").doc(session.collegeId).collection("auditLogs").add({
        collegeId: session.collegeId,
        action: "BUDGET_REQUEST_REPORT_UPLOADED",
        performedBy: session.uid,
        performedByName: financeName,
        targetId: id,
        details: { title: req.title, department: req.department },
        timestamp: now,
      });

      await notify(
        db, session.collegeId, req.hodUid,
        "BUDGET_REQUEST_REPORT_UPLOADED", "Report Available",
        `Finance uploaded a report for your emergency budget request "${req.title}".`,
        "/principal/budget"
      );

      return NextResponse.json({ ok: true });
    }

    // ── Finance approves (auto-creates FinanceBudget) / rejects / returns ───

    if (session.role === "FINANCE") {
      if (req.status !== "L1_FROZEN") {
        return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
      }
      if (body.action === "APPROVE" && !body.fiscalYear) {
        return NextResponse.json({ error: "fiscalYear required" }, { status: 400 });
      }
      if ((body.action === "REJECT" || body.action === "RETURN") && !body.remarks) {
        return NextResponse.json({ error: "remarks required" }, { status: 400 });
      }

      const financeName = await resolveUserName(db, session.collegeId, session.uid);
      const nextStatus =
        body.action === "APPROVE" ? "FINANCE_APPROVED"
        : body.action === "REJECT" ? "FINANCE_REJECTED"
        : body.action === "RETURN" ? (req.isEmergency ? "RETURNED_TO_PRINCIPAL" : "RETURNED_TO_HOD")
        : null;

      if (!nextStatus) {
        return NextResponse.json({ error: "action must be APPROVE, REJECT, or RETURN" }, { status: 400 });
      }

      const historyEntry = {
        action: nextStatus,
        byRole: "FINANCE" as const,
        byUid: session.uid,
        byName: financeName,
        at: now,
        ...(body.remarks ? { remarks: body.remarks } : {}),
      };

      // Doc IDs can be reserved outside the transaction; the writes themselves
      // happen inside it, gated on a fresh re-read of status, so two Finance
      // users racing to approve the same request can't both create a budget.
      const budgetRef = db.collection("colleges").doc(session.collegeId).collection("financeBudgets").doc();
      const financeAuditRef = db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").doc();
      const auditRef = db.collection("colleges").doc(session.collegeId).collection("auditLogs").doc();
      const purchaseClearanceRef = db.collection("colleges").doc(session.collegeId).collection("financePurchaseClearance").doc();
      const purchaseClearanceAuditRef = db.collection("colleges").doc(session.collegeId).collection("financeAuditLogs").doc();
      let financeBudgetId: string | undefined;
      let purchaseClearanceId: string | undefined;

      await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(ref);
        const freshReq = freshSnap.data() as BudgetRequest | undefined;
        if (!freshSnap.exists || freshReq?.status !== "L1_FROZEN") {
          throw new Error("STALE_STATUS");
        }

        if (nextStatus === "FINANCE_APPROVED") {
          financeBudgetId = budgetRef.id;
          tx.set(budgetRef, {
            collegeId: session.collegeId,
            department: req.department,
            purpose: req.title,
            fiscalYear: body.fiscalYear,
            allocatedAmount: budgetRequestTotal(req),
            utilizedAmount: 0,
            status: "ACTIVE",
            revisions: [],
            createdBy: session.uid,
            createdByName: financeName,
            createdAt: now,
            updatedAt: now,
            sourceRequestId: id,
          });

          tx.set(financeAuditRef, {
            collegeId: session.collegeId,
            action: "BUDGET_CREATED",
            performedBy: session.uid,
            performedByName: financeName,
            targetId: budgetRef.id,
            details: { department: req.department, fiscalYear: body.fiscalYear, sourceRequestId: id },
            timestamp: now,
          });

          // Auto-create a linked Purchase Finance Clearance request so this
          // budget's procurement can proceed through Purchase Dept — same
          // record shape the HOD would raise manually, pre-filled and
          // pre-linked via budgetId, attributed to the same HOD who raised
          // the budget request (their uid/name are already on `req`). Starts
          // at PENDING_PURCHASE_REVIEW so it goes through the normal
          // quotation-sourcing → Finance-approval flow like any other request.
          //
          // Skipped for Non-Goods emergency requests: those have no further
          // downstream step by design — Finance attaches a report instead
          // (separate branch above), not a purchase clearance.
          if (!(req.isEmergency && req.emergencyType === "NON_GOODS")) {
            purchaseClearanceId = purchaseClearanceRef.id;
            tx.set(purchaseClearanceRef, {
              collegeId: session.collegeId,
              hodUid: req.hodUid,
              hodName: req.hodName,
              department: req.department,
              items: req.title,
              estimatedAmount: budgetRequestTotal(req),
              budgetId: budgetRef.id,
              sourceRequestId: id,
              status: "PENDING_PURCHASE_REVIEW",
              quotations: [],
              history: [],
              createdAt: now,
              updatedAt: now,
            });

            tx.set(purchaseClearanceAuditRef, {
              collegeId: session.collegeId,
              action: "PURCHASE_CLEARANCE_SUBMITTED",
              performedBy: session.uid,
              performedByName: financeName,
              targetId: purchaseClearanceRef.id,
              details: { department: req.department, estimatedAmount: budgetRequestTotal(req), sourceRequestId: id, autoCreated: true },
              timestamp: now,
            });
          }
        }

        tx.update(ref, {
          status: nextStatus,
          history: [...(freshReq?.history ?? []), historyEntry],
          ...(financeBudgetId ? { financeBudgetId } : {}),
          updatedAt: now,
        });

        tx.set(auditRef, {
          collegeId: session.collegeId,
          action: nextStatus === "FINANCE_APPROVED" ? "BUDGET_REQUEST_FINANCE_APPROVED"
            : nextStatus === "FINANCE_REJECTED" ? "BUDGET_REQUEST_FINANCE_REJECTED"
            : "BUDGET_REQUEST_RETURNED",
          performedBy: session.uid,
          performedByName: financeName,
          targetId: id,
          details: { title: req.title, department: req.department },
          timestamp: now,
        });
      });

      await notify(
        db, session.collegeId, req.hodUid,
        nextStatus === "FINANCE_APPROVED" ? "BUDGET_REQUEST_APPROVED" : nextStatus === "FINANCE_REJECTED" ? "BUDGET_REQUEST_REJECTED" : "BUDGET_REQUEST_RETURNED",
        nextStatus === "FINANCE_APPROVED" ? "Budget Request Approved" : nextStatus === "FINANCE_REJECTED" ? "Budget Request Rejected" : "Budget Request Returned",
        `Finance ${nextStatus === "FINANCE_APPROVED" ? "approved" : nextStatus === "FINANCE_REJECTED" ? "rejected" : "returned"} your budget request "${req.title}".${body.remarks ? " Remarks: " + body.remarks : ""}`,
        req.isEmergency ? "/principal/budget" : "/hod/budget"
      );

      if (purchaseClearanceId) {
        await notifyRole(
          db, session.collegeId, "PURCHASE_DEPT",
          "PURCHASE_CLEARANCE_SUBMITTED", "New Purchase Clearance Request",
          `${req.hodName} raised a purchase clearance request for "${req.title}" (${req.department}).`,
          "/purchase/indents"
        );
      }

      return NextResponse.json({ ok: true, financeBudgetId, purchaseClearanceId });
    }

    return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "STALE_STATUS") {
      return NextResponse.json({ error: "Action not permitted in current state." }, { status: 409 });
    }
    console.error("[college/budget-requests/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
