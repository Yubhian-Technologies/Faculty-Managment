import type { Firestore } from "firebase-admin/firestore";
import { notify, notifyRole } from "@/lib/notify";
import { emitWorkflowNotification, resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest } from "@/types/leave";

// Notifications for the post-leave certificate cycle (SL and SCL) - the
// counterpart of odProofNotify.ts. Server-only by design, kept out of
// leaveCertificate.ts, which has to stay importable from a "use client"
// component.

// Deliberately its own entity type, distinct from both "leaveRequest" (which
// decideFinalStageLeave clears on every approve/reject) and "leaveOdProof" -
// sharing either would let an unrelated later action silently dismiss a
// certificate notification still waiting to be looked at.
const CERTIFICATE_ENTITY = "leaveCertificate";

function typeLabel(request: Pick<LeaveRequest, "leaveTypeCode">): string {
  return request.leaveTypeCode ? LEAVE_TYPE_LABELS[request.leaveTypeCode] : "leave";
}

/**
 * Tells whoever approved the request that a certificate has arrived.
 *
 * Routed to the tier that approved it: the department's HOD when the HOD
 * decided it, Principal/VP when they did - same routing as OD proof.
 */
export async function notifyCertificateSubmitted(
  db: Firestore,
  collegeId: string,
  request: LeaveRequest & { id: string },
  submissionCount: number
): Promise<void> {
  const title = `${typeLabel(request)} Certificate Submitted`;
  const message = `${request.employeeName} attached a certificate for ${request.totalDays} day(s) of ${typeLabel(request)}.`;

  if (request.hodAction && request.department) {
    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments")
      .where("name", "==", request.department).limit(1).get();
    const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
    if (hodUid) {
      await emitWorkflowNotification({
        db,
        collegeId,
        toUid: hodUid,
        type: "LEAVE_CERTIFICATE_PENDING_VERIFICATION",
        title,
        message,
        link: "/hod/leave-approvals",
        entityType: CERTIFICATE_ENTITY,
        entityId: request.id,
        // Same reasoning as OD proof's dedupeKey: without the attempt number a
        // re-upload after a rejection would be silently swallowed.
        dedupeKey: `leave-certificate:${request.id}:${submissionCount}:${hodUid}`,
      });
      return;
    }
  }

  // Approved at the Principal tier, or a department with no sitting HOD.
  await notifyRole(db, collegeId, "PRINCIPAL", "LEAVE_CERTIFICATE_PENDING_VERIFICATION", title, message, "/principal/leave-approvals");
  await notifyRole(db, collegeId, "VICE_PRINCIPAL", "LEAVE_CERTIFICATE_PENDING_VERIFICATION", title, message, "/principal/leave-approvals");
}

/**
 * Tells the requester the outcome, and clears the approver's pending item.
 *
 * The link is role-agnostic (/leave/certificate/[id] is outside every role
 * folder), so it works for whichever dashboard the requester happens to use.
 */
export async function notifyCertificateDecision(
  db: Firestore,
  collegeId: string,
  request: LeaveRequest & { id: string },
  verified: boolean,
  reason?: string
): Promise<void> {
  await resolveWorkflowNotifications({
    db,
    collegeId,
    entityType: CERTIFICATE_ENTITY,
    entityId: request.id,
  });

  if (verified) {
    await notify(db, collegeId, request.uid, "LEAVE_CERTIFICATE_VERIFIED",
      `${typeLabel(request)} Certificate Verified`,
      "Your certificate was verified.",
      `/leave/certificate/${request.id}`);
    return;
  }

  await notify(db, collegeId, request.uid, "LEAVE_CERTIFICATE_REJECTED",
    `${typeLabel(request)} Certificate Rejected`,
    `Your certificate was rejected${reason?.trim() ? `: ${reason.trim()}` : "."} Please re-upload it.`,
    `/leave/certificate/${request.id}`);
}

/**
 * Manual nudge for an SCL request whose certificate is still outstanding once
 * the period has ended - SL is never chased (optional), so this is only ever
 * called for SCL. Mirrors notifyODProofSubmitted's routing, but fires BEFORE
 * anything has been uploaded rather than after.
 */
export async function notifyCertificateRequested(
  db: Firestore,
  collegeId: string,
  request: LeaveRequest & { id: string },
  requestedByLabel: string
): Promise<void> {
  await notify(
    db, collegeId, request.uid, "LEAVE_CERTIFICATE_REQUESTED_BY_HOD",
    `Upload requested: ${typeLabel(request)} certificate`,
    `${requestedByLabel} has requested you to upload your ${typeLabel(request)} certificate.`,
    `/leave/certificate/${request.id}`
  );
}
