import type { Actor } from "./stateMachine";
import type { ApprovalRequest, StageId } from "./types";

// The seams that keep the engine independent of Firestore, of notifications and
// of whatever is being approved. A "kind" implements ApprovalKind; the app wires
// a store and a notifier. `C` is the kind's own request context (e.g. the
// Firestore handle + college); `Tx` is the store's transaction handle.

export interface ApprovalKind<P, C, Tx = unknown> {
  readonly kind: string;

  /** Inbox scope of a stage for this request (e.g. HOD -> department, PRINCIPAL -> "*"). */
  stageScope(stage: StageId, req: Pick<ApprovalRequest<P>, "scope" | "payload">): string;

  /** May `actor` decide this request at `stage`? Authorisation lives here, not in the engine. */
  canDecide(ctx: C, req: ApprovalRequest<P>, stage: StageId, actor: Actor): Promise<boolean>;

  /**
   * Optional: is anyone able to act at `stage`? A non-final stage that nobody can
   * act on (e.g. a class with no incharge assigned) is skipped, with a note in
   * the audit trail, instead of stranding the request. The final stage is never
   * skipped. Defaults to "yes".
   */
  isStageActionable?(ctx: C, req: ApprovalRequest<P>, stage: StageId): Promise<boolean>;

  /**
   * Writes that must commit atomically with the decision itself - small and
   * idempotent (e.g. recording coverage that other modules read). Runs inside
   * the store's transaction.
   */
  applyInTransaction?(tx: Tx, ctx: C, req: ApprovalRequest<P>, change: "APPROVED" | "REVOKED"): Promise<void> | void;

  /** After commit: heavier, retry-safe work. A throw marks the request's effects FAILED (retryable). */
  afterApproved?(ctx: C, req: ApprovalRequest<P>): Promise<void>;
  afterRevoked?(ctx: C, req: ApprovalRequest<P>): Promise<void>;
}

export interface ListOptions {
  limit?: number;
  /** Page cursor: only requests created before this ISO instant. */
  before?: string;
}

export interface ApprovalStore<Tx = unknown> {
  create<P>(req: ApprovalRequest<P>): Promise<void>;
  get<P>(collegeId: string, id: string): Promise<ApprovalRequest<P> | null>;
  /**
   * Atomic read-modify-write. `fn` receives the current request and returns the
   * next one plus a result; the store persists `next` only if nothing changed
   * since the read (else the transaction retries / fails with CONFLICT).
   */
  update<P, R>(
    collegeId: string,
    id: string,
    fn: (current: ApprovalRequest<P>, tx: Tx) => Promise<{ next: ApprovalRequest<P>; result: R }>
  ): Promise<R>;
  /** Inbox: requests waiting at any of these "<stage>|<scope>" keys, newest first. */
  listByPendingKeys<P>(collegeId: string, kind: string, keys: readonly string[], opts?: ListOptions): Promise<ApprovalRequest<P>[]>;
  listByRequester<P>(collegeId: string, kind: string, requesterUid: string, opts?: ListOptions): Promise<ApprovalRequest<P>[]>;
  listByScope<P>(collegeId: string, kind: string, scopes: readonly string[], opts?: ListOptions): Promise<ApprovalRequest<P>[]>;
  /** Requests whose `payload.<field>` array contains `value` (e.g. every request that covers a given student). */
  listByPayloadArray<P>(collegeId: string, kind: string, field: string, value: string, opts?: ListOptions): Promise<ApprovalRequest<P>[]>;
}

export type EngineEvent = "SUBMITTED" | "ADVANCED" | "APPROVED" | "REJECTED" | "CANCELLED" | "REVOKED";

/** Told after something happened; must never throw into the workflow (best-effort). */
export type EventSink<P> = (collegeId: string, event: EngineEvent, req: ApprovalRequest<P>) => Promise<void> | void;
