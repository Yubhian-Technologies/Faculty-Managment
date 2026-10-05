import { describe, expect, it } from "vitest";
import { DuplicateLeaveSubmissionError, createLeaveRequestOnce, isPendingStatus } from "./submissionGuard";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import type { LeaveRequest } from "@/types/leave";

const REQS = "colleges/c1/leaveRequests";
const req = (over: Partial<LeaveRequest> = {}) =>
  ({ collegeId: "c1", uid: "u1", status: "PENDING_HOD", totalDays: 1, ...over }) as unknown as Omit<LeaveRequest, "id">;

describe("createLeaveRequestOnce", () => {
  it("control: a plain check-then-add double-submits under concurrency (this is the bug being fixed)", async () => {
    let doubled = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const db = asFirestore(fake);
      const naive = async () => {
        const snap = await db.collection(REQS).where("uid", "==", "u1").get();
        if (snap.docs.some((d) => isPendingStatus(d.data().status))) return;
        await db.collection(REQS).add(req());
      };
      await Promise.all([naive(), naive()]);
      if (fake.list(REQS).length === 2) doubled++;
    }
    expect(doubled).toBeGreaterThan(0);
  });

  it("two simultaneous submissions create exactly one request, the other is refused", async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const fake = new FakeFirestore({ latencyMs: 4, seed });
      const db = asFirestore(fake);
      const results = await Promise.allSettled([
        createLeaveRequestOnce(db, "c1", "u1", req()),
        createLeaveRequestOnce(db, "c1", "u1", req()),
      ]);
      expect(fake.list(REQS), `seed ${seed}`).toHaveLength(1);
      expect(results.filter((r) => r.status === "fulfilled"), `seed ${seed}`).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(DuplicateLeaveSubmissionError);
    }
  });

  it("a burst of five submissions still creates one", async () => {
    const fake = new FakeFirestore({ latencyMs: 5, seed: 3 });
    const db = asFirestore(fake);
    await Promise.allSettled(Array.from({ length: 5 }, () => createLeaveRequestOnce(db, "c1", "u1", req())));
    expect(fake.list(REQS)).toHaveLength(1);
  });

  it("different employees do not block each other", async () => {
    const fake = new FakeFirestore({ latencyMs: 4, seed: 5 });
    const db = asFirestore(fake);
    await Promise.all([
      createLeaveRequestOnce(db, "c1", "u1", req()),
      createLeaveRequestOnce(db, "c1", "u2", req({ uid: "u2" })),
    ]);
    expect(fake.list(REQS)).toHaveLength(2);
  });

  it("an earlier request that is already decided does not block a new one (unchanged rule)", async () => {
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"]) {
      const fake = new FakeFirestore();
      fake.seed(`${REQS}/old`, { uid: "u1", status });
      await createLeaveRequestOnce(asFirestore(fake), "c1", "u1", req());
      expect(fake.list(REQS)).toHaveLength(2);
    }
  });

  it("every in-flight status blocks (unchanged rule)", async () => {
    for (const status of ["PENDING_ACCEPTANCE", "PENDING_HOD", "PENDING_PRINCIPAL", "PENDING_VICE_PRINCIPAL", "PENDING_MANAGEMENT"]) {
      const fake = new FakeFirestore();
      fake.seed(`${REQS}/old`, { uid: "u1", status });
      await expect(createLeaveRequestOnce(asFirestore(fake), "c1", "u1", req())).rejects.toBeInstanceOf(DuplicateLeaveSubmissionError);
      expect(fake.list(REQS)).toHaveLength(1);
    }
  });

  it("a failed create leaves no request behind and does not block a retry", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    const db = asFirestore(fake);
    fake.failWhen = () => true;
    await expect(createLeaveRequestOnce(db, "c1", "u1", req())).rejects.toThrow();
    fake.failWhen = null;
    expect(fake.list(REQS)).toHaveLength(0);
    await createLeaveRequestOnce(db, "c1", "u1", req());
    expect(fake.list(REQS)).toHaveLength(1);
  });
});
