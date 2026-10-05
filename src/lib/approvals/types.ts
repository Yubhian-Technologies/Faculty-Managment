// A small, domain-agnostic approval-workflow engine. Nothing in src/lib/approvals
// knows what is being approved: a "kind" (student permission, a faculty request,
// ...) plugs in through the ApprovalKind contract in ports.ts, and the engine
// provides the lifecycle, routing, audit trail, inbox index and effect
// bookkeeping. Student permissions are the first kind; adding another is a new
// kind module, not a new engine.

/** Opaque to the engine; a kind defines its own stages (e.g. "HOD", "PRINCIPAL"). */
export type StageId = string;

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "REVOKED";

export type ApprovalAction = "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL" | "REVOKE" | "SKIP";

export interface ApprovalEvent {
  action: ApprovalAction;
  at: string; // ISO
  actorUid: string;
  actorName: string;
  /** Stage the action was taken at (absent for SUBMIT / CANCEL). */
  stage?: StageId;
  remark?: string;
}

/** Whether a kind's side effects (e.g. attendance marking) have been applied. */
export type EffectStatus = "NONE" | "PENDING" | "APPLIED" | "FAILED";

export interface ApprovalRequest<P = unknown> {
  id: string;
  kind: string;
  collegeId: string;
  status: RequestStatus;
  /** Ordered stages this request must clear. */
  chain: StageId[];
  /** Index into `chain` of the stage awaiting a decision (== chain.length once finished). */
  stageIndex: number;
  /**
   * Inbox index: "<stage>|<scope>" while PENDING, null otherwise. One equality
   * (or `in`) query on this field answers "what is waiting for me".
   */
  pendingKey: string | null;
  /** Opaque grouping the kind's stage resolvers use (usually the department). */
  scope: string;
  requesterUid: string;
  requesterName: string;
  /** Who raised it, in the kind's own terms (e.g. "STUDENT" / "FACULTY"). */
  requesterType: string;
  payload: P;
  history: ApprovalEvent[];
  effectStatus: EffectStatus;
  effectError?: string;
  /** Bumped on every write; the store uses it for optimistic concurrency. */
  version: number;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  decidedAt?: string; // ISO - set when it leaves PENDING for APPROVED / REJECTED
}

export class ApprovalError extends Error {
  constructor(
    public readonly code:
      | "NOT_PENDING" | "NOT_APPROVED" | "EMPTY_CHAIN" | "DUPLICATE_STAGE" | "FORBIDDEN"
      | "NOT_FOUND" | "CONFLICT" | "REMARK_REQUIRED" | "INVALID",
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}
