import { ApprovalError } from "./types";
import type { ApprovalRequest, StageId } from "./types";
import { approve, cancel, currentStage, reject, revoke, skipStage, submit, type Actor } from "./stateMachine";
import type { ApprovalKind, ApprovalStore, EngineEvent, EventSink } from "./ports";

export interface EngineDeps<P, C, Tx> {
  kind: ApprovalKind<P, C, Tx>;
  store: ApprovalStore<Tx>;
  onEvent?: EventSink<P>;
  now?: () => Date;
  newId?: () => string;
}

export interface SubmitInput<P> {
  collegeId: string;
  scope: string;
  requester: Actor & { type: string };
  payload: P;
  chain: readonly StageId[];
}

const SYSTEM: Actor = { uid: "system", name: "System" };
const MAX_AUTO_SKIPS = 8;

/**
 * The workflow orchestrator for one kind. All state changes go through the
 * store's atomic update, authorisation is delegated to the kind, and side
 * effects are split in two so a failure can't leave things half done:
 * `applyInTransaction` commits with the decision; `afterApproved/Revoked` run
 * after it and are recorded (effectStatus) so a failure is visible and retryable.
 */
export function createApprovalEngine<P, C, Tx = unknown>(deps: EngineDeps<P, C, Tx>) {
  const { kind, store } = deps;
  const iso = () => (deps.now?.() ?? new Date()).toISOString();
  const newId = deps.newId ?? (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  const scopeOf = (req: Pick<ApprovalRequest<P>, "scope" | "payload">) => (stage: StageId) => kind.stageScope(stage, req);

  async function emit(event: EngineEvent, req: ApprovalRequest<P>) {
    try { await deps.onEvent?.(req.collegeId, event, req); } catch { /* notifications are best-effort */ }
  }

  /** Moves past non-final stages nobody can act on, recording each skip. */
  async function skipUnactionable(ctx: C, req: ApprovalRequest<P>): Promise<ApprovalRequest<P>> {
    let cur = req;
    for (let i = 0; i < MAX_AUTO_SKIPS; i++) {
      const stage = currentStage(cur);
      const isLast = cur.stageIndex >= cur.chain.length - 1;
      if (!stage || isLast || !kind.isStageActionable) break;
      if (await kind.isStageActionable(ctx, cur, stage)) break;
      cur = skipStage(cur, SYSTEM, iso(), scopeOf(cur), `No ${stage} available - passed to the next stage`);
    }
    return cur;
  }

  async function authorise(ctx: C, req: ApprovalRequest<P>, actor: Actor): Promise<StageId> {
    const stage = currentStage(req);
    if (!stage) throw new ApprovalError("NOT_PENDING", "This request is no longer awaiting a decision", 409);
    if (!(await kind.canDecide(ctx, req, stage, actor))) {
      throw new ApprovalError("FORBIDDEN", "You can't decide this request", 403);
    }
    return stage;
  }

  async function runAfter(ctx: C, req: ApprovalRequest<P>, hook: "afterApproved" | "afterRevoked"): Promise<ApprovalRequest<P>> {
    const fn = kind[hook];
    if (!fn) return req;
    try {
      await fn.call(kind, ctx, req);
      return await store.update<P, ApprovalRequest<P>>(req.collegeId, req.id, async (cur) => {
        const next = { ...cur, effectStatus: "APPLIED" as const, effectError: undefined, version: cur.version + 1, updatedAt: iso() };
        return { next, result: next };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return await store.update<P, ApprovalRequest<P>>(req.collegeId, req.id, async (cur) => {
        const next = { ...cur, effectStatus: "FAILED" as const, effectError: message.slice(0, 500), version: cur.version + 1, updatedAt: iso() };
        return { next, result: next };
      });
    }
  }

  return {
    /** Creates a request and parks it at its first actionable stage. */
    async submit(ctx: C, input: SubmitInput<P>): Promise<ApprovalRequest<P>> {
      const base = {
        id: newId(), kind: kind.kind, collegeId: input.collegeId, scope: input.scope,
        requesterUid: input.requester.uid, requesterName: input.requester.name, requesterType: input.requester.type,
        payload: input.payload,
      };
      let req = submit(base, input.chain, scopeOf(base), input.requester, iso());
      req = await skipUnactionable(ctx, req);
      await store.create(req);
      await emit("SUBMITTED", req);
      return req;
    },

    /** Approves or rejects at the current stage. Only the kind's canDecide may act. */
    async decide(
      ctx: C,
      input: { collegeId: string; id: string; actor: Actor; decision: "APPROVE" | "REJECT"; remark?: string }
    ): Promise<ApprovalRequest<P>> {
      const updated = await store.update<P, ApprovalRequest<P>>(input.collegeId, input.id, async (current, tx) => {
        await authorise(ctx, current, input.actor);
        let next = input.decision === "APPROVE"
          ? approve(current, input.actor, iso(), scopeOf(current), input.remark)
          : reject(current, input.actor, iso(), input.remark ?? "");
        if (input.decision === "APPROVE" && next.status === "PENDING") next = await skipUnactionable(ctx, next);
        if (next.status === "APPROVED") {
          next = { ...next, effectStatus: kind.applyInTransaction || kind.afterApproved ? "PENDING" : "NONE" };
          await kind.applyInTransaction?.(tx, ctx, next, "APPROVED");
        }
        return { next, result: next };
      });
      const event: EngineEvent = updated.status === "APPROVED" ? "APPROVED" : updated.status === "REJECTED" ? "REJECTED" : "ADVANCED";
      const finished = updated.status === "APPROVED" ? await runAfter(ctx, updated, "afterApproved") : updated;
      await emit(event, finished);
      return finished;
    },

    /** The requester withdraws a pending request. */
    async cancel(ctx: C, input: { collegeId: string; id: string; actor: Actor; remark?: string }): Promise<ApprovalRequest<P>> {
      const updated = await store.update<P, ApprovalRequest<P>>(input.collegeId, input.id, async (current) => {
        if (current.requesterUid !== input.actor.uid) throw new ApprovalError("FORBIDDEN", "Only the person who raised a request can withdraw it", 403);
        const next = cancel(current, input.actor, iso(), input.remark);
        return { next, result: next };
      });
      await emit("CANCELLED", updated);
      return updated;
    },

    /** An authorised approver takes back an approved request; its effects are undone. */
    async revoke(ctx: C, input: { collegeId: string; id: string; actor: Actor; remark: string }): Promise<ApprovalRequest<P>> {
      const updated = await store.update<P, ApprovalRequest<P>>(input.collegeId, input.id, async (current, tx) => {
        if (current.status !== "APPROVED") throw new ApprovalError("NOT_APPROVED", "Only an approved request can be revoked", 409);
        // Whoever could decide the final stage may take the decision back.
        const last = current.chain[current.chain.length - 1];
        if (!(await kind.canDecide(ctx, current, last, input.actor))) throw new ApprovalError("FORBIDDEN", "You can't revoke this request", 403);
        let next = revoke(current, input.actor, iso(), input.remark);
        next = { ...next, effectStatus: kind.applyInTransaction || kind.afterRevoked ? "PENDING" : "NONE" };
        await kind.applyInTransaction?.(tx, ctx, next, "REVOKED");
        return { next, result: next };
      });
      const finished = await runAfter(ctx, updated, "afterRevoked");
      await emit("REVOKED", finished);
      return finished;
    },

    /** Re-runs the after-commit effects of a request whose last attempt FAILED (idempotent by contract). */
    async retryEffects(ctx: C, input: { collegeId: string; id: string }): Promise<ApprovalRequest<P>> {
      const req = await store.get<P>(input.collegeId, input.id);
      if (!req) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
      if (req.effectStatus !== "FAILED" && req.effectStatus !== "PENDING") return req;
      if (req.status === "APPROVED") return runAfter(ctx, req, "afterApproved");
      if (req.status === "REVOKED") return runAfter(ctx, req, "afterRevoked");
      return req;
    },
  };
}

export type ApprovalEngine<P, C, Tx = unknown> = ReturnType<typeof createApprovalEngine<P, C, Tx>>;
