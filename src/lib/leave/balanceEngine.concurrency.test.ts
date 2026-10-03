import { describe, expect, it } from "vitest";
import { commitApproval, releaseApproval, releasePending, balanceDocId } from "./balanceEngine";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

// Concurrency regression tests for the balance helpers. The fake adds random
// per-operation latency and gives transactions real optimistic semantics, so a
// read-then-set implementation loses updates here exactly as it does under
// concurrent approvals in production (audit probe 2026-10-03).

const COL = "colleges/c1/leaveBalances";
const docPath = (uid: string, code: string, year: number) => `${COL}/${balanceDocId(uid, code as never, year)}`;

function dbWith(used: number, extra: Record<string, unknown> = {}, seed = 1) {
  const fake = new FakeFirestore({ latencyMs: 4, seed });
  fake.seed(docPath("u1", "CL", 2026), { collegeId: "c1", uid: "u1", leaveTypeCode: "CL", year: 2026, entitled: 12, used, pending: 0, ...extra });
  return fake;
}
const usedOf = (fake: FakeFirestore) => fake.read(docPath("u1", "CL", 2026))!.used;

describe("balanceEngine - concurrent updates are not lost", () => {
  it("two concurrent commitApproval(1) leave used = 2, not 1", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const fake = dbWith(0, {}, seed);
      const db = asFirestore(fake);
      await Promise.all([
        commitApproval(db, "c1", "u1", "CL", 2026, 1),
        commitApproval(db, "c1", "u1", "CL", 2026, 1),
      ]);
      expect(usedOf(fake), `seed ${seed}`).toBe(2);
    }
  });

  it("cancel(3) racing approve(2) on used=3 ends at 2, not 5", async () => {
    for (let seed = 1; seed <= 25; seed++) {
      const fake = dbWith(3, {}, seed);
      const db = asFirestore(fake);
      await Promise.all([
        releaseApproval(db, "c1", "u1", "CL", 2026, 3),
        commitApproval(db, "c1", "u1", "CL", 2026, 2),
      ]);
      expect(usedOf(fake), `seed ${seed}`).toBe(2);
    }
  });

  it("many concurrent approvals all land", async () => {
    const fake = dbWith(0, {}, 7);
    const db = asFirestore(fake);
    await Promise.all(Array.from({ length: 12 }, () => commitApproval(db, "c1", "u1", "CL", 2026, 0.5)));
    expect(usedOf(fake)).toBe(6);
  });

  it("commitApproval also draws down pending, floored at 0 (unchanged semantics)", async () => {
    const fake = dbWith(1, { pending: 1 });
    await commitApproval(asFirestore(fake), "c1", "u1", "CL", 2026, 2);
    const d = fake.read(docPath("u1", "CL", 2026))!;
    expect(d.used).toBe(3);
    expect(d.pending).toBe(0);
  });

  it("releasePending floors at 0 and never touches used (unchanged semantics)", async () => {
    const fake = dbWith(4, { pending: 1 });
    await releasePending(asFirestore(fake), "c1", "u1", "CL", 2026, 5);
    const d = fake.read(docPath("u1", "CL", 2026))!;
    expect(d.pending).toBe(0);
    expect(d.used).toBe(4);
  });

  it("releaseApproval floors used at 0 and never touches pending (unchanged semantics)", async () => {
    const fake = dbWith(1, { pending: 2 });
    await releaseApproval(asFirestore(fake), "c1", "u1", "CL", 2026, 5);
    const d = fake.read(docPath("u1", "CL", 2026))!;
    expect(d.used).toBe(0);
    expect(d.pending).toBe(2);
  });

  it("still upserts identity fields when the balance doc does not exist yet (unchanged semantics)", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    await commitApproval(asFirestore(fake), "c1", "u9", "EL", 2026, 2);
    const d = fake.read(docPath("u9", "EL", 2026))!;
    expect(d).toMatchObject({ collegeId: "c1", uid: "u9", leaveTypeCode: "EL", year: 2026, used: 2, pending: 0 });
    expect("entitled" in d).toBe(false);
  });
});
