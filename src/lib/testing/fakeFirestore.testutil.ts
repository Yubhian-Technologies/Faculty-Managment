// In-memory stand-ins for the slice of the Firebase Admin SDK the account /
// archive / audit code uses, so those flows can be unit-tested without ever
// touching a real project (the root .env points at production).
//
// Firestore: documents live in a Map keyed by full path ("colleges/c1/students/s1").
// Supported: collection().doc()/add()/where("==" | "in")/limit()/count()/get(),
// doc get/set(merge)/update/delete/collection(), collectionGroup().where().get(),
// batch() and runTransaction(). Like Firestore, a document that lacks a field does
// not match a filter on it, and FieldValue.delete() removes a field.
// Auth: createUser / getUser / getUserByEmail / updateUser / setCustomUserClaims /
// deleteUser, with Firebase's error codes.

type Data = Record<string, unknown>;

function isDeleteSentinel(v: unknown): boolean {
  return typeof v === "object" && v !== null && (v as { methodName?: string }).methodName === "FieldValue.delete";
}

function applyWrite(existing: Data | undefined, incoming: Data, merge: boolean): Data {
  const base: Data = merge && existing ? { ...existing } : {};
  for (const [k, v] of Object.entries(incoming)) {
    if (isDeleteSentinel(v)) delete base[k];
    else base[k] = v;
  }
  return base;
}

export class FakeFirestore {
  readonly docs = new Map<string, Data>();
  /** Every committed write, in order, for assertions. */
  readonly writeLog: { op: "set" | "update" | "delete"; path: string }[] = [];
  /** Documents returned by queries/gets so far - to assert a read really was narrowed. */
  reads = 0;
  private autoId = 0;
  private txChain: Promise<unknown> = Promise.resolve();

  constructor(seed: Record<string, Data> = {}) {
    for (const [path, data] of Object.entries(seed)) this.docs.set(path, { ...data });
  }

  settings(): void { /* no-op */ }

  private nextId(): string {
    this.autoId += 1;
    return `auto${String(this.autoId).padStart(4, "0")}`;
  }

  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  collection(path: string): FakeCollectionRef {
    return new FakeCollectionRef(this, path);
  }

  collectionGroup(name: string): FakeQuery {
    return new FakeQuery(this, (p) => {
      const parts = p.split("/");
      return parts.length % 2 === 0 && parts[parts.length - 2] === name;
    });
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  // Transactions run one at a time, which is the outcome Firestore's optimistic
  // concurrency (read, conflict, retry) converges to - so two concurrent
  // transactions can never both see the same counter value.
  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const run = async () => {
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      await tx.commit();
      return result;
    };
    const next = this.txChain.then(run, run);
    this.txChain = next.catch(() => undefined);
    return next;
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeDocSnapshot[]> {
    return refs.map((r) => r.snapshot());
  }

  // ── internal write primitives ──
  _set(path: string, data: Data, merge: boolean): void {
    this.docs.set(path, applyWrite(this.docs.get(path), data, merge));
    this.writeLog.push({ op: "set", path });
  }
  _update(path: string, data: Data): void {
    if (!this.docs.has(path)) throw Object.assign(new Error(`NOT_FOUND: ${path}`), { code: 5 });
    this.docs.set(path, applyWrite(this.docs.get(path), data, true));
    this.writeLog.push({ op: "update", path });
  }
  _delete(path: string): void {
    this.docs.delete(path);
    this.writeLog.push({ op: "delete", path });
  }
  _newId(): string {
    return this.nextId();
  }

  /** Test helper. */
  get(path: string): Data | undefined {
    return this.docs.get(path);
  }
}

export class FakeDocSnapshot {
  constructor(readonly ref: FakeDocRef, private readonly value: Data | undefined) {}
  get id(): string { return this.ref.id; }
  get exists(): boolean { return this.value !== undefined; }
  data(): Data | undefined { return this.value ? { ...this.value } : undefined; }
  get(field: string): unknown { return this.value?.[field]; }
}

export class FakeDocRef {
  constructor(readonly db: FakeFirestore, readonly path: string) {}
  get id(): string { return this.path.split("/").pop() as string; }
  get firestore(): FakeFirestore { return this.db; }
  snapshot(): FakeDocSnapshot { return new FakeDocSnapshot(this, this.db.docs.get(this.path)); }
  async get(): Promise<FakeDocSnapshot> { return this.snapshot(); }
  async set(data: Data, opts?: { merge?: boolean }): Promise<void> { this.db._set(this.path, data, !!opts?.merge); }
  async create(data: Data): Promise<void> {
    if (this.db.docs.has(this.path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${this.path}`), { code: 6 });
    this.db._set(this.path, data, false);
  }
  async update(data: Data): Promise<void> { this.db._update(this.path, data); }
  async delete(): Promise<void> { this.db._delete(this.path); }
  collection(name: string): FakeCollectionRef { return new FakeCollectionRef(this.db, `${this.path}/${name}`); }
}

type Op = "==" | "in" | "!=" | "<" | "<=" | ">" | ">=";
type Filter = [field: string, op: Op, value: unknown];

export class FakeQuery {
  constructor(
    protected readonly db: FakeFirestore,
    protected readonly pathMatches: (path: string) => boolean,
    protected readonly filters: Filter[] = [],
    protected readonly max?: number
  ) {}

  where(field: string, op: Op, value: unknown): FakeQuery {
    return new FakeQuery(this.db, this.pathMatches, [...this.filters, [field, op, value]], this.max);
  }
  limit(n: number): FakeQuery {
    return new FakeQuery(this.db, this.pathMatches, this.filters, n);
  }
  select(): FakeQuery { return this; }
  orderBy(): FakeQuery { return this; }

  private matching(): FakeDocSnapshot[] {
    const out: FakeDocSnapshot[] = [];
    for (const [path, data] of this.db.docs) {
      if (!this.pathMatches(path)) continue;
      const ok = this.filters.every(([f, op, v]) => {
        const actual = data[f];
        if (op === "==") return actual === v;
        if (op === "!=") return actual !== undefined && actual !== v;
        if (op === "in") return (v as unknown[]).includes(actual);
        if (actual === undefined || actual === null) return false;
        const a = actual instanceof Date ? actual.getTime() : (actual as number | string);
        const b = v instanceof Date ? v.getTime() : (v as number | string);
        if (op === "<") return a < b;
        if (op === "<=") return a <= b;
        if (op === ">") return a > b;
        return a >= b;
      });
      if (ok) out.push(new FakeDocSnapshot(new FakeDocRef(this.db, path), data));
    }
    return this.max !== undefined ? out.slice(0, this.max) : out;
  }

  async get(): Promise<{ docs: FakeDocSnapshot[]; empty: boolean; size: number }> {
    const docs = this.matching();
    this.db.reads += docs.length;
    return { docs, empty: docs.length === 0, size: docs.length };
  }
  count(): { get(): Promise<{ data(): { count: number } }> } {
    return { get: async () => ({ data: () => ({ count: this.matching().length }) }) };
  }
}

export class FakeCollectionRef extends FakeQuery {
  constructor(db: FakeFirestore, readonly path: string) {
    super(db, (p) => p.startsWith(`${path}/`) && p.slice(path.length + 1).split("/").length === 1);
  }
  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.path}/${id ?? this.db._newId()}`);
  }
  async add(data: Data): Promise<FakeDocRef> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

type BatchOp = { kind: "set"; ref: FakeDocRef; data: Data; merge: boolean } | { kind: "update"; ref: FakeDocRef; data: Data } | { kind: "delete"; ref: FakeDocRef } | { kind: "create"; ref: FakeDocRef; data: Data };

export class FakeBatch {
  private ops: BatchOp[] = [];
  constructor(private readonly db: FakeFirestore) {}
  set(ref: FakeDocRef, data: Data, opts?: { merge?: boolean }): this { this.ops.push({ kind: "set", ref, data, merge: !!opts?.merge }); return this; }
  create(ref: FakeDocRef, data: Data): this { this.ops.push({ kind: "create", ref, data }); return this; }
  update(ref: FakeDocRef, data: Data): this { this.ops.push({ kind: "update", ref, data }); return this; }
  delete(ref: FakeDocRef): this { this.ops.push({ kind: "delete", ref }); return this; }
  async commit(): Promise<void> {
    // All-or-nothing: validate first (update on a missing doc / create on an existing one fails the whole batch).
    const staged = new Map(this.db.docs);
    for (const op of this.ops) {
      if (op.kind === "update" && !staged.has(op.ref.path)) throw Object.assign(new Error(`NOT_FOUND: ${op.ref.path}`), { code: 5 });
      if (op.kind === "create" && staged.has(op.ref.path)) throw Object.assign(new Error(`ALREADY_EXISTS: ${op.ref.path}`), { code: 6 });
      if (op.kind === "set") staged.set(op.ref.path, applyWrite(staged.get(op.ref.path), op.data, op.merge));
      else if (op.kind === "create") staged.set(op.ref.path, applyWrite(undefined, op.data, false));
      else if (op.kind === "update") staged.set(op.ref.path, applyWrite(staged.get(op.ref.path), op.data, true));
      else staged.delete(op.ref.path);
    }
    for (const op of this.ops) {
      if (op.kind === "set") this.db._set(op.ref.path, op.data, op.merge);
      else if (op.kind === "create") this.db._set(op.ref.path, op.data, false);
      else if (op.kind === "update") this.db._update(op.ref.path, op.data);
      else this.db._delete(op.ref.path);
    }
  }
}

export class FakeTransaction extends FakeBatch {
  constructor(private readonly store: FakeFirestore) {
    super(store);
  }
  async get(refOrQuery: FakeDocRef | FakeQuery): Promise<FakeDocSnapshot | { docs: FakeDocSnapshot[]; empty: boolean; size: number }> {
    return refOrQuery instanceof FakeDocRef ? refOrQuery.snapshot() : refOrQuery.get();
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

export interface FakeAuthUser {
  uid: string;
  email: string;
  password: string;
  displayName?: string;
  disabled: boolean;
  customClaims: Data;
}

export class FakeAuth {
  readonly users = new Map<string, FakeAuthUser>();
  readonly calls: { fn: string; args: unknown[] }[] = [];
  private seq = 0;
  /** Set to make the next call to this method throw. */
  failNext: Partial<Record<"createUser" | "updateUser" | "deleteUser" | "setCustomUserClaims", Error>> = {};

  private record(fn: string, ...args: unknown[]): void { this.calls.push({ fn, args }); }
  private maybeFail(fn: keyof FakeAuth["failNext"]): void {
    const err = this.failNext[fn];
    if (err) { delete this.failNext[fn]; throw err; }
  }

  async createUser(props: { email: string; password: string; displayName?: string }): Promise<FakeAuthUser> {
    this.record("createUser", props);
    this.maybeFail("createUser");
    if ([...this.users.values()].some((u) => u.email === props.email)) {
      throw Object.assign(new Error("email exists"), { code: "auth/email-already-exists" });
    }
    this.seq += 1;
    const user: FakeAuthUser = { uid: `uid${this.seq}`, email: props.email, password: props.password, displayName: props.displayName, disabled: false, customClaims: {} };
    this.users.set(user.uid, user);
    return user;
  }
  async getUser(uid: string): Promise<FakeAuthUser> {
    const u = this.users.get(uid);
    if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
    return u;
  }
  async getUserByEmail(email: string): Promise<FakeAuthUser> {
    const u = [...this.users.values()].find((x) => x.email === email);
    if (!u) throw Object.assign(new Error("not found"), { code: "auth/user-not-found" });
    return u;
  }
  async updateUser(uid: string, props: Partial<Pick<FakeAuthUser, "email" | "password" | "displayName" | "disabled">>): Promise<FakeAuthUser> {
    this.record("updateUser", uid, props);
    this.maybeFail("updateUser");
    const u = await this.getUser(uid);
    if (props.email && [...this.users.values()].some((x) => x.uid !== uid && x.email === props.email)) {
      throw Object.assign(new Error("email exists"), { code: "auth/email-already-exists" });
    }
    Object.assign(u, props);
    return u;
  }
  async setCustomUserClaims(uid: string, claims: Data): Promise<void> {
    this.record("setCustomUserClaims", uid, claims);
    this.maybeFail("setCustomUserClaims");
    (await this.getUser(uid)).customClaims = claims;
  }
  async deleteUser(uid: string): Promise<void> {
    this.record("deleteUser", uid);
    this.maybeFail("deleteUser");
    await this.getUser(uid);
    this.users.delete(uid);
  }
}

export function fakeFs(seed: Record<string, Data> = {}) {
  const db = new FakeFirestore(seed);
  return { db, firestore: db as unknown as FirebaseFirestore.Firestore };
}

export function fakeAuth() {
  const auth = new FakeAuth();
  return { auth, adminAuth: auth as unknown as import("firebase-admin/auth").Auth };
}
