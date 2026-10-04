import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";

// In-memory stand-in for the slice of the Admin SDK this app uses, built for
// CONCURRENCY tests: every operation awaits a small random delay so
// interleavings actually happen, and transactions have real semantics -
// optimistic read validation at commit, automatic retry, reads-before-writes
// enforcement - so a read-then-write bug fails here the way it would under
// load in production, instead of passing because the fake was single-threaded.
//
// Deliberately NOT a general emulator. It supports exactly: collection/doc
// navigation, get/set(merge)/update/create/delete/add, where (== != < <= > >=
// in not-in array-contains array-contains-any, incl. FieldPath.documentId()),
// orderBy/limit, count(), collectionGroup, batch(), runTransaction() and the
// delete/serverTimestamp/increment field sentinels.

type Data = Record<string, unknown>;
interface Stored { data: Data; version: number }

export interface FakeFirestoreOptions {
  /** Max random delay (ms) injected before every read/write. 0 = none. */
  latencyMs?: number;
  seed?: number;
  maxTxAttempts?: number;
  /**
   * Whether a transaction re-checks the RESULT of the queries it read at commit
   * (default true: a document inserted into a query's range makes it retry).
   * false models the weakest isolation we can't rule out - only documents the
   * transaction actually read are protected - which is what the guard
   * documents (lib/timetable/guards.ts, leave/submissionGuard.ts) exist for.
   */
  validateQueryReads?: boolean;
}

export interface WriteOp {
  kind: "set" | "update" | "delete" | "create";
  path: string;
  data?: Data;
  merge?: boolean;
}

const isPlainObject = (v: unknown): v is Data =>
  typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;

function clone<T>(v: T): T {
  if (v instanceof Date) return new Date(v.getTime()) as unknown as T;
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  if (isPlainObject(v)) {
    const out: Data = {};
    for (const [k, val] of Object.entries(v)) out[k] = clone(val);
    return out as T;
  }
  return v;
}

const isDeleteSentinel = (v: unknown) => !!v && typeof v === "object" && FieldValue.delete().isEqual(v as FieldValue);
const isServerTs = (v: unknown) => !!v && typeof v === "object" && FieldValue.serverTimestamp().isEqual(v as FieldValue);
const incrementOperand = (v: unknown): number | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as { constructor?: { name?: string }; operand?: unknown };
  return o.constructor?.name === "NumericIncrementTransform" && typeof o.operand === "number" ? o.operand : null;
};

function getPath(data: Data, field: string): unknown {
  let cur: unknown = data;
  for (const part of field.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Data)[part];
  }
  return cur;
}

function setPath(data: Data, field: string, value: unknown) {
  const parts = field.split(".");
  let cur = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) cur[parts[i]] = {};
    cur = cur[parts[i]] as Data;
  }
  const last = parts[parts.length - 1];
  if (isDeleteSentinel(value)) delete cur[last];
  else cur[last] = resolveValue(value, cur[last]);
}

function resolveValue(value: unknown, existing: unknown): unknown {
  if (isServerTs(value)) return Timestamp.now();
  const inc = incrementOperand(value);
  if (inc != null) return (typeof existing === "number" ? existing : 0) + inc;
  return clone(value);
}

function mergeInto(target: Data, patch: Data) {
  for (const [k, v] of Object.entries(patch)) {
    if (isDeleteSentinel(v)) delete target[k];
    else if (isPlainObject(v) && isPlainObject(target[k])) mergeInto(target[k] as Data, v);
    else target[k] = resolveValue(v, target[k]);
  }
}

function comparable(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return v;
}

function matches(actual: unknown, op: string, expected: unknown): boolean {
  const a = comparable(actual);
  const e = comparable(expected);
  switch (op) {
    case "==": return a === e;
    case "!=": return a !== undefined && a !== e;
    case "<": return a !== undefined && (a as number) < (e as number);
    case "<=": return a !== undefined && (a as number) <= (e as number);
    case ">": return a !== undefined && (a as number) > (e as number);
    case ">=": return a !== undefined && (a as number) >= (e as number);
    case "in": return Array.isArray(e) && e.map(comparable).includes(a);
    case "not-in": return a !== undefined && Array.isArray(e) && !e.map(comparable).includes(a);
    case "array-contains": return Array.isArray(actual) && actual.map(comparable).includes(e);
    case "array-contains-any":
      return Array.isArray(actual) && Array.isArray(expected) &&
        actual.map(comparable).some((x) => (expected as unknown[]).map(comparable).includes(x));
    default: throw new Error(`FakeFirestore: unsupported operator ${op}`);
  }
}

export class FakeFirestore {
  readonly docs = new Map<string, Stored>();
  readonly opts: Required<FakeFirestoreOptions>;
  private versionCounter = 0;
  private rng: () => number;
  private autoId = 0;
  /** Number of committed write operations, for assertions about write counts. */
  writeCount = 0;
  /** Number of document reads served (get/query/tx.get), for read-count assertions. */
  readCount = 0;
  /** Return true to make a commit throw (before applying anything) - failure injection. */
  failWhen: ((ops: WriteOp[]) => boolean) | null = null;

  constructor(opts: FakeFirestoreOptions = {}) {
    // The server SDK does not fail contenders, it queues them behind a lock (pessimistic
    // concurrency), so a large burst on one document still all completes. This fake
    // validates optimistically instead, which loses more races than that - hence the
    // generous attempt budget and the growing jittered backoff in runTransaction.
    this.opts = {
      latencyMs: opts.latencyMs ?? 0, seed: opts.seed ?? 1, maxTxAttempts: opts.maxTxAttempts ?? 80,
      validateQueryReads: opts.validateQueryReads ?? true,
    };
    let s = this.opts.seed >>> 0;
    this.rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  }

  // ── plumbing ───────────────────────────────────────────────────────────────
  async tick(): Promise<void> {
    if (this.opts.latencyMs <= 0) { await Promise.resolve(); return; }
    await new Promise((r) => setTimeout(r, this.rng() * this.opts.latencyMs));
  }

  seed(path: string, data: Data) {
    this.docs.set(path, { data: clone(data), version: ++this.versionCounter });
  }

  read(path: string): Data | undefined {
    const s = this.docs.get(path);
    return s ? clone(s.data) : undefined;
  }

  versionOf(path: string): number {
    return this.docs.get(path)?.version ?? 0;
  }

  newId(): string {
    return `auto${(++this.autoId).toString().padStart(6, "0")}`;
  }

  /** Applies ops atomically (synchronously). Throws before applying anything if failWhen says so. */
  applyOps(ops: WriteOp[]) {
    if (this.failWhen?.(ops)) throw Object.assign(new Error("FakeFirestore: injected commit failure"), { code: 14 });
    // Validate create()/update() preconditions first so a batch is all-or-nothing.
    for (const op of ops) {
      const exists = this.docs.has(op.path);
      if (op.kind === "create" && exists) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      if (op.kind === "update" && !exists) throw Object.assign(new Error(`NOT_FOUND: ${op.path}`), { code: 5 });
    }
    for (const op of ops) {
      this.writeCount++;
      const v = ++this.versionCounter;
      if (op.kind === "delete") { this.docs.delete(op.path); continue; }
      const existing = this.docs.get(op.path);
      if (op.kind === "create" || (op.kind === "set" && !op.merge)) {
        const data: Data = {};
        mergeInto(data, op.data ?? {});
        this.docs.set(op.path, { data, version: v });
      } else if (op.kind === "set") {
        const data = existing ? clone(existing.data) : {};
        mergeInto(data, op.data ?? {});
        this.docs.set(op.path, { data, version: v });
      } else {
        const data = clone(existing!.data);
        for (const [k, val] of Object.entries(op.data ?? {})) {
          if (k.includes(".")) setPath(data, k, val);
          else if (isDeleteSentinel(val)) delete data[k];
          else data[k] = resolveValue(val, data[k]);
        }
        this.docs.set(op.path, { data, version: v });
      }
    }
  }

  // ── Firestore surface ──────────────────────────────────────────────────────
  collection(path: string): FakeCollectionRef { return new FakeCollectionRef(this, path); }
  doc(path: string): FakeDocRef { return new FakeDocRef(this, path); }
  collectionGroup(id: string): FakeQuery { return new FakeQuery(this, { group: id }); }
  batch(): FakeBatch { return new FakeBatch(this); }

  async getAll(...refs: FakeDocRef[]): Promise<FakeDocSnap[]> {
    await this.tick();
    return refs.map((r) => r.snapNow());
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= this.opts.maxTxAttempts; attempt++) {
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      await this.tick();
      if (tx.validReads()) {
        this.applyOps(tx.ops);
        return result;
      }
      // Back off a little longer each time so a crowd of contenders spreads out and drains.
      await new Promise((r) => setTimeout(r, this.rng() * Math.min(attempt, 12) * Math.max(this.opts.latencyMs, 1)));
    }
    throw Object.assign(new Error("ABORTED: too much contention on these documents"), { code: 10 });
  }

  /** Test helper: every doc under a collection path as { id, ...data }. */
  list(collectionPath: string): (Data & { id: string })[] {
    const out: (Data & { id: string })[] = [];
    for (const [p, s] of this.docs) {
      const idx = p.lastIndexOf("/");
      if (p.slice(0, idx) === collectionPath) out.push({ id: p.slice(idx + 1), ...clone(s.data) });
    }
    return out;
  }
}

export class FakeDocSnap {
  constructor(readonly ref: FakeDocRef, private readonly stored: Stored | undefined) {}
  get id() { return this.ref.id; }
  get exists() { return !!this.stored; }
  data(): Data | undefined { return this.stored ? clone(this.stored.data) : undefined; }
  get(field: string) { return this.stored ? getPath(this.stored.data, field) : undefined; }
}

export class FakeDocRef {
  constructor(readonly db: FakeFirestore, readonly path: string) {}
  get id() { return this.path.slice(this.path.lastIndexOf("/") + 1); }
  get parent() { return new FakeCollectionRef(this.db, this.path.slice(0, this.path.lastIndexOf("/"))); }
  collection(name: string) { return new FakeCollectionRef(this.db, `${this.path}/${name}`); }
  snapNow(): FakeDocSnap { this.db.readCount++; return new FakeDocSnap(this, this.db.docs.get(this.path)); }
  async get() { await this.db.tick(); return this.snapNow(); }
  async set(data: Data, opts?: { merge?: boolean }) {
    await this.db.tick(); this.db.applyOps([{ kind: "set", path: this.path, data, merge: opts?.merge }]);
  }
  async create(data: Data) { await this.db.tick(); this.db.applyOps([{ kind: "create", path: this.path, data }]); }
  async update(data: Data) { await this.db.tick(); this.db.applyOps([{ kind: "update", path: this.path, data }]); }
  async delete() { await this.db.tick(); this.db.applyOps([{ kind: "delete", path: this.path }]); }
  isEqual(o: FakeDocRef) { return o.path === this.path; }
}

interface QuerySpec {
  collectionPath?: string;
  group?: string;
  filters?: { field: unknown; op: string; value: unknown }[];
  orders?: { field: string; dir: "asc" | "desc" }[];
  limitN?: number;
}

export class FakeQuery {
  constructor(protected readonly db: FakeFirestore, protected readonly spec: QuerySpec) {}
  where(field: unknown, op: string, value: unknown): FakeQuery {
    // Real Firestore rejects these outright; the fake must too, or a test
    // could pass on a query production would refuse.
    if ((op === "in" || op === "not-in" || op === "array-contains-any") && Array.isArray(value) && value.length > 30) {
      throw new Error(`Invalid Query. '${op}' filters support a maximum of 30 elements in the value array.`);
    }
    return new FakeQuery(this.db, { ...this.spec, filters: [...(this.spec.filters ?? []), { field, op, value }] });
  }
  orderBy(field: string, dir: "asc" | "desc" = "asc"): FakeQuery {
    return new FakeQuery(this.db, { ...this.spec, orders: [...(this.spec.orders ?? []), { field, dir }] });
  }
  limit(n: number): FakeQuery { return new FakeQuery(this.db, { ...this.spec, limitN: n }); }
  /** Field masks only save bandwidth in real Firestore; the fake returns whole documents. */
  select(...fields: string[]): FakeQuery { void fields; return this; }

  /** Synchronous evaluation against the current store. */
  evalNow(): FakeDocSnap[] {
    let rows: FakeDocSnap[] = [];
    for (const [p, s] of this.db.docs) {
      const idx = p.lastIndexOf("/");
      const parent = p.slice(0, idx);
      const inScope = this.spec.group
        ? parent.slice(parent.lastIndexOf("/") + 1) === this.spec.group || parent === this.spec.group
        : parent === this.spec.collectionPath;
      if (!inScope) continue;
      const id = p.slice(idx + 1);
      const ok = (this.spec.filters ?? []).every((f) => {
        const isDocId = f.field instanceof FieldPath;
        const actual = isDocId ? id : getPath(s.data, f.field as string);
        return matches(actual, f.op, f.value);
      });
      if (ok) rows.push(new FakeDocSnap(new FakeDocRef(this.db, p), s));
    }
    const orders = this.spec.orders ?? [];
    rows.sort((a, b) => {
      for (const o of orders) {
        const av = comparable(a.get(o.field)) as number | string; const bv = comparable(b.get(o.field)) as number | string;
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return o.dir === "asc" ? cmp : -cmp;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    if (this.spec.limitN != null) rows = rows.slice(0, this.spec.limitN);
    this.db.readCount += rows.length;
    return rows;
  }

  async get() {
    await this.db.tick();
    const docs = this.evalNow();
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (cb: (d: FakeDocSnap) => void) => docs.forEach(cb) };
  }

  count() {
    return { get: async () => { await this.db.tick(); return { data: () => ({ count: this.evalNow().length }) }; } };
  }
}

export class FakeCollectionRef extends FakeQuery {
  constructor(db: FakeFirestore, readonly path: string) { super(db, { collectionPath: path }); }
  get id() { return this.path.slice(this.path.lastIndexOf("/") + 1); }
  doc(id?: string) { return new FakeDocRef(this.db, `${this.path}/${id ?? this.db.newId()}`); }
  async add(data: Data) { const ref = this.doc(); await ref.set(data); return ref; }
}

export class FakeBatch {
  private ops: WriteOp[] = [];
  constructor(private readonly db: FakeFirestore) {}
  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }) { this.ops.push({ kind: "set", path: ref.path, data, merge: opts?.merge }); return this; }
  create(ref: FakeDocRef, data: Data) { this.ops.push({ kind: "create", path: ref.path, data }); return this; }
  update(ref: FakeDocRef, data: Data) { this.ops.push({ kind: "update", path: ref.path, data }); return this; }
  delete(ref: FakeDocRef) { this.ops.push({ kind: "delete", path: ref.path }); return this; }
  async commit() {
    if (this.ops.length > 500) throw new Error("FakeFirestore: a batch may hold at most 500 writes");
    await this.db.tick();
    this.db.applyOps(this.ops);
  }
}

export class FakeTransaction {
  readonly ops: WriteOp[] = [];
  private docReads = new Map<string, number>();
  private queryReads: { query: FakeQuery; signature: string }[] = [];
  constructor(private readonly db: FakeFirestore) {}

  private assertNoWrites() {
    if (this.ops.length > 0) throw new Error("Firestore transactions require all reads to be executed before all writes.");
  }

  async get(target: FakeDocRef): Promise<FakeDocSnap>;
  async get(target: FakeQuery): Promise<{ docs: FakeDocSnap[]; empty: boolean; size: number }>;
  async get(target: FakeDocRef | FakeQuery): Promise<unknown> {
    this.assertNoWrites();
    await this.db.tick();
    if (target instanceof FakeDocRef) {
      const snap = target.snapNow();
      this.docReads.set(target.path, this.db.versionOf(target.path));
      return snap;
    }
    const docs = target.evalNow();
    this.queryReads.push({ query: target, signature: sig(docs, this.db) });
    return { docs, empty: docs.length === 0, size: docs.length };
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeDocSnap[]> {
    this.assertNoWrites();
    await this.db.tick();
    return refs.map((r) => {
      this.docReads.set(r.path, this.db.versionOf(r.path));
      return r.snapNow();
    });
  }

  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }) { this.ops.push({ kind: "set", path: ref.path, data, merge: opts?.merge }); return this; }
  create(ref: FakeDocRef, data: Data) { this.ops.push({ kind: "create", path: ref.path, data }); return this; }
  update(ref: FakeDocRef, data: Data) { this.ops.push({ kind: "update", path: ref.path, data }); return this; }
  delete(ref: FakeDocRef) { this.ops.push({ kind: "delete", path: ref.path }); return this; }

  /** True when nothing this transaction read has changed since it read it. */
  validReads(): boolean {
    for (const [path, version] of this.docReads) if (this.db.versionOf(path) !== version) return false;
    if (!this.db.opts.validateQueryReads) return true;
    for (const q of this.queryReads) {
      const now = q.query.evalNow();
      this.db.readCount -= now.length; // validation is not a read the app made
      if (sig(now, this.db) !== q.signature) return false;
    }
    return true;
  }
}

function sig(docs: FakeDocSnap[], db: FakeFirestore): string {
  return docs.map((d) => `${d.ref.path}@${db.versionOf(d.ref.path)}`).sort().join("|");
}

/** The fake, cast to the real type so it can be handed to code under test. */
export function asFirestore(fake: FakeFirestore): FirebaseFirestore.Firestore {
  return fake as unknown as FirebaseFirestore.Firestore;
}
