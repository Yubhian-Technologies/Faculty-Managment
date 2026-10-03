import type { Firestore, Query, Transaction } from "firebase-admin/firestore";
import { ApprovalError } from "./types";
import type { ApprovalRequest } from "./types";
import type { ApprovalStore, ListOptions } from "./ports";

// Firestore adapter for ApprovalStore.
//
//   colleges/{collegeId}/approvalRequests/{requestId}      (all kinds share it)
//
// Three read paths, each one equality filter on a denormalised field plus a
// newest-first order, so each needs one composite index (see
// firestore.indexes.json): (kind, pendingKey, createdAt), (kind, requesterUid,
// createdAt), (kind, scope, createdAt). Indexes are deployed by hand in this
// repo, so every listing degrades gracefully if one is missing: it falls back
// to the same query without the ordering and sorts in memory (correct, just
// not scalable) instead of failing the page.
//
// Timestamps are stored as ISO-8601 strings: they sort lexicographically in
// time order, and keep the document free of Firestore-specific types, so the
// same shape works for any store implementation.

const FAILED_PRECONDITION = 9;
const DEFAULT_LIMIT = 100;
const IN_LIMIT = 30; // Firestore `in` accepts at most 30 values

export const APPROVAL_COLLECTION = "approvalRequests";

const col = (db: Firestore, collegeId: string) => db.collection("colleges").doc(collegeId).collection(APPROVAL_COLLECTION);

/** Firestore rejects `undefined`; a JSON round-trip drops those keys (all fields here are JSON-safe). */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const byNewest = (a: ApprovalRequest, b: ApprovalRequest) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1;

export function createFirestoreStore(db: Firestore): ApprovalStore<Transaction> {
  async function run<P>(
    ordered: () => Query, unordered: () => Query, opts: ListOptions | undefined
  ): Promise<ApprovalRequest<P>[]> {
    const limit = opts?.limit ?? DEFAULT_LIMIT;
    try {
      let q = ordered().orderBy("createdAt", "desc");
      if (opts?.before) q = q.startAfter(opts.before);
      const snap = await q.limit(limit).get();
      return snap.docs.map((d) => d.data() as ApprovalRequest<P>);
    } catch (err) {
      if ((err as { code?: number }).code !== FAILED_PRECONDITION) throw err;
      console.warn("[approvals] composite index missing - falling back to an in-memory sort. Deploy firestore.indexes.json.");
      const snap = await unordered().limit(1000).get();
      return snap.docs
        .map((d) => d.data() as ApprovalRequest<P>)
        .filter((r) => !opts?.before || r.createdAt < opts.before)
        .sort(byNewest)
        .slice(0, limit);
    }
  }

  /** Runs one query per chunk of `values` (Firestore's `in` limit) and merges newest-first. */
  async function listIn<P>(
    collegeId: string, kind: string, field: string, values: readonly string[], opts: ListOptions | undefined
  ): Promise<ApprovalRequest<P>[]> {
    if (values.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < values.length; i += IN_LIMIT) chunks.push(values.slice(i, i + IN_LIMIT) as string[]);
    const parts = await Promise.all(chunks.map((chunk) => {
      const base = () => col(db, collegeId).where("kind", "==", kind).where(field, chunk.length === 1 ? "==" : "in", chunk.length === 1 ? chunk[0] : chunk);
      return run<P>(base, base, opts);
    }));
    return parts.flat().sort(byNewest as (a: ApprovalRequest<P>, b: ApprovalRequest<P>) => number).slice(0, opts?.limit ?? DEFAULT_LIMIT);
  }

  return {
    async create(req) {
      try {
        await col(db, req.collegeId).doc(req.id).create(clean(req));
      } catch (err) {
        if ((err as { code?: number }).code === 6) throw new ApprovalError("CONFLICT", "Request already exists", 409); // ALREADY_EXISTS
        throw err;
      }
    },

    async get<P>(collegeId: string, id: string) {
      const snap = await col(db, collegeId).doc(id).get();
      return snap.exists ? (snap.data() as ApprovalRequest<P>) : null;
    },

    async update<P, R>(
      collegeId: string, id: string,
      fn: (current: ApprovalRequest<P>, tx: Transaction) => Promise<{ next: ApprovalRequest<P>; result: R }>
    ): Promise<R> {
      const ref = col(db, collegeId).doc(id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new ApprovalError("NOT_FOUND", "Request not found", 404);
        const { next, result } = await fn(snap.data() as ApprovalRequest<P>, tx);
        tx.set(ref, clean(next));
        return result;
      });
    },

    // array-contains + an equality filter is served by index merging (no composite index), so this
    // one is ordered in memory: a student's own list is short.
    async listByPayloadArray<P>(collegeId: string, kind: string, field: string, value: string, opts?: ListOptions) {
      const snap = await col(db, collegeId).where("kind", "==", kind).where(`payload.${field}`, "array-contains", value).limit(500).get();
      return snap.docs
        .map((d) => d.data() as ApprovalRequest<P>)
        .filter((r) => !opts?.before || r.createdAt < opts.before)
        .sort(byNewest as (a: ApprovalRequest<P>, b: ApprovalRequest<P>) => number)
        .slice(0, opts?.limit ?? DEFAULT_LIMIT);
    },

    listByPendingKeys: (collegeId, kind, keys, opts) => listIn(collegeId, kind, "pendingKey", keys, opts),
    listByScope: (collegeId, kind, scopes, opts) => listIn(collegeId, kind, "scope", scopes, opts),
    listByRequester: (collegeId, kind, requesterUid, opts) => listIn(collegeId, kind, "requesterUid", [requesterUid], opts),
  };
}
