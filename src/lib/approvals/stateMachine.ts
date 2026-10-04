import { ApprovalError } from "./types";
import type { ApprovalEvent, ApprovalRequest, StageId } from "./types";

// The request lifecycle as pure functions: (request, input) -> next request.
// No I/O, no clock (callers pass `at`), no authorisation - WHO may act is the
// kind's job (ports.ts canDecide); this only enforces what is legal when.
//
//   PENDING --approve--> PENDING (next stage) ... --approve (last)--> APPROVED
//   PENDING --reject--> REJECTED        PENDING --cancel--> CANCELLED
//   APPROVED --revoke--> REVOKED

export interface Actor { uid: string; name: string }

export const pendingKeyFor = (stage: StageId, scope: string) => `${stage}|${scope}`;

function stamp(req: ApprovalRequest, at: string): Pick<ApprovalRequest, "version" | "updatedAt"> {
  return { version: req.version + 1, updatedAt: at };
}

function event(action: ApprovalEvent["action"], actor: Actor, at: string, stage?: StageId, remark?: string): ApprovalEvent {
  return { action, at, actorUid: actor.uid, actorName: actor.name, ...(stage ? { stage } : {}), ...(remark?.trim() ? { remark: remark.trim() } : {}) };
}

/** Validates a chain: non-empty and free of repeats. Returns it unchanged. */
export function assertChain(chain: readonly StageId[]): StageId[] {
  if (chain.length === 0) throw new ApprovalError("EMPTY_CHAIN", "An approval route needs at least one stage");
  if (new Set(chain).size !== chain.length) throw new ApprovalError("DUPLICATE_STAGE", "An approval route can't repeat a stage");
  return [...chain];
}

/**
 * A new request at its first stage. `stageScope` maps a stage to the scope used
 * in the inbox key (e.g. HOD -> the department, PRINCIPAL -> "*").
 */
export function submit<P>(
  base: Pick<ApprovalRequest<P>, "id" | "kind" | "collegeId" | "scope" | "requesterUid" | "requesterName" | "requesterType" | "payload">,
  chain: readonly StageId[],
  stageScope: (stage: StageId) => string,
  actor: Actor,
  at: string
): ApprovalRequest<P> {
  const stages = assertChain(chain);
  return {
    ...base,
    status: "PENDING",
    chain: stages,
    stageIndex: 0,
    pendingKey: pendingKeyFor(stages[0], stageScope(stages[0])),
    history: [event("SUBMIT", actor, at)],
    effectStatus: "NONE",
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}

export const currentStage = (req: Pick<ApprovalRequest, "status" | "chain" | "stageIndex">): StageId | null =>
  req.status === "PENDING" ? req.chain[req.stageIndex] ?? null : null;

function requirePending(req: ApprovalRequest): StageId {
  const stage = currentStage(req);
  if (!stage) throw new ApprovalError("NOT_PENDING", "This request is no longer awaiting a decision", 409);
  return stage;
}

/** Approves the current stage; the last stage finalises the request as APPROVED. */
export function approve<P>(
  req: ApprovalRequest<P>, actor: Actor, at: string, stageScope: (stage: StageId) => string, remark?: string
): ApprovalRequest<P> {
  const stage = requirePending(req);
  const history = [...req.history, event("APPROVE", actor, at, stage, remark)];
  const nextIndex = req.stageIndex + 1;
  if (nextIndex >= req.chain.length) {
    return { ...req, ...stamp(req, at), status: "APPROVED", stageIndex: nextIndex, pendingKey: null, history, decidedAt: at };
  }
  const next = req.chain[nextIndex];
  return { ...req, ...stamp(req, at), stageIndex: nextIndex, pendingKey: pendingKeyFor(next, stageScope(next)), history };
}

/** Rejects at the current stage. A reason is required so the requester learns why. */
export function reject<P>(req: ApprovalRequest<P>, actor: Actor, at: string, remark: string): ApprovalRequest<P> {
  const stage = requirePending(req);
  if (!remark?.trim()) throw new ApprovalError("REMARK_REQUIRED", "Please give a reason for rejecting");
  return {
    ...req, ...stamp(req, at), status: "REJECTED", pendingKey: null, decidedAt: at,
    history: [...req.history, event("REJECT", actor, at, stage, remark)],
  };
}

/** Withdraws a request that is still pending. */
export function cancel<P>(req: ApprovalRequest<P>, actor: Actor, at: string, remark?: string): ApprovalRequest<P> {
  requirePending(req);
  return { ...req, ...stamp(req, at), status: "CANCELLED", pendingKey: null, history: [...req.history, event("CANCEL", actor, at, undefined, remark)] };
}

/** Takes back an already-APPROVED request (its effects are undone by the kind). */
export function revoke<P>(req: ApprovalRequest<P>, actor: Actor, at: string, remark: string): ApprovalRequest<P> {
  if (req.status !== "APPROVED") throw new ApprovalError("NOT_APPROVED", "Only an approved request can be revoked", 409);
  if (!remark?.trim()) throw new ApprovalError("REMARK_REQUIRED", "Please give a reason for revoking");
  return { ...req, ...stamp(req, at), status: "REVOKED", pendingKey: null, history: [...req.history, event("REVOKE", actor, at, req.chain[req.chain.length - 1], remark)] };
}

/**
 * Moves a PENDING request past a stage nobody can act on (e.g. a class with no
 * incharge assigned), recording that it was skipped. Finalises like approve()
 * when it was the last stage.
 */
export function skipStage<P>(
  req: ApprovalRequest<P>, actor: Actor, at: string, stageScope: (stage: StageId) => string, reason: string
): ApprovalRequest<P> {
  const stage = requirePending(req);
  const history = [...req.history, event("SKIP", actor, at, stage, reason)];
  const nextIndex = req.stageIndex + 1;
  if (nextIndex >= req.chain.length) {
    return { ...req, ...stamp(req, at), status: "APPROVED", stageIndex: nextIndex, pendingKey: null, history, decidedAt: at };
  }
  const next = req.chain[nextIndex];
  return { ...req, ...stamp(req, at), stageIndex: nextIndex, pendingKey: pendingKeyFor(next, stageScope(next)), history };
}
