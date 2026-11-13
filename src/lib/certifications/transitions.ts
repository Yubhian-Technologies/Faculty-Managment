import type { Firestore } from "firebase-admin/firestore";
import type {
  CertificateClearance, CertificateHistoryEntry, CertificateRequest, CertificateRequestStatus, ExamCellTask, FlowStepDef, StepRuntimeState,
} from "@/types";
import { getCertificateTypeDef } from "./certificateTypes";
import { resolveRecipientUids, type RecipientContext } from "./configStore";
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

/** Who the student behind a request is - every resolver gets the same context. */
export const recipientContext = (req: { studentDepartment: string; studentId?: string }): RecipientContext =>
  ({ studentDepartment: req.studentDepartment, studentId: req.studentId });

export async function resolveStepPendingUids(
  db: Firestore, collegeId: string, step: FlowStepDef, ctx: RecipientContext
): Promise<string[]> {
  if (step.type === "SEQUENTIAL") {
    return resolveRecipientUids(db, collegeId, step.recipient, ctx);
  }
  const perBranch = await Promise.all(step.branches.map((b) => resolveRecipientUids(db, collegeId, b.recipient, ctx)));
  return Array.from(new Set(perBranch.flat()));
}

function initStepState(step: FlowStepDef): StepRuntimeState {
  if (step.type === "SEQUENTIAL") return { type: "SEQUENTIAL", status: "PENDING" };
  return { type: "PARALLEL", branches: step.branches.map((b) => ({ branchKey: b.key, branchLabel: b.label, status: "PENDING" as const })) };
}

/** The first step's runtime state + who can act on it, for a brand-new request. */
export async function buildInitialStep(
  db: Firestore, collegeId: string, flow: FlowStepDef[], studentDepartment: string, studentId?: string
): Promise<{ steps: StepRuntimeState[]; pendingRecipientUids: string[] }> {
  const step = flow[0];
  const pendingRecipientUids = await resolveStepPendingUids(db, collegeId, step, { studentDepartment, studentId });
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
  db: Firestore, collegeId: string, req: Pick<CertificateRequest, "flow" | "currentStepIndex" | "studentDepartment" | "certificateTypeKey" | "issuer" | "certificateTypeId" | "studentId">, steps: StepRuntimeState[]
): Promise<{ status: CertificateRequestStatus; currentStepIndex: number; steps: StepRuntimeState[]; pendingRecipientUids: string[]; examCellTask?: ExamCellTask }> {
  const nextIndex = req.currentStepIndex + 1;
  if (nextIndex >= req.flow.length) {
    // Configured types carry their issuer on the request (snapshot at submission); the prototype No Due uses its constant.
    const issuer = req.issuer ?? getCertificateTypeDef("NO_DUE").issuer;
    const issuerUids = await resolveRecipientUids(db, collegeId, issuer, recipientContext(req));
    return {
      status: "PENDING_ISSUANCE", currentStepIndex: req.currentStepIndex, steps, pendingRecipientUids: issuerUids,
      // The Exam Cell PC / CMM side task belongs to the prototype No Due flow only.
      ...(req.certificateTypeId ? {} : { examCellTask: { status: "PENDING" as const } }),
    };
  }
  const nextStep = req.flow[nextIndex];
  const pendingRecipientUids = await resolveStepPendingUids(db, collegeId, nextStep, recipientContext(req));
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

    const resolvedUids = await resolveStepPendingUids(db, collegeId, step, recipientContext(req));
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

export interface BranchOutcome {
  outcome?: "NO_DUES" | "NOT_APPLICABLE" | "APPROVED";
  result?: CertificateClearance["result"];
}

export async function decideParallelBranch(
  db: Firestore, collegeId: string, id: string, branchKey: string, action: "ACCEPT" | "REJECT", actor: ActingUser, remarks?: string,
  extra: BranchOutcome = {}
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

    const resolvedUids = await resolveRecipientUids(db, collegeId, branchDef.recipient, recipientContext(req));
    if (!canDecide(actor.uid, req.requesterUid, resolvedUids)) throw new CertificationError("FORBIDDEN", "You can't decide this clearance", 403);
    if (action === "REJECT" && !remarks) throw new CertificationError("REMARKS_REQUIRED", "Remarks are required to reject", 400);
    // A dues check is cleared (No dues / Not applicable) or marked Dues pending - never rejected.
    const check = branchDef.check ?? "APPROVAL";
    if (check === "DUES" && action === "REJECT") throw new CertificationError("INVALID", "Mark the dues as pending instead - the student can then pay and be cleared", 400);
    if (check === "DUES" && action === "ACCEPT" && extra.outcome !== "NO_DUES" && extra.outcome !== "NOT_APPLICABLE") {
      throw new CertificationError("INVALID", "Mark No dues or Not applicable", 400);
    }
    const outcome = action === "ACCEPT" ? (check === "DUES" ? extra.outcome : "APPROVED") : undefined;

    const updatedBranches: CertificateClearance[] = current.branches.map((b) =>
      b.branchKey === branchKey
        ? {
            ...b, status: action === "ACCEPT" ? "ACCEPTED" : "REJECTED", decidedByUid: actor.uid, decidedByName: actor.name, decidedAt: now,
            ...(remarks ? { remarks } : {}), ...(outcome ? { outcome } : {}), ...(extra.result ? { result: extra.result } : {}), duesPending: null,
          }
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
        stillPending.map((b) => resolveRecipientUids(db, collegeId, step.branches.find((d) => d.key === b.branchKey)!.recipient, recipientContext(req)))
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
    if (req.startedByUid) throw new CertificationError("FORBIDDEN", "The College Office started this request - it can't be cancelled here", 403);
    if (req.status !== "IN_PROGRESS" && req.status !== "RETURNED") throw new CertificateStateConflictError("This request can no longer be cancelled.");

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

/**
 * The current approver sends the request back to the student to correct (a wrong detail, a missing document) -
 * not a rejection: the step stays undecided, and once the student resubmits it comes back to the same step.
 * Parallel steps: one branch returns it; branches already accepted stay accepted.
 */
export async function returnToStudent(
  db: Firestore, collegeId: string, id: string, actor: ActingUser, remarks: string, branchKey?: string
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;
  if (!remarks) throw new CertificationError("REMARKS_REQUIRED", "Say what the student must correct", 400);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    const step = req.flow[req.currentStepIndex];
    const current = req.steps[req.currentStepIndex];
    if (req.status !== "IN_PROGRESS" || !step || !current) throw new CertificateStateConflictError();

    let label = step.label;
    if (step.type === "SEQUENTIAL") {
      if (current.type !== "SEQUENTIAL" || current.status !== "PENDING") throw new CertificateStateConflictError();
      const uids = await resolveStepPendingUids(db, collegeId, step, recipientContext(req));
      if (!canDecide(actor.uid, req.requesterUid, uids)) throw new CertificationError("FORBIDDEN", "You can't decide this step", 403);
    } else {
      const branch = step.branches.find((b) => b.key === branchKey);
      const state = current.type === "PARALLEL" ? current.branches.find((b) => b.branchKey === branchKey) : undefined;
      if (!branch || !state) throw new CertificationError("NOT_FOUND", "No such approval on this request", 404);
      if (state.status !== "PENDING") throw new CertificateStateConflictError("This approval was already decided.");
      const uids = await resolveRecipientUids(db, collegeId, branch.recipient, recipientContext(req));
      if (!canDecide(actor.uid, req.requesterUid, uids)) throw new CertificationError("FORBIDDEN", "You can't decide this approval", 403);
      label = branch.label;
    }

    const history = [...req.history, { action: "RETURNED", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now, detail: label, remarks } as CertificateHistoryEntry];
    const update = { status: "RETURNED" as const, returnedAtStep: req.currentStepIndex, returnRemarks: remarks, pendingRecipientUids: [] as string[], history, updatedAt: now };
    tx.update(ref, update);
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_RETURNED", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: { step: label }, timestamp: now,
    });
    result = { ...req, ...update };
  });
  return result;
}

/** The student corrects a returned request; it goes back to the step (or the approvals still pending) that returned it. */
export async function resubmitRequest(
  db: Firestore, collegeId: string, id: string, actor: ActingUser,
  changes: { values?: Record<string, string>; attachments?: CertificateRequest["attachments"]; purpose?: string | null }
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    if (req.requesterUid !== actor.uid) throw new CertificationError("FORBIDDEN", "You can only correct your own request", 403);
    if (req.status !== "RETURNED") throw new CertificateStateConflictError("This request isn't waiting for your correction.");

    const step = req.flow[req.currentStepIndex];
    const current = req.steps[req.currentStepIndex];
    let pendingRecipientUids: string[];
    if (step.type === "PARALLEL" && current?.type === "PARALLEL") {
      const pending = current.branches.filter((b) => b.status === "PENDING");
      const per = await Promise.all(pending.map((b) => resolveRecipientUids(db, collegeId, step.branches.find((d) => d.key === b.branchKey)!.recipient, recipientContext(req))));
      pendingRecipientUids = Array.from(new Set(per.flat()));
    } else {
      pendingRecipientUids = await resolveStepPendingUids(db, collegeId, step, recipientContext(req));
    }
    if (pendingRecipientUids.length === 0) throw new CertificationError("NO_APPROVER", `No one is set to approve "${step.label}" right now - contact the College Office.`, 409);

    const history = [...req.history, { action: "RESUBMITTED", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now } as CertificateHistoryEntry];
    const update: Record<string, unknown> = {
      status: "IN_PROGRESS", pendingRecipientUids, history, updatedAt: now,
      ...(changes.values ? { values: changes.values } : {}),
      ...(changes.attachments ? { attachments: changes.attachments } : {}),
      ...(changes.purpose !== undefined && changes.purpose !== null ? { purpose: changes.purpose } : {}),
    };
    tx.update(ref, update);
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_RESUBMITTED", performedBy: actor.uid, performedByName: actor.name, targetId: id, details: {}, timestamp: now,
    });
    result = { ...req, ...(update as Partial<CertificateRequest>) };
  });
  return result;
}

/**
 * A department records money the student still owes (amount + reason). Not a rejection: the line stays open, the
 * student sees what to pay, and the department clears it (No dues) once paid. Recording it again replaces it.
 */
export async function markDuesPending(
  db: Firestore, collegeId: string, id: string, branchKey: string, actor: ActingUser, amount: number, reason: string
): Promise<CertificateRequest> {
  const ref = CERTIFICATE_REQUESTS_COL(db, collegeId).doc(id);
  const now = new Date();
  let result!: CertificateRequest;
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw new CertificationError("INVALID", "Enter the amount due", 400);
  if (!reason.trim()) throw new CertificationError("REMARKS_REQUIRED", "Say what the dues are for", 400);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new CertificationError("NOT_FOUND", "Request not found", 404);
    const req = { id: snap.id, ...snap.data() } as CertificateRequest;
    const step = req.flow[req.currentStepIndex];
    const current = req.steps[req.currentStepIndex];
    if (req.status !== "IN_PROGRESS" || step?.type !== "PARALLEL" || current?.type !== "PARALLEL") throw new CertificateStateConflictError();
    const branchDef = step.branches.find((b) => b.key === branchKey);
    const state = current.branches.find((b) => b.branchKey === branchKey);
    if (!branchDef || !state) throw new CertificationError("NOT_FOUND", "No such clearance on this request", 404);
    if ((branchDef.check ?? "APPROVAL") !== "DUES") throw new CertificationError("INVALID", "This line is not a dues check", 400);
    if (state.status !== "PENDING") throw new CertificateStateConflictError("This clearance was already decided.");
    const uids = await resolveRecipientUids(db, collegeId, branchDef.recipient, recipientContext(req));
    if (!canDecide(actor.uid, req.requesterUid, uids)) throw new CertificationError("FORBIDDEN", "You can't decide this clearance", 403);

    const duesPending = { amount: Math.round(amount * 100) / 100, reason: reason.trim().slice(0, 200), byName: actor.name, at: now };
    const branches = current.branches.map((b) => (b.branchKey === branchKey ? { ...b, duesPending } : b));
    const steps = [...req.steps.slice(0, req.currentStepIndex), { type: "PARALLEL" as const, branches }];
    const history = [...req.history, { action: "DUES_PENDING", byUid: actor.uid, byName: actor.name, byRole: actor.role, at: now, detail: branchDef.label, remarks: `Rs. ${duesPending.amount} - ${duesPending.reason}` }];
    tx.update(ref, { steps, history, updatedAt: now });
    tx.set(auditRef(db, collegeId), {
      collegeId, action: "CERTIFICATE_DUES_PENDING", performedBy: actor.uid, performedByName: actor.name, targetId: id,
      details: { branch: branchDef.label, amount: duesPending.amount }, timestamp: now,
    });
    result = { ...req, steps, history, updatedAt: now };
  });
  return result;
}
