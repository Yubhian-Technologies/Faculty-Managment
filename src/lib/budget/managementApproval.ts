import type { Firestore } from "firebase-admin/firestore";
import type { BudgetRequest } from "@/types";

// Shared by src/app/api/management/emergency-budget-requests/[id]/route.ts — the sole
// write path MANAGEMENT has. Kept out of the route file so both it and any future
// caller share one transaction-guarded implementation instead of duplicating it.

async function notify(
  db: Firestore,
  collegeId: string,
  toUid: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  try {
    await db.collection("colleges").doc(collegeId).collection("notifications").add({
      collegeId, toUid, type, title, message,
      read: false, link: link ?? null, createdAt: new Date(),
    });
  } catch {
    /* non-fatal */
  }
}

export type ManagementDecisionAction = "APPROVE" | "REJECT" | "RETURN";

// Throws Error with message "NOT_FOUND" | "NOT_PERMITTED" | "REMARKS_REQUIRED" | "STALE_STATUS"
export async function applyManagementDecision(
  db: Firestore,
  collegeId: string,
  id: string,
  action: ManagementDecisionAction,
  performerUid: string,
  performerName: string,
  remarks?: string
): Promise<void> {
  const ref = db.collection("colleges").doc(collegeId).collection("budgetRequests").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");

  const req = { id: snap.id, ...snap.data() } as BudgetRequest;
  if (!req.isEmergency || req.status !== "PENDING_MANAGEMENT_APPROVAL") {
    throw new Error("NOT_PERMITTED");
  }
  if ((action === "REJECT" || action === "RETURN") && !remarks) {
    throw new Error("REMARKS_REQUIRED");
  }

  const now = new Date();
  const nextStatus =
    action === "APPROVE" ? "L1_FROZEN"
    : action === "REJECT" ? "MANAGEMENT_REJECTED"
    : "RETURNED_TO_PRINCIPAL";

  const historyEntry = {
    action: nextStatus,
    byRole: "MANAGEMENT" as const,
    byUid: performerUid,
    byName: performerName,
    at: now,
    ...(remarks ? { remarks } : {}),
  };

  const auditRef = db.collection("colleges").doc(collegeId).collection("auditLogs").doc();

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(ref);
    const freshReq = freshSnap.data() as BudgetRequest | undefined;
    if (!freshSnap.exists || freshReq?.status !== "PENDING_MANAGEMENT_APPROVAL") {
      throw new Error("STALE_STATUS");
    }

    tx.update(ref, {
      status: nextStatus,
      history: [...(freshReq?.history ?? []), historyEntry],
      updatedAt: now,
    });

    tx.set(auditRef, {
      collegeId,
      action: nextStatus === "L1_FROZEN" ? "BUDGET_REQUEST_MANAGEMENT_APPROVED"
        : nextStatus === "MANAGEMENT_REJECTED" ? "BUDGET_REQUEST_MANAGEMENT_REJECTED"
        : "BUDGET_REQUEST_RETURNED",
      performedBy: performerUid,
      performedByName: performerName,
      targetId: id,
      details: { title: req.title, department: req.department },
      timestamp: now,
    });
  });

  if (nextStatus === "L1_FROZEN") {
    const financeSnap = await db
      .collection("colleges").doc(collegeId)
      .collection("users").where("role", "==", "FINANCE").get();
    for (const f of financeSnap.docs) {
      await notify(
        db, collegeId, f.id,
        "BUDGET_REQUEST_VERIFIED", "Emergency Budget Request Ready for Review",
        `${req.title} (${req.department}) was approved by Management and is ready for Finance review.`,
        "/finance/budget-approvals"
      );
    }
  } else {
    await notify(
      db, collegeId, req.hodUid,
      nextStatus === "MANAGEMENT_REJECTED" ? "BUDGET_REQUEST_REJECTED" : "BUDGET_REQUEST_RETURNED",
      nextStatus === "MANAGEMENT_REJECTED" ? "Emergency Request Rejected" : "Emergency Request Returned",
      `Management ${nextStatus === "MANAGEMENT_REJECTED" ? "rejected" : "returned"} your emergency budget request "${req.title}".${remarks ? " Remarks: " + remarks : ""}`,
      "/principal/budget"
    );
  }
}
