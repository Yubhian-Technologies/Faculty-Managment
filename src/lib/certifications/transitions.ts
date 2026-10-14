import type { Firestore } from "firebase-admin/firestore";
import type {
  CertificateClearance, CertificateHistoryEntry, CertificateRequest, CertificateRequestStatus, ExamCellTask, FlowStepDef, StepRuntimeState,
} from "@/types";
import { getCertificateTypeDef } from "./certificateTypes";
import { resolveRecipientUids } from "./configStore";
import { allBranchesAccepted, canDecide } from "./decisionRules";
import { CertificationError } from "./types";
import type { ActingUser } from "./types";

// The transactional core: one function per decision kind, each a single
// db.runTransaction doing fresh-read + status precondition + mutate + append
// history + atomic audit write - mirrors src/lib/budget/managementApproval.ts.

export const CERTIFICATE_REQUESTS_COL = (db: Firestore, collegeId: string) =>
  db.collection("colleges").doc(collegeId).collection("certificateRequests");

export class CertificateStateConflictError extends Error {
  readonly code = "CERTIFICATE_STATE_CONFLICT";
  constructor(message = "This request was just decided or changed by someone else - refresh and review it again.") {
    super(message);
    this.name = "CertificateStateConflictError";
  }
}

async function resolveStepPendingUids(
  db: Firestore, collegeId: string, step: FlowStepDef, studentDepartment: string
): Promise<string[]> {
  if (step.type === "SEQUENTIAL") {
    return resolveRecipientUids(db, collegeId, step.recipient, { studentDepartment });
  }
  const perBranch = await Promise.all(step.branches.map((b) => resolveRecipientUids(db, collegeId, b.recipient, { studentDepartment })));
  return Array.from(new Set(perBranch.flat()));
}

function initStepState(step: FlowStepDef): StepRuntimeState {
  if (step.type === "SEQUENTIAL") return { type: "SEQUENTIAL", status: "PENDING" };
  return { type: "PARALLEL", branches: step.branches.map((b) => ({ branchKey: b.key, branchLabel: b.label, status: "PENDING" as const })) };
}

/** The first step's runtime state + who can act on it, for a brand-new request. */
export async function buildInitialStep(
  db: Firestore, collegeId: string, flow: FlowStepDef[], studentDepartment: string
): Promise<{ steps: StepRuntimeState[]; pendingRecipientUids: string[] }> {
  const step = flow[0];
  const pendingRecipientUids = await resolveStepPendingUids(db, collegeId, step, studentDepartment);
  return { steps: [initStepState(step)], pendingRecipientUids };
}

/**
 * What comes after the current step completes: the next step, or issuance
 * if the flow is exhausted. Reaching issuance also seeds the Exam Cell's
 * PC/CMM task - it runs in PARALLEL with the College Office generating the
 * certificate PDF, tracked independently via `examCellTask` rather than as
 * another flow step, so neither one blocks the other.
 */
async function advance(
  db: Firestore, collegeId: string, req: Pick<CertificateRequest, "flow" | "currentStepIndex" | "studentDepartment" | "certificateTypeKey">, steps: StepRuntimeState[]
): Promise<{ status: CertificateRequestStatus; currentStepIndex: number; steps: StepRuntimeState[]; pendingRecipientUids: string[]; examCellTask?: ExamCellTask }> {
  const nextIndex = req.currentStepIndex + 1;
  if (nextIndex >= req.flow.length) {
    const typeDef = getCertificateTypeDef(req.certificateTypeKey);
    const issuerUids = await resolveRecipientUids(db, collegeId, typeDef.issuer, { studentDepartment: req.studentDepartment });
    return {
      status: "PENDING_ISSUANCE", currentStepIndex: req.currentStepIndex, steps, pendingRecipientUids: issuerUids,
      examCellTask: { status: "PENDING" },
    };
  }
  const nextStep = req.flow[nextIndex];
  const pendingRecipientUids = await resolveStepPendingUids(db, collegeId, nextStep, req.studentDepartment);
  return { status: "IN_PROGRESS", currentStepIndex: nextIndex, steps: [...steps, initStepState(nextStep)], pendingRecipientUids };
}

function auditRef(db: Firestore, collegeId: string) {
  return db.collection("colleges").doc(collegeId).collection("auditLogs").doc();
}

export async function decideSequentialStep(
  db: Firestore, collegeId: string, id: string, action: "APPROVE" | "REJECT", actor: ActingUser, remarks?: string
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    const step = req.flow[req.currentStepIndex];
    const current = req.steps[req.currentStepIndex];
    if (req.status !== "IN_PROGRESS" || !step || step.type !== "SEQUENTIAL" || !current || current.type !== "SEQUENTIAL" || current.status !== "PENDING") {
      throw new CertificateStateConflictError();
    }

    const resolvedUids = await resolveStepPendingUids(db, collegeId, step, req.studentDepartment);
    if (!canDecide(actor.uid, req.requesterUid, resolvedUids)) throw new CertificationError("FORBIDDEN", "You can't decide this step", 403);
    if (action === "REJECT" && !remarks) throw new CertificationError("REMARKS_REQUIRED", "Remarks are required to reject", 400);

    const decidedStep: StepRuntimeState = {
      type: "SEQUENTIAL", status: action === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedByUid: actor.uid, decidedByName: actor.name, decidedAt: now, ...(remarks ? { remarks } : {}),
    };
    const steps = [...req.steps.slice(0, req.currentStepIndex), decidedStep];

    const next = action === "REJECT"
      ? { status: "REJECTED" as const, currentStepIndex: req.currentStepIndex, steps, pendingRecipientUids: [] as string[] }
      : await advance(db, collegeId, req, steps);

    const historyEntry: CertificateHistoryEntry = {
      action: action === "APPROVE" ? "HOD_APPROVED" : "HOD_REJECTED",
      byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now, detail: step.label, ...(remarks ? { remarks } : {}),
    };
    const history = [...req.history, historyEntry];

    tx.update(ref, {
      status: next.status, currentStepIndex: next.currentStepIndex, steps: next.steps, pendingRecipientUids: next.pendingRecipientUids,
      history, updatedAt: now, ...(next.status === "REJECTED" ? { decidedAt: now } : {}),
      ...("examCellTask" in next && next.examCellTask ? { examCellTask: next.examCellTask } : {}),
    });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: action === "APPROVE" ? "CERTIFICATE_HOD_APPROVED" : "CERTIFICATE_HOD_REJECTED",
      performedBy: actor.uid, performedByName: actor.name, targetId: id, details: { step: step.label }, timestamp: now,
    });

    result = { ...req, ...next, history, updatedAt: now, ...(next.status === "REJECTED" ? { decidedAt: now } : {}) };
  });

  return result;
}

export async function decideParallelBranch(
  db: Firestore, collegeId: string, id: string, branchKey: string, action: "ACCEPT" | "REJECT", actor: ActingUser, remarks?: string
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    const step = req.flow[req.currentStepIndex];
    const current = req.steps[req.currentStepIndex];
    if (req.status !== "IN_PROGRESS" || !step || step.type !== "PARALLEL" || !current || current.type !== "PARALLEL") {
      throw new CertificateStateConflictError();
    }
    const branchDef = step.branches.find((b) => b.key === branchKey);
    const branchState = current.branches.find((b) => b.branchKey === branchKey);
    if (!branchDef || !branchState) throw new CertificationError("NOT_FOUND", "No such clearance branch on this request", 404);
    if (branchState.status !== "PENDING") throw new CertificateStateConflictError("This clearance was already decided.");

    const resolvedUids = await resolveRecipientUids(db, collegeId, branchDef.recipient, { studentDepartment: req.studentDepartment });
    if (!canDecide(actor.uid, req.requesterUid, resolvedUids)) throw new CertificationError("FORBIDDEN", "You can't decide this clearance", 403);
    if (action === "REJECT" && !remarks) throw new CertificationError("REMARKS_REQUIRED", "Remarks are required to reject", 400);

    const updatedBranches: CertificateClearance[] = current.branches.map((b) =>
      b.branchKey === branchKey
        ? { ...b, status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED", decidedByUid: actor.uid, decidedByName: actor.name, decidedAt: now, ...(remarks ? { remarks } : {}) }
        : b
    );
    const updatedStepState: StepRuntimeState = { type: "PARALLEL", branches: updatedBranches };
    const steps = [...req.steps.slice(0, req.currentStepIndex), updatedStepState];

    let next: { status: CertificateRequestStatus; currentStepIndex: number; steps: StepRuntimeState[]; pendingRecipientUids: string[] };
    if (action === "REJECT") {
      next = { status: "REJECTED", currentStepIndex: req.currentStepIndex, steps, pendingRecipientUids: [] };
    } else if (allBranchesAccepted(updatedBranches)) {
      next = await advance(db, collegeId, req, steps);
    } else {
      const stillPending = updatedBranches.filter((b) => b.status === "PENDING");
      const perBranch = await Promise.all(
        stillPending.map((b) => resolveRecipientUids(db, collegeId, step.branches.find((d) => d.key === b.branchKey)!.recipient, { studentDepartment: req.studentDepartment }))
      );
      next = { status: "IN_PROGRESS", currentStepIndex: req.currentStepIndex, steps, pendingRecipientUids: Array.from(new Set(perBranch.flat())) };
    }

    const historyEntry: CertificateHistoryEntry = {
      action: action === "ACCEPT" ? "CLEARANCE_ACCEPTED" : "CLEARANCE_REJECTED",
      byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now, detail: branchDef.label, ...(remarks ? { remarks } : {}),
    };
    const history = [...req.history, historyEntry];

    tx.update(ref, {
      status: next.status, currentStepIndex: next.currentStepIndex, steps: next.steps, pendingRecipientUids: next.pendingRecipientUids,
      history, updatedAt: now, ...(next.status === "REJECTED" ? { decidedAt: now } : {}),
      ...("examCellTask" in next && next.examCellTask ? { examCellTask: next.examCellTask } : {}),
    });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: action === "ACCEPT" ? "CERTIFICATE_CLEARANCE_ACCEPTED" : "CERTIFICATE_CLEARANCE_REJECTED",
      performedBy: actor.uid, performedByName: actor.name, targetId: id, details: { branch: branchDef.label }, timestamp: now,
    });

    result = { ...req, ...next, history, updatedAt: now, ...(next.status === "REJECTED" ? { decidedAt: now } : {}) };
  });

  return result;
}

export async function issueCertificate(
  db: Firestore, collegeId: string, id: string, actor: ActingUser, certificateUrl: string, certificateNumber: string
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (req.status !== "PENDING_ISSUANCE") throw new CertificateStateConflictError("This request isn't ready for issuance.");
    if (!canDecide(actor.uid, req.requesterUid, req.pendingRecipientUids)) throw new CertificationError("FORBIDDEN", "You can't issue this certificate", 403);

    const historyEntry: CertificateHistoryEntry = { action: "ISSUED", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now };
    const history = [...req.history, historyEntry];

    tx.update(ref, {
      status: "ISSUED", issuedByUid: actor.uid, issuedByName: actor.name, issuedAt: now,
      certificateUrl, certificateNumber, pendingRecipientUids: [], history, updatedAt: now, decidedAt: now,
    });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_ISSUED", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: { certificateNumber }, timestamp: now,
    });

    result = {
      ...req, status: "ISSUED", issuedByUid: actor.uid, issuedByName: actor.name, issuedAt: now,
      certificateUrl, certificateNumber, pendingRecipientUids: [], history, updatedAt: now, decidedAt: now,
    };
  });

  return result;
}

export async function rejectAtIssuance(db: Firestore, collegeId: string, id: string, actor: ActingUser, remarks: string): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (req.status !== "PENDING_ISSUANCE") throw new CertificateStateConflictError("This request isn't awaiting issuance.");
    if (!canDecide(actor.uid, req.requesterUid, req.pendingRecipientUids)) throw new CertificationError("FORBIDDEN", "You can't decide this", 403);
    if (!remarks) throw new CertificationError("REMARKS_REQUIRED", "Remarks are required to reject", 400);

    const historyEntry: CertificateHistoryEntry = { action: "REJECTED_AT_ISSUANCE", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now, remarks };
    const history = [...req.history, historyEntry];

    tx.update(ref, { status: "REJECTED", pendingRecipientUids: [], history, updatedAt: now, decidedAt: now });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_REJECTED_AT_ISSUANCE", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: {}, timestamp: now,
    });

    result = { ...req, status: "REJECTED", pendingRecipientUids: [], history, updatedAt: now, decidedAt: now };
  });

  return result;
}

/**
 * Exam Cell confirms PC + CMM were issued. Deliberately independent of the
 * main status/currentStepIndex machinery - no precondition on `status` at
 * all, since this task runs in parallel with (never blocked by, never
 * blocking) the College Office generating the certificate PDF.
 */
export async function markExamCellIssued(db: Firestore, collegeId: string, id: string, actor: ActingUser): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (!req.examCellTask || req.examCellTask.status !== "PENDING") {
      throw new CertificateStateConflictError("This request isn't awaiting Exam Cell right now.");
    }

    const examCellTask: ExamCellTask = { status: "ISSUED", markedByUid: actor.uid, markedByName: actor.name, markedAt: now };
    const historyEntry: CertificateHistoryEntry = { action: "EXAM_CELL_ISSUED", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now };
    const history = [...req.history, historyEntry];

    tx.update(ref, { examCellTask, history, updatedAt: now });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_EXAM_CELL_ISSUED", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: {}, timestamp: now,
    });

    result = { ...req, examCellTask, history, updatedAt: now };
  });

  return result;
}

export async function cancelRequest(db: Firestore, collegeId: string, id: string, actor: ActingUser): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (req.requesterUid !== actor.uid) throw new CertificationError("FORBIDDEN", "You can only cancel your own request", 403);
    if (req.status !== "IN_PROGRESS") throw new CertificateStateConflictError("This request can no longer be cancelled.");

    const historyEntry: CertificateHistoryEntry = { action: "CANCELLED", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now };
    const history = [...req.history, historyEntry];

    tx.update(ref, { status: "CANCELLED", pendingRecipientUids: [], history, updatedAt: now, decidedAt: now });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_CANCELLED", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: {}, timestamp: now,
    });

    result = { ...req, status: "CANCELLED", pendingRecipientUids: [], history, updatedAt: now, decidedAt: now };
  });

  return result;
}
