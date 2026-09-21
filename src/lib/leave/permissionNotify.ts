import type { Firestore } from "firebase-admin/firestore";
import { notify, notifyRole } from "@/lib/notify";
import type { PermissionRequestStatus } from "@/types/permission";

/** Only the fields these notifiers read. Deliberately not PermissionRequest:
 *  that carries Firestore Timestamps, while a just-written server object
 *  still holds plain Dates - and none of this needs either. */
interface NotifiablePermission {
  id: string;
  uid: string;
  employeeName: string;
  department?: string;
  date: string;
  fromTime: string;
  toTime: string;
  reason: string;
  status: PermissionRequestStatus;
  decisionNote?: string;
}

// Server-only. Kept out of types/permission.ts so that file stays importable
// from client components (the same split odProof / odProofNotify use).

function describe(r: NotifiablePermission): string {
  return `${r.date}, ${r.fromTime}-${r.toTime}`;
}

/** Tells whoever the request was routed to that it is waiting on them. */
export async function notifyPermissionRequested(
  db: Firestore,
  collegeId: string,
  request: NotifiablePermission
): Promise<void> {
  const title = "Permission Request";
  const message = `${request.employeeName} has requested permission for ${describe(request)} - ${request.reason}`;

  if (request.status === "PENDING_HOD" && request.department) {
    // The department's own HOD, resolved the same way the OD-proof notifier
    // does it - through the department doc rather than a role broadcast, so
    // only the right HOD is told.
    const deptSnap = await db.collection("colleges").doc(collegeId).collection("departments")
      .where("name", "==", request.department).limit(1).get();
    const hodUid = (deptSnap.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
    if (hodUid) {
      await notify(db, collegeId, hodUid, "PERMISSION_REQUESTED", title, message, "/hod/leave-approvals");
      return;
    }
    // No sitting HOD - fall through so it still reaches someone.
  }

  if (request.status === "PENDING_MANAGEMENT") {
    await notifyRole(db, collegeId, "MANAGEMENT", "PERMISSION_REQUESTED", title, message, "/management/leave-approvals");
    return;
  }

  await notifyRole(db, collegeId, "PRINCIPAL", "PERMISSION_REQUESTED", title, message, "/principal/leave-approvals");
  await notifyRole(db, collegeId, "VICE_PRINCIPAL", "PERMISSION_REQUESTED", title, message, "/principal/leave-approvals");
}

/** Tells the requester what was decided. */
export async function notifyPermissionDecision(
  db: Firestore,
  collegeId: string,
  request: NotifiablePermission,
  approved: boolean,
  deciderName: string
): Promise<void> {
  await notify(
    db,
    collegeId,
    request.uid,
    approved ? "PERMISSION_APPROVED" : "PERMISSION_REJECTED",
    approved ? "Permission Approved" : "Permission Rejected",
    `${deciderName} ${approved ? "approved" : "rejected"} your permission for ${describe(request)}.` +
      (request.decisionNote ? ` Note: ${request.decisionNote}` : "")
  );
}
