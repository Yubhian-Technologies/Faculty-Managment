import { ApprovalError } from "./types";
import type { ApprovalRequest } from "./types";
import type { ApprovalStore, ListOptions } from "./ports";

/**
 * An in-memory ApprovalStore: the reference implementation of the port's
 * contract, used by tests (and handy for any kind's own unit tests). Same
 * semantics as the Firestore store - atomic update with a version check,
 * newest-first listings, cursor paging.
 */
export function createMemoryStore(): ApprovalStore<{ marker: "memory-tx" }> & { all(): ApprovalRequest[] } {
  const rows = new Map<string, ApprovalRequest>();
  const key = (c: string, id: string) => `${c}/${id}`;
  const clone = <T,>(v: T): T => structuredClone(v);
  const page = <P,>(list: ApprovalRequest[], opts?: ListOptions): ApprovalRequest<P>[] =>
    list
      .filter((r) => !opts?.before || r.createdAt < opts.before)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1))
      .slice(0, opts?.limit ?? 100)
      .map((r) => clone(r) as ApprovalRequest<P>);

  return {
    all: () => Array.from(rows.values()).map(clone),
    async create(req) {
      const k = key(req.collegeId, req.id);
      if (rows.has(k)) throw new ApprovalError("CONFLICT", "Request already exists", 409);
      rows.set(k, clone(req) as ApprovalRequest);
    },
    async get<P>(collegeId: string, id: string) {
      const r = rows.get(key(collegeId, id));
      return r ? (clone(r) as ApprovalRequest<P>) : null;
    },
    async update<P, R>(collegeId: string, id: string, fn: (c: ApprovalRequest<P>, tx: { marker: "memory-tx" }) => Promise<{ next: ApprovalRequest<P>; result: R }>) {
      const k = key(collegeId, id);
      const current = rows.get(k);
      if (!current) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
      const { next, result } = await fn(clone(current) as ApprovalRequest<P>, { marker: "memory-tx" });
      const latest = rows.get(k);
      if (latest && latest.version !== current.version) throw new ApprovalError("CONFLICT", "This request was changed by someone else - reload and try again", 409);
      rows.set(k, clone(next) as ApprovalRequest);
      return result;
    },
    async listByPendingKeys<P>(collegeId: string, kind: string, keys: readonly string[], opts?: ListOptions) {
      return page<P>(Array.from(rows.values()).filter((r) => r.collegeId === collegeId && r.kind === kind && r.pendingKey !== null && keys.includes(r.pendingKey)), opts);
    },
    async listByRequester<P>(collegeId: string, kind: string, uid: string, opts?: ListOptions) {
      return page<P>(Array.from(rows.values()).filter((r) => r.collegeId === collegeId && r.kind === kind && r.requesterUid === uid), opts);
    },
    async listByPayloadArray<P>(collegeId: string, kind: string, field: string, value: string, opts?: ListOptions) {
      return page<P>(Array.from(rows.values()).filter((r) => {
        const arr = (r.payload as Record<string, unknown> | null)?.[field];
        return r.collegeId === collegeId && r.kind === kind && Array.isArray(arr) && arr.includes(value);
      }), opts);
    },
    async listByScope<P>(collegeId: string, kind: string, scopes: readonly string[], opts?: ListOptions) {
      return page<P>(Array.from(rows.values()).filter((r) => r.collegeId === collegeId && r.kind === kind && scopes.includes(r.scope)), opts);
    },
  };
}
