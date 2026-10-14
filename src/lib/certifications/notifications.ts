import type { Firestore } from "firebase-admin/firestore";
import type { CertificateRequest } from "@/types";
import { notify } from "@/lib/notify";
import { emitWorkflowNotification, resolveWorkflowNotifications } from "@/lib/notifications/workflowNotifications";

// Thin wrappers over the shared notify/workflow-notification helpers. The
// per-branch entityType (`certificateBranch:${branchKey}`) is the key choice:
// it makes "the entity" mean "this request's Library clearance" specifically,
// so resolveWorkflowNotifications (which clears every actionable notification
// for one entity) never wrongly clears a sibling department's still-pending
// popup when only one of them decides.

export async function notifyNewStep(
  db: Firestore, collegeId: string, req: CertificateRequest, title: string, message: string, link: string, entityType: string
): Promise<void> {
  for (const uid of req.pendingRecipientUids) {
    await emitWorkflowNotification({
      db, collegeId, toUid: uid, type: "CERTIFICATE_FORWARDED_TO_HOD", title, message, link,
      entityType, entityId: req.id, dedupeKey: `certificate:${req.id}:${entityType}:${uid}`,
    });
  }
}

export async function notifyBranchRecipients(
  db: Firestore, collegeId: string, req: CertificateRequest, branchKey: string, uids: string[], title: string, message: string, link: string
): Promise<void> {
  for (const uid of uids) {
    await emitWorkflowNotification({
      db, collegeId, toUid: uid, type: "CERTIFICATE_CLEARANCE_REQUESTED", title, message, link,
      entityType: `certificateBranch:${branchKey}`, entityId: req.id, dedupeKey: `certificate:${req.id}:branch:${branchKey}:${uid}`,
    });
  }
}

export async function notifyExamCell(db: Firestore, collegeId: string, req: CertificateRequest, uid: string): Promise<void> {
  await emitWorkflowNotification({
    db, collegeId, toUid: uid, type: "CERTIFICATE_READY_FOR_ISSUANCE",
    title: "PC & CMM needed",
    message: `${req.studentName} (${req.studentRollNumber}) needs their Provisional Certificate and Consolidated Marks Memo issued.`,
    link: "/exam-cell/certificate-requests", entityType: "certificateExamCell", entityId: req.id, dedupeKey: `certificate:${req.id}:examcell:${uid}`,
  });
}

export async function notifyIssuer(db: Firestore, collegeId: string, req: CertificateRequest, uid: string): Promise<void> {
  await emitWorkflowNotification({
    db, collegeId, toUid: uid, type: "CERTIFICATE_READY_FOR_ISSUANCE",
    title: "No Due Certificate ready to issue",
    message: `${req.studentName} (${req.studentRollNumber})'s No Due Certificate has cleared all departments and is ready for issuance.`,
    link: "/college-office/certificates", entityType: "certificateIssuance", entityId: req.id, dedupeKey: `certificate:${req.id}:issuance:${uid}`,
  });
}

export const resolveHodNotifications = (db: Firestore, collegeId: string, requestId: string) =>
  resolveWorkflowNotifications({ db, collegeId, entityType: "certificateRequest", entityId: requestId });

export const resolveBranchNotifications = (db: Firestore, collegeId: string, requestId: string, branchKey: string) =>
  resolveWorkflowNotifications({ db, collegeId, entityType: `certificateBranch:${branchKey}`, entityId: requestId });

export const resolveIssuanceNotifications = (db: Firestore, collegeId: string, requestId: string) =>
  resolveWorkflowNotifications({ db, collegeId, entityType: "certificateIssuance", entityId: requestId });

export const notifyStudent = (
  db: Firestore, collegeId: string, toUid: string, type: string, title: string, message: string, link = "/student/certificates"
) => notify(db, collegeId, toUid, type, title, message, link);
