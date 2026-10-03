import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

vi.mock("@/lib/firestore/collegeSettings", () => ({ loadCollegeSettings: vi.fn(async () => ({ newJoiningYears: 1 })) }));

import { LeaveStateConflictError, transitionLeaveRequest } from "./decisionTx";
import { LEAVE_TYPE_SEED } from "./seedData";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import type { LeaveTypeFull } from "@/types/leave";

const REQ = "colleges/c1/leaveRequests/r1";
const BAL = "colleges/c1/leaveBalances/u1_CL_2026";
const t0 = Timestamp.fromDate(new Date(2026, 2, 10, 9, 0, 0));
const CL = LEAVE_TYPE_SEED.find((t) => t.code === "CL") as LeaveTypeFull;

function setup(status = "APPROVED", used = 3, seed = 1) {
  const fake = new FakeFirestore({ latencyMs: 4, seed });
  fake.seed(REQ, { uid: "u1", leaveTypeCode: "CL", status, totalDays: 3, lopDays: 0, updatedAt: t0 });
  fake.seed(BAL, { collegeId: "c1", uid: "u1", leaveTypeCode: "CL", year: 2026, entitled: 12, used, pending: 0 });
  return fake;
}
const cancel = (fake: FakeFirestore, status = "APPROVED", updatedAt: unknown = t0) =>
  transitionLeaveRequest({
    db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status, updatedAt },
    balance: { kind: "RELEASE_APPROVAL", uid: "u1", code: "CL", year: 2026, days: 3 },
    buildUpdate: () => ({ status: "CANCELLED", updatedAt: new Date() }),
  });

describe("transitionLeaveRequest", () => {
  it("cancelling an approved request gives the days back and flips the status together", async () => {
    const fake = setup();
    await cancel(fake);
    expect(fake.read(BAL)!.used).toBe(0);
    expect(fake.read(REQ)!.status).toBe("CANCELLED");
  });

  it("a double-click cancel releases the days once, not twice", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = setup("APPROVED", 5, seed);
      const results = await Promise.allSettled([cancel(fake), cancel(fake)]);
      expect(fake.read(BAL)!.used, `seed ${seed}`).toBe(2); // 5 - 3, once
      expect(results.filter((r) => r.status === "fulfilled"), `seed ${seed}`).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(LeaveStateConflictError);
    }
  });

  it("refuses when the request was edited after the decider read it (dates/days may have changed)", async () => {
    const fake = setup("PENDING_HOD", 0);
    fake.seed(REQ, { uid: "u1", leaveTypeCode: "CL", status: "PENDING_HOD", totalDays: 9, updatedAt: Timestamp.fromDate(new Date(2026, 2, 10, 9, 5, 0)) });
    await expect(
      transitionLeaveRequest({
        db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD", updatedAt: t0 },
        balance: { kind: "COMMIT_SPLIT", uid: "u1", code: "CL", year: 2026, days: 3, leaveType: CL },
        buildUpdate: (r) => ({ status: "APPROVED", lopDays: r.lopDays }),
      })
    ).rejects.toBeInstanceOf(LeaveStateConflictError);
    expect(fake.read(BAL)!.used).toBe(0);
    expect(fake.read(REQ)!.status).toBe("PENDING_HOD");
  });

  it("accepts an unchanged updatedAt expressed as a Date, a Timestamp or a plain {seconds} object", async () => {
    for (const expectedAt of [t0, t0.toDate(), { _seconds: t0.seconds, _nanoseconds: 0 }]) {
      const fake = setup("PENDING_HOD", 0);
      await transitionLeaveRequest({
        db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD", updatedAt: expectedAt },
        buildUpdate: () => ({ status: "REJECTED" }),
      });
      expect(fake.read(REQ)!.status).toBe("REJECTED");
    }
  });

  it("a request with no updatedAt on either side still transitions on the status check alone (old documents)", async () => {
    const fake = new FakeFirestore();
    fake.seed(REQ, { uid: "u1", status: "PENDING_HOD" });
    await transitionLeaveRequest({
      db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD" },
      buildUpdate: () => ({ status: "REJECTED" }),
    });
    expect(fake.read(REQ)!.status).toBe("REJECTED");
  });

  it("a type with no tracked balance transitions without touching any balance doc", async () => {
    const fake = new FakeFirestore();
    fake.seed(REQ, { uid: "u1", leaveTypeCode: "OD", status: "PENDING_HOD", updatedAt: t0 });
    await transitionLeaveRequest({
      db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD", updatedAt: t0 },
      buildUpdate: () => ({ status: "APPROVED", lopDays: 0 }),
    });
    expect(fake.list("colleges/c1/leaveBalances")).toHaveLength(0);
    expect(fake.read(REQ)!.status).toBe("APPROVED");
  });

  it("a missing request is a conflict, not a crash", async () => {
    const fake = new FakeFirestore();
    await expect(
      transitionLeaveRequest({ db: asFirestore(fake), collegeId: "c1", id: "nope", expected: { status: "PENDING_HOD" }, buildUpdate: () => ({}) })
    ).rejects.toBeInstanceOf(LeaveStateConflictError);
  });

  it("an approval racing the requester's cancel: exactly one wins and the balance matches", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = setup("PENDING_HOD", 0, seed);
      const approve = transitionLeaveRequest({
        db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD", updatedAt: t0 },
        balance: { kind: "COMMIT_SPLIT", uid: "u1", code: "CL", year: 2026, days: 3, leaveType: CL },
        buildUpdate: (r) => ({ status: "APPROVED", lopDays: r.lopDays }),
      });
      const cancelPending = transitionLeaveRequest({
        db: asFirestore(fake), collegeId: "c1", id: "r1", expected: { status: "PENDING_HOD", updatedAt: t0 },
        balance: { kind: "RELEASE_PENDING", uid: "u1", code: "CL", year: 2026, days: 3 },
        buildUpdate: () => ({ status: "CANCELLED" }),
      });
      const results = await Promise.allSettled([approve, cancelPending]);
      expect(results.filter((r) => r.status === "fulfilled"), `seed ${seed}`).toHaveLength(1);
      const status = fake.read(REQ)!.status;
      expect(fake.read(BAL)!.used, `seed ${seed}`).toBe(status === "APPROVED" ? 3 : 0);
    }
  });
});
