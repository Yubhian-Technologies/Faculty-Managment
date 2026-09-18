import type { Firestore } from "firebase-admin/firestore";
import { notify, notifyRole } from "@/lib/notify";
import { emitWorkflowNotification, resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";
import { evaluateODProof } from "./odProof";
import type { LeaveRequest } from "@/types/leave";

// Notifications for the On Duty proof cycle. Server-only by design - kept out
// of odProof.ts, which has to stay importable from a "use client" component.

// Deliberately NOT "leaveRequest": decideFinalStageLeave calls
// resolveWorkflowNotifications({ entityType: "leaveRequest", entityId }) on
// every approve/reject, which clears EVERY workflow notification for that id.
// Sharing the entity type would let a later decision on the same request
// silently dismiss a proof still waiting to be looked at.
const OD_PROOF_ENTITY = "leaveOdProof";

function formatDate(d: Date | null): string {
  return d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
}

/**
 * Tells whoever has to verify it that proof has arrived.
 *
 * Routed to the tier that approved the request: the department's HOD when the
 * HOD decided it, Principal/VP when they did. Mirrors how CANCEL already finds
 * the HOD via the department doc's hodUid.
 */
export async function notifyODProofSubmitted(
  db: Firestore,
  collegeId: string,
  request: LeaveRequest & { id: string },
  submissionCount: number
): Promise<void> {
  const title = "On Duty Proof Submitted";
  const message = `${request.employeeName} uploaded proof of duty for ${request.totalDays} day(s) of On Duty leave.`;

  if (request.hodAction && request.department) {
    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments")
      .where("name", "==", request.department).limit(1).get();
    const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
    if (hodUid) {
      await emitWorkflowNotification({
        db,
        collegeId,
        toUid: hodUid,
        type: "LEAVE_OD_PROOF_PENDING_VERIFICATION",
        title,
        message,
        link: "/hod/leave-approvals",
        entityType: OD_PROOF_ENTITY,
        entityId: request.id,
        // The attempt number is what makes a re-upload after a rejection reach
        // the approver at all: emitWorkflowNotification is idempotent on this
        // key, so a fixed one would be silently swallowed the second time.
        dedupeKey: `leave-od-proof:${request.id}:${submissionCount}:${hodUid}`,
      });
      return;
    }
  }

  // Approved at the Principal tier, or a department with no sitting HOD.
  await notifyRole(db, collegeId, "PRINCIPAL", "LEAVE_OD_PROOF_PENDING_VERIFICATION", title, message, "/principal/leave-approvals");
  await notifyRole(db, collegeId, "VICE_PRINCIPAL", "LEAVE_OD_PROOF_PENDING_VERIFICATION", title, message, "/principal/leave-approvals");
}

/**
 * Tells the requester the outcome, and clears the approver's pending item.
 *
 * The link is role-agnostic (/leave/od-proof/[id] is outside every role
 * folder), so it works for whichever dashboard the requester happens to use.
 */
export async function notifyODProofDecision(
  db: Firestore,
  collegeId: string,
  request: LeaveRequest & { id: string },
  verified: boolean,
  reason?: string
): Promise<void> {
  await resolveWorkflowNotifications({
    db,
    collegeId,
    entityType: OD_PROOF_ENTITY,
    entityId: request.id,
  });

  if (verified) {
    await notify(db, collegeId, request.uid, "LEAVE_OD_PROOF_VERIFIED",
      "On Duty Proof Verified",
      `Your proof of duty was verified — these ${request.totalDays} day(s) of On Duty leave remain paid.`,
      `/leave/od-proof/${request.id}`);
    return;
  }

  const dueBy = formatDate(evaluateODProof(request).proofDueBy);
  await notify(db, collegeId, request.uid, "LEAVE_OD_PROOF_REJECTED",
    "On Duty Proof Rejected",
    `Your proof of duty was rejected${reason?.trim() ? `: ${reason.trim()}` : "."} Re-upload it${dueBy ? ` before ${dueBy}` : ""} or these days will be treated as Loss of Pay.`,
    `/leave/od-proof/${request.id}`);
}
