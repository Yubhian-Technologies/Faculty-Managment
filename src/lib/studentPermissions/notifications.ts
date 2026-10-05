import type { Firestore } from "firebase-admin/firestore";
import { currentStage } from "@/lib/approvals";
import type { ApprovalRequest, EngineEvent, EventSink, StageId } from "@/lib/approvals";
import { findUsersByRoles } from "@/lib/roles/findUsersByRoles";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { notify } from "@/lib/notify";
import { PERMISSION_STAGE_LABELS, type PermissionPayload, type PermissionStage } from "./types";

// Turns engine events into in-app notifications. Best-effort by contract (the
// engine swallows anything thrown here), so a failing notification can never
// block or undo a decision.

const STAGE_LINK: Record<PermissionStage, string> = {
  CLASS_INCHARGE: "/panel/student-permissions",
  HOD: "/hod/student-permissions",
  VICE_PRINCIPAL: "/principal/student-permissions",
  PRINCIPAL: "/principal/student-permissions",
};

const requesterLink = (type: string) => (type === "STUDENT" ? "/student/permissions" : "/panel/student-permissions");

/** Login uids of whoever can act at `stage` for this request. */
async function approversOf(db: Firestore, collegeId: string, stage: StageId, req: ApprovalRequest<PermissionPayload>): Promise<string[]> {
  if (stage === "CLASS_INCHARGE") {
    const id = req.payload.inchargeUid;
    return id ? [await resolveLoginUidForFacultyMember(db, collegeId, id)] : [];
  }
  if (stage === "HOD") {
    const uids = new Set<string>();
    const dept = await db.collection("colleges").doc(collegeId).collection("departments").where("name", "==", req.scope).limit(1).get();
    const hodUid = (dept.docs[0]?.data() as { hodUid?: string } | undefined)?.hodUid;
    if (hodUid) uids.add(hodUid);
    // Department Office heads and seat-holders aren't always recorded as hodUid.
    for (const doc of await findUsersByRoles(db, collegeId, ["HOD", "DEPARTMENT_OFFICE"])) {
      const u = doc.data() as { department?: string; departments?: string[] };
      if (u.department === req.scope || u.departments?.includes(req.scope)) uids.add(doc.id);
    }
    return Array.from(uids);
  }
  if (stage === "VICE_PRINCIPAL") return (await findUsersByRoles(db, collegeId, ["VICE_PRINCIPAL"])).map((d) => d.id);
  if (stage === "PRINCIPAL") return (await findUsersByRoles(db, collegeId, ["PRINCIPAL", "COLLEGE_ADMIN", "DIRECTOR"])).map((d) => d.id);
  return [];
}

const summary = (p: PermissionPayload) =>
  `${p.title} (${p.fromDate === p.toDate ? p.fromDate : `${p.fromDate} to ${p.toDate}`}, ${p.students.length} student${p.students.length === 1 ? "" : "s"})`;

export function createPermissionEventSink(db: Firestore): EventSink<PermissionPayload> {
  return async (collegeId: string, event: EngineEvent, req: ApprovalRequest<PermissionPayload>) => {
    const p = req.payload;
    const last = req.history[req.history.length - 1];

    if (event === "SUBMITTED" || event === "ADVANCED") {
      const stage = currentStage(req);
      if (!stage) return;
      const link = STAGE_LINK[stage as PermissionStage] ?? "/principal/student-permissions";
      const who = req.requesterType === "STUDENT" ? req.requesterName : `${req.requesterName} (faculty)`;
      for (const uid of await approversOf(db, collegeId, stage, req)) {
        if (uid === req.requesterUid) continue;
        await notify(db, collegeId, uid, "STUDENT_PERMISSION_PENDING", "Permission request awaiting your decision",
          `${who}: ${summary(p)} - awaiting ${PERMISSION_STAGE_LABELS[stage as PermissionStage] ?? stage}${p.late ? " (short notice)" : ""}.`, link);
      }
      return;
    }

    const outcome: Record<string, { type: string; title: string; verb: string }> = {
      APPROVED: { type: "STUDENT_PERMISSION_APPROVED", title: "Permission approved", verb: "approved - attendance will show On Duty for the covered periods" },
      REJECTED: { type: "STUDENT_PERMISSION_REJECTED", title: "Permission rejected", verb: `rejected${last?.remark ? `: ${last.remark}` : ""}` },
      REVOKED: { type: "STUDENT_PERMISSION_REVOKED", title: "Permission withdrawn", verb: `withdrawn${last?.remark ? `: ${last.remark}` : ""}` },
      CANCELLED: { type: "STUDENT_PERMISSION_CANCELLED", title: "Permission request withdrawn", verb: "withdrawn by the requester" },
    };
    const o = outcome[event];
    if (!o) return;
    const message = `${summary(p)} was ${o.verb}.`;
    await notify(db, collegeId, req.requesterUid, o.type, o.title, message, requesterLink(req.requesterType));
    // A faculty-raised request also tells each student it covers.
    if (req.requesterType !== "STUDENT" && event !== "CANCELLED") {
      for (const s of p.students) {
        if (s.uid && s.uid !== req.requesterUid) await notify(db, collegeId, s.uid, o.type, o.title, message, "/student/permissions");
      }
    }
  };
}
