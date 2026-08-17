import type { Firestore } from "firebase-admin/firestore";
import { REQUESTS_COL, commitApproval, releasePending, splitLeaveDays } from "@/lib/leave/balanceEngine";
import { LEAVE_TYPE_SEED } from "@/lib/leave/seedData";
import { notify } from "@/lib/notify";
import { resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";
import { notifySubstitutes } from "@/lib/leave/periodCoverage";
import type { LeaveRequest, LeaveActionRecord } from "@/types/leave";

export type FinalStageDecider = "PRINCIPAL" | "MANAGEMENT";

// Shared by the two "top of the chain" decision stages - Principal/Vice
// Principal on PENDING_PRINCIPAL (applications/[id]/route.ts) and Management
// on PENDING_MANAGEMENT, a Principal's own leave (management/leave-approvals/
// [id]/route.ts). Same balance-commit/release + audit + notify shape; only
// the actor's role label and which action-record field it's stamped into
// differ. Callers own their own authorization checks (role, self-approval
// guards, status match) before calling this - it assumes the decision is
// already validated as allowed.
export async function decideFinalStageLeave(params: {
  db: Firestore;
  collegeId: string;
  id: string;
  req: LeaveRequest;
  action: "APPROVE" | "REJECT";
  remarks?: string;
  decidedByUid: string;
  decidedByEmail?: string;
  decider: FinalStageDecider;
  // Other requests that reach this stage still untagged (isPaidLeave
  // undefined) - i.e. the submitter skipped the HOD stage entirely (a
  // Vice Principal's own Other leave landing at PENDING_PRINCIPAL, or a
  // Principal's own landing at PENDING_MANAGEMENT) - need this decider to
  // tag paid/unpaid themselves, since there's no HOD in the chain to have
  // done it already. Callers validate it's present before calling (see
  // applications/[id]/route.ts and management/leave-approvals/[id]/route.ts).
  // Ignored when req.isPaidLeave is already set (an HOD already tagged it).
  isPaidLeave?: boolean;
}): Promise<{ lopDays: number }> {
  const { db, collegeId, id, req, action, remarks, decidedByUid, decidedByEmail, decider, isPaidLeave } = params;
  const ref = REQUESTS_COL(collegeId, db).doc(id);
  const now = new Date();
  const year = (req.fromDate as unknown as { toDate(): Date }).toDate().getFullYear();
  const roleLabel = decider === "PRINCIPAL" ? "Principal" : "Management";
  const actionField = decider === "PRINCIPAL" ? "principalAction" : "managementAction";
  // Only newly tagged here, not an HOD-forwarded re-tag - req.isPaidLeave
  // being set already means an HOD decided it upstream.
  const newlyTaggedPaidLeave =
    action === "APPROVE" && req.isOtherRequest && req.isPaidLeave === undefined && isPaidLeave !== undefined
      ? isPaidLeave
      : undefined;

  const actionRecord: LeaveActionRecord = {
    action: action === "APPROVE" ? "APPROVED" : "REJECTED",
    by: decidedByUid, byName: decidedByEmail || roleLabel, at: now as unknown as LeaveActionRecord["at"],
    ...(remarks ? { remarks } : {}),
    ...(newlyTaggedPaidLeave !== undefined ? { isPaidLeave: newlyTaggedPaidLeave } : {}),
  };

  let lopDays = 0;
  if (action === "REJECT") {
    if (req.leaveTypeCode) {
      const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
      if (lt && !lt.rules.unlimited) {
        await releasePending(db, collegeId, req.uid, req.leaveTypeCode, year, req.totalDays);
      }
    }
    await ref.update({ status: "REJECTED", [actionField]: actionRecord, updatedAt: now });
  } else {
    // Insufficient balance never blocks this - the excess becomes Loss of Pay.
    if (req.leaveTypeCode) {
      const lt = LEAVE_TYPE_SEED.find((t) => t.code === req.leaveTypeCode);
      if (lt && !lt.rules.unlimited) {
        const split = await splitLeaveDays(db, collegeId, req.uid, lt, year, req.totalDays);
        lopDays = split.lopDays;
        if (split.withinBalance > 0) {
          await commitApproval(db, collegeId, req.uid, req.leaveTypeCode, year, split.withinBalance);
        }
      }
    }
    await ref.update({
      status: "APPROVED",
      [actionField]: actionRecord,
      lopDays,
      updatedAt: now,
      ...(newlyTaggedPaidLeave !== undefined ? { isPaidLeave: newlyTaggedPaidLeave } : {}),
    });
  }

  await db.collection("colleges").doc(collegeId).collection("auditLogs").add({
    collegeId,
    action: action === "APPROVE"
      ? (decider === "PRINCIPAL" ? "LEAVE_PRINCIPAL_APPROVED" : "LEAVE_MANAGEMENT_APPROVED")
      : "LEAVE_REJECTED",
    performedBy: decidedByUid, performedByName: decidedByEmail || roleLabel, targetId: id, details: { lopDays }, timestamp: now,
  });

  await resolveWorkflowNotifications({ db, collegeId, entityType: "leaveRequest", entityId: id });
  await notify(
    db, collegeId, req.uid,
    action === "APPROVE" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
    action === "APPROVE" ? "Leave Request Approved" : "Leave Request Rejected",
    `Your leave request for ${req.totalDays} day(s) was ${action === "APPROVE" ? "approved" : "rejected"} by ${roleLabel}` +
      (action === "APPROVE" && lopDays > 0 ? ` — ${lopDays} day(s) exceed your balance and will be treated as Loss of Pay.` : "."),
    "/panel/leave"
  );
  if (action === "APPROVE") {
    await notifySubstitutes(db, collegeId, req);
  }

  return { lopDays };
}
