import { describe, expect, it } from "vitest";
import {
  claimDepartmentKeys,
  departmentKeyConflictMessage,
  departmentKeyDocId,
  releaseDepartmentKeys,
} from "./departmentKeys";

// Minimal in-memory Firestore-ish store with serialised "transactions": each
// transaction sees a snapshot and its writes apply atomically on commit, and a
// commit fails (like a real contended tx would retry/abort) if a key it read as
// absent was created meanwhile - enough to prove lock docs give uniqueness.
type FakeTx = {
  get(ref: never): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(ref: never, v: Record<string, unknown>): void;
  delete(ref: never): void;
};

function makeStore() {
  const data = new Map<string, Record<string, unknown>>();
  const coll = (name: string) => ({ doc: (id: string) => ({ id, path: `${name}/${id}` }) });
  const store = {
    data,
    keys: coll("keys"),
    depts: coll("depts"),
    addDept(id: string) {
      data.set(`depts/${id}`, { exists: true });
    },
    async tx<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      const readAbsent = new Set<string>();
      const writes: (() => void)[] = [];
      const tx = {
        async get(ref: { path: string }) {
          const v = data.get(ref.path);
          if (!v) readAbsent.add(ref.path);
          return { exists: !!v, data: () => v };
        },
        set(ref: { path: string }, v: Record<string, unknown>) {
          writes.push(() => data.set(ref.path, v));
        },
        delete(ref: { path: string }) {
          writes.push(() => data.delete(ref.path));
        },
      };
      const result = await fn(tx);
      for (const p of readAbsent) if (data.has(p)) throw new Error("CONTENTION");
      writes.forEach((w) => w());
      return result;
    },
  };
  return store;
}

describe("claimDepartmentKeys", () => {
  it("claims name+code and rejects the same key from another department (any case/spacing)", async () => {
    const s = makeStore();
    s.addDept("d1");
    s.addDept("d2");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Information Technology", code: "IT" }));
    for (const name of ["information  technology", " INFORMATION TECHNOLOGY "]) {
      await expect(s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name, code: "X1" }))).rejects.toThrow(/already exists/);
    }
    await expect(s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "Other", code: " i t " }))).rejects.toThrow(/short code/i);
    const err = await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "Other", code: "it" })).catch((e) => e);
    expect(departmentKeyConflictMessage(err)).toMatch(/IT/);
  });

  it("is a no-op for the owner re-saving or changing only case/whitespace", async () => {
    const s = makeStore();
    s.addDept("d1");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Civil Engineering", code: "CIV" }));
    await s.tx((tx) =>
      claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "CIVIL  ENGINEERING", code: "civ" }, { name: "Civil Engineering", code: "CIV" })
    );
    expect(s.data.has(`keys/${departmentKeyDocId("name", "civil engineering")}`)).toBe(true);
    expect(s.data.size).toBe(3); // dept doc + 2 locks
  });

  it("rename swaps locks: old name released, new reserved, other departments can then take the old one", async () => {
    const s = makeStore();
    s.addDept("d1");
    s.addDept("d2");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Old Name", code: "ON" }));
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "New Name" }, { name: "Old Name" }));
    expect(s.data.has(`keys/${departmentKeyDocId("name", "Old Name")}`)).toBe(false);
    expect(s.data.has(`keys/${departmentKeyDocId("name", "New Name")}`)).toBe(true);
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "old name", code: "OLD" }));
    await expect(s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "new name" }, { name: "old name" }))).rejects.toThrow(/already exists/);
  });

  it("never releases a lock it does not own", async () => {
    const s = makeStore();
    s.addDept("d1");
    s.addDept("d2");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Shared" }));
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "Different" }, { name: "Shared" }));
    expect(s.data.get(`keys/${departmentKeyDocId("name", "Shared")}`)?.departmentId).toBe("d1");
  });

  it("delete releases keys so the name can be reused by a NEW department", async () => {
    const s = makeStore();
    s.addDept("d1");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Physics", code: "PHY" }));
    await s.tx(async (tx) => {
      releaseDepartmentKeys(tx, s.keys, { name: "Physics", code: "PHY" });
    });
    s.data.delete("depts/d1");
    s.addDept("d9");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d9", { name: "Physics", code: "PHY" }));
    expect(s.data.get(`keys/${departmentKeyDocId("name", "Physics")}`)?.departmentId).toBe("d9");
  });

  it("takes over a lock whose owning department no longer exists", async () => {
    const s = makeStore();
    s.addDept("d1");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d1", { name: "Ghost" }));
    s.data.delete("depts/d1"); // deleted without releasing
    s.addDept("d2");
    await s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "d2", { name: "ghost" }));
    expect(s.data.get(`keys/${departmentKeyDocId("name", "Ghost")}`)?.departmentId).toBe("d2");
  });

  it("concurrent creates of the same name: exactly one wins", async () => {
    const s = makeStore();
    s.addDept("a");
    s.addDept("b");
    const results = await Promise.allSettled([
      s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "a", { name: "Mechanical Engineering" })),
      s.tx((tx) => claimDepartmentKeys(tx, s.keys, s.depts, "b", { name: "mechanical  engineering" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("different colleges are independent (separate key collections)", async () => {
    const c1 = makeStore();
    const c2 = makeStore();
    c1.addDept("d");
    c2.addDept("d");
    await c1.tx((tx) => claimDepartmentKeys(tx, c1.keys, c1.depts, "d", { name: "Physics", code: "PHY" }));
    await c2.tx((tx) => claimDepartmentKeys(tx, c2.keys, c2.depts, "d", { name: "Physics", code: "PHY" }));
  });
});
