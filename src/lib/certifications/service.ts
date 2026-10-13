import type { Firestore } from "firebase-admin/firestore";
import type { CertificateRequest, CertificateSectionOverviewRow } from "@/types";
import { loadStudentByUid } from "@/lib/studentPermissions/service";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { canHodEditDepartment, getHodDepartmentScope } from "@/lib/departments/scope";
import { getCertificateTypeDef } from "./certificateTypes";
import { resolveRecipientUids } from "./configStore";
import { resolvePurpose } from "./purposes";
import {
  buildInitialStep, cancelRequest as txCancel, CERTIFICATE_REQUESTS_COL, decideParallelBranch, decideSequentialStep,
  issueCertificate as txIssue, markExamCellIssued as txMarkExamCellIssued, rejectAtIssuance as txReject,
} from "./transitions";
import { CertificationError } from "./types";
import type { ActingUser } from "./types";
import * as notifications from "./notifications";

const ACTIVE_STATUSES: readonly string[] = ["IN_PROGRESS", "PENDING_ISSUANCE"];

type StoredRequest = Omit<CertificateRequest, "id">;
const row = (d: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): CertificateRequest =>
  ({ id: d.id, ...(d.data() as StoredRequest) });

function byCreatedDesc(a: CertificateRequest, b: CertificateRequest): number {
  const toMs = (r: CertificateRequest) => (r.createdAt as unknown as { toMillis(): number }).toMillis();
  return toMs(b) - toMs(a);
}

const actorOf = (user: ActingUser) => ({ uid: user.uid, name: user.name, collegeId: user.collegeId, role: user.role });

export async function submitRequest(
  db: Firestore, user: ActingUser, raw: unknown
): Promise<{ alreadyExists: boolean; request: CertificateRequest }> {
  const body = raw as { reason?: unknown; purposeCode?: unknown; purposeOther?: unknown } | null;
  const reason = typeof body?.reason === "string" ? (body.reason.trim() || undefined) : undefined;
  let purposeCode: string, purpose: string;
  try {
    ({ purposeCode, purpose } = resolvePurpose(body?.purposeCode, body?.purposeOther));
  } catch (e) {
    throw new CertificationError("INVALID", e instanceof Error ? e.message : "Invalid purpose", 400);
  }

  const student = await loadStudentByUid(db, user.collegeId, user.uid);
  if (!student) throw new CertificationError("INVALID", "Your login isn't linked to a student record yet. Please contact your College Office.", 400);

  const col = CERTIFICATE_REQUESTS_COL(db, user.collegeId);
  const existingSnap = await col.where("studentId", "==", student.id).where("certificateTypeKey", "==", "NO_DUE").get();
  const existing = existingSnap.docs.map(row);
  const issued = existing.find((r) => r.status === "ISSUED");
  if (issued) return { alreadyExists: true, request: issued };
  const active = existing.find((r) => ACTIVE_STATUSES.includes(r.status));
  if (active) return { alreadyExists: true, request: active };

  const typeDef = getCertificateTypeDef("NO_DUE");
  const { steps, pendingRecipientUids } = await buildInitialStep(db, user.collegeId, typeDef.flow, student.department);
  const now = new Date();

  const data: StoredRequest = {
    collegeId: user.collegeId, certificateTypeKey: "NO_DUE", certificateTypeLabel: typeDef.label,
    requesterUid: user.uid, requesterName: user.name, purposeCode, purpose,
    studentId: student.id, studentRollNumber: student.rollNumber, studentName: student.name,
    studentDepartment: student.department, studentYear: student.year, studentSection: student.section,
    status: "IN_PROGRESS", flow: typeDef.flow, currentStepIndex: 0, steps, pendingRecipientUids,
    history: [{ action: "SUBMITTED", byUid: user.uid, byName: user.name, byRole: user.role, at: now, ...(reason ? { detail: reason } : {}) }],
    createdAt: now, updatedAt: now,
  } as unknown as StoredRequest;

  const ref = await col.add(data);
  const request: CertificateRequest = { id: ref.id, ...data };

  await writeAuditLogSafe(db, user.collegeId, {
    action: "CERTIFICATE_REQUEST_SUBMITTED", performedBy: user.uid, performedByName: user.name, targetId: ref.id, details: { student: student.name },
  });
  await notifications.notifyNewStep(
    db, user.collegeId, request,
    "No Due Certificate - verification needed",
    `${student.name} (${student.rollNumber}) has requested a No Due Certificate.`,
    "/hod/certificate-requests",
    "certificateRequest"
  );

  return { alreadyExists: false, request };
}

async function notifyExamCellIfSeeded(db: Firestore, collegeId: string, updated: CertificateRequest): Promise<void> {
  if (updated.examCellTask?.status !== "PENDING") return;
  const examCellUids = await resolveRecipientUids(db, collegeId, { kind: "ROLE", role: "EXAM_CELL" }, { studentDepartment: updated.studentDepartment });
  for (const uid of examCellUids) await notifications.notifyExamCell(db, collegeId, updated, uid);
}

export async function decide(
  db: Firestore, user: ActingUser, id: string, action: "APPROVE" | "REJECT", remarks?: string, branchKey?: string
): Promise<CertificateRequest> {
  const current = await getRequest(db, user, id);
  const step = current.flow[current.currentStepIndex];

  if (step.type === "SEQUENTIAL") {
    const updated = await decideSequentialStep(db, user.collegeId, id, action, actorOf(user), remarks);
    await notifications.resolveHodNotifications(db, user.collegeId, id);
    if (updated.status === "REJECTED") {
      await notifications.notifyStudent(
        db, user.collegeId, updated.requesterUid, "CERTIFICATE_HOD_REJECTED", "No Due Certificate rejected",
        `${step.label} rejected your No Due Certificate request.${remarks ? " Remarks: " + remarks : ""}`
      );
    } else if (updated.status === "PENDING_ISSUANCE") {
      // Flow exhausted (the College Office fee-check step just approved):
      // notify the issuer AND, in parallel, Exam Cell for PC/CMM.
      for (const uid of updated.pendingRecipientUids) await notifications.notifyIssuer(db, user.collegeId, updated, uid);
      await notifyExamCellIfSeeded(db, user.collegeId, updated);
    } else {
      const nextStep = updated.flow[updated.currentStepIndex];
      if (nextStep?.type === "PARALLEL") {
        for (const branch of nextStep.branches) {
          const uids = await resolveRecipientUids(db, user.collegeId, branch.recipient, { studentDepartment: updated.studentDepartment });
          await notifications.notifyBranchRecipients(
            db, user.collegeId, updated, branch.key, uids, "No Due Certificate - clearance needed",
            `${updated.studentName} (${updated.studentRollNumber}) needs your department's clearance for a No Due Certificate.`,
            "/college-office/certificates"
          );
        }
      } else if (nextStep?.type === "SEQUENTIAL") {
        await notifications.notifyNewStep(
          db, user.collegeId, updated, `No Due Certificate - ${nextStep.label.toLowerCase()} needed`,
          `${updated.studentName} (${updated.studentRollNumber}) needs ${nextStep.label.toLowerCase()}.`,
          "/college-office/certificates", "certificateRequest"
        );
      }
    }
    return updated;
  }

  if (!branchKey) throw new CertificationError("INVALID", "branchKey is required for this decision", 400);
  const updated = await decideParallelBranch(db, user.collegeId, id, branchKey, action === "APPROVE" ? "ACCEPT" : "REJECT", actorOf(user), remarks);
  await notifications.resolveBranchNotifications(db, user.collegeId, id, branchKey);
  if (updated.status === "REJECTED") {
    await notifications.notifyStudent(
      db, user.collegeId, updated.requesterUid, "CERTIFICATE_CLEARANCE_REJECTED", "No Due Certificate rejected",
      `Your No Due Certificate request was rejected during department clearance.${remarks ? " Remarks: " + remarks : ""}`
    );
  } else if (updated.status === "PENDING_ISSUANCE") {
    for (const uid of updated.pendingRecipientUids) await notifications.notifyIssuer(db, user.collegeId, updated, uid);
    await notifyExamCellIfSeeded(db, user.collegeId, updated);
  } else if (updated.currentStepIndex > current.currentStepIndex) {
    // Every clearance branch accepted - advanced to the next step (the
    // College Office fee-check), still IN_PROGRESS.
    const nextStep = updated.flow[updated.currentStepIndex];
    if (nextStep?.type === "SEQUENTIAL") {
      await notifications.notifyNewStep(
        db, user.collegeId, updated, `No Due Certificate - ${nextStep.label.toLowerCase()} needed`,
        `${updated.studentName} (${updated.studentRollNumber}) needs ${nextStep.label.toLowerCase()}.`,
        "/college-office/certificates", "certificateRequest"
      );
    }
  }
  return updated;
}

export async function issue(db: Firestore, user: ActingUser, id: string, certificateUrl: string, certificateNumber: string): Promise<CertificateRequest> {
  const updated = await txIssue(db, user.collegeId, id, actorOf(user), certificateUrl, certificateNumber);
  await notifications.resolveIssuanceNotifications(db, user.collegeId, id);
  await notifications.notifyStudent(
    db, user.collegeId, updated.requesterUid, "CERTIFICATE_ISSUED", "No Due Certificate issued",
    "Your No Due Certificate has been issued. Download it from Certificate Management.", certificateUrl
  );
  return updated;
}

export async function rejectAtIssuance(db: Firestore, user: ActingUser, id: string, remarks: string): Promise<CertificateRequest> {
  const updated = await txReject(db, user.collegeId, id, actorOf(user), remarks);
  await notifications.resolveIssuanceNotifications(db, user.collegeId, id);
  await notifications.notifyStudent(
    db, user.collegeId, updated.requesterUid, "CERTIFICATE_REJECTED", "No Due Certificate rejected",
    `College Office rejected your No Due Certificate request. Remarks: ${remarks}`
  );
  return updated;
}

export const cancel = (db: Firestore, user: ActingUser, id: string): Promise<CertificateRequest> =>
  txCancel(db, user.collegeId, id, actorOf(user));

export async function markExamCellIssued(db: Firestore, user: ActingUser, id: string): Promise<CertificateRequest> {
  const updated = await txMarkExamCellIssued(db, user.collegeId, id, actorOf(user));
  await notifications.notifyStudent(
    db, user.collegeId, updated.requesterUid, "CERTIFICATE_EXAM_CELL_ISSUED", "PC & CMM issued",
    "Your Provisional Certificate and Consolidated Marks Memo have been issued by the Exam Cell."
  );
  return updated;
}

/** Requests whose Exam Cell PC/CMM task is still pending - independent of the main flow's status. */
export async function listExamCellQueue(db: Firestore, user: ActingUser): Promise<CertificateRequest[]> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).where("examCellTask.status", "==", "PENDING").get();
  return snap.docs.map(row).sort(byCreatedDesc);
}

export async function listMine(db: Firestore, user: ActingUser): Promise<CertificateRequest[]> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).where("requesterUid", "==", user.uid).get();
  return snap.docs.map(row).sort(byCreatedDesc);
}

/**
 * Every certificate request filed by a student in the HOD's own department(s)
 * - not just the ones currently waiting on this HOD's own decision (that's
 * listInbox) - bucketed per section into "still moving through the flow"
 * (IN_PROGRESS/PENDING_ISSUANCE) and "issued". Scoped the same way
 * configStore's STUDENT_DEPARTMENT_HOD resolver checks a single student -
 * run over every request instead - so a sub-HOD or a shared-year manager
 * sees exactly the sections they actually head, same as everywhere else.
 */
export async function listDepartmentOverview(db: Firestore, user: ActingUser): Promise<CertificateSectionOverviewRow[]> {
  const scope = await getHodDepartmentScope(db, user.collegeId, user.uid, { activeOnly: false });
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).get();
  const mine = snap.docs.map(row).filter((r) => canHodEditDepartment(scope, r.studentDepartment));

  const bySection = new Map<string, CertificateSectionOverviewRow>();
  for (const r of mine) {
    const key = `${r.studentDepartment} ${r.studentYear} ${r.studentSection}`;
    const entry = bySection.get(key) ?? { department: r.studentDepartment, year: r.studentYear, section: r.studentSection, inProgress: 0, completed: 0 };
    if (r.status === "ISSUED") entry.completed += 1;
    else if (ACTIVE_STATUSES.includes(r.status)) entry.inProgress += 1;
    bySection.set(key, entry);
  }
  return Array.from(bySection.values()).sort((a, b) => a.year - b.year || a.department.localeCompare(b.department) || a.section.localeCompare(b.section));
}

export async function listInbox(db: Firestore, user: ActingUser): Promise<CertificateRequest[]> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId)
    .where("pendingRecipientUids", "array-contains", user.uid).where("status", "==", "IN_PROGRESS").get();
  return snap.docs.map(row).sort(byCreatedDesc);
}

export async function listIssuanceQueue(db: Firestore, user: ActingUser): Promise<CertificateRequest[]> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId)
    .where("pendingRecipientUids", "array-contains", user.uid).where("status", "==", "PENDING_ISSUANCE").get();
  return snap.docs.map(row).sort(byCreatedDesc);
}

/** Same answer for "doesn't exist" and "not yours" so ids can't be probed. */
export async function getRequest(db: Firestore, user: ActingUser, id: string): Promise<CertificateRequest> {
  const snap = await CERTIFICATE_REQUESTS_COL(db, user.collegeId).doc(id).get();
  if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
  const req = row(snap);
  const canView =
    req.requesterUid === user.uid ||
    req.pendingRecipientUids.includes(user.uid) ||
    req.issuedByUid === user.uid ||
    req.history.some((h) => h.byUid === user.uid);
  if (!canView) throw new CertificationError("NOT_FOUND", "Request not found", 404);
  return req;
}
