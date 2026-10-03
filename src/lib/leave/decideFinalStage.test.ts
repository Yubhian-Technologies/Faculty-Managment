import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";

// Side effects that are not under test: notifications, substitute notices,
// attendance sync, college settings. The balance + status writes are.
vi.mock("@/lib/notify", () => ({ notify: vi.fn(async () => {}) }));
vi.mock("@/lib/notifications/workflowNotifications", () => ({ resolveWorkflowNotifications: vi.fn(async () => {}) }));
vi.mock("@/lib/leave/periodCoverage", () => ({ notifySubstitutes: vi.fn(async () => {}) }));
vi.mock("@/lib/leave/attendanceSync", () => ({ syncApprovedLeaveToAttendance: vi.fn(async () => {}) }));
vi.mock("@/lib/firestore/collegeSettings", () => ({ loadCollegeSettings: vi.fn(async () => ({ newJoiningYears: 1 })) }));

import { decideFinalStageLeave } from "./decideFinalStage";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import type { LeaveRequest } from "@/types/leave";

const REQ = "colleges/c1/leaveRequests/r1";
const BAL = "colleges/c1/leaveBalances/u1_CL_2026";
const when = Timestamp.fromDate(new Date(2026, 2, 10));

function setup(over: Partial<Record<string, unknown>> = {}, seed = 1) {
  const fake = new FakeFirestore({ latencyMs: 4, seed });
  fake.seed(REQ, {
    collegeId: "c1", uid: "u1", employeeName: "A", leaveTypeCode: "CL", isOtherRequest: false,
    fromDate: when, toDate: when, totalDays: 2, status: "PENDING_PRINCIPAL", updatedAt: when, ...over,
  });
  fake.seed(BAL, { collegeId: "c1", uid: "u1", leaveTypeCode: "CL", year: 2026, entitled: 12, used: 0, pending: 0 });
  return fake;
}
const reqOf = (fake: FakeFirestore) => ({ id: "r1", ...fake.read(REQ)! }) as unknown as LeaveRequest;
const decide = (fake: FakeFirestore, action: "APPROVE" | "REJECT", by = "p1") =>
  decideFinalStageLeave({
    db: asFirestore(fake), collegeId: "c1", id: "r1", req: reqOf(fake), action, decidedByUid: by, decidedByEmail: `${by}@x`,
    decider: "PRINCIPAL",
  });

describe("decideFinalStageLeave - double decisions cannot double-deduct", () => {
  beforeEach(() => vi.clearAllMocks());

  it("two approvers approving at once: balance is deducted exactly once, one of them is refused", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = setup({}, seed);
      // Both approvers loaded the request while it was still pending.
      const a = decide(fake, "APPROVE", "p1");
      const b = decide(fake, "APPROVE", "p2");
      const results = await Promise.allSettled([a, b]);
      expect(fake.read(BAL)!.used, `seed ${seed}`).toBe(2);
      expect(results.filter((r) => r.status === "fulfilled"), `seed ${seed}`).toHaveLength(1);
      expect(fake.read(REQ)!.status).toBe("APPROVED");
    }
  });

  it("a second approve after the first finished (a double-click) is refused and changes nothing", async () => {
    const fake = setup();
    const stale = reqOf(fake); // the page's copy, loaded before the first click landed
    await decide(fake, "APPROVE");
    await expect(
      decideFinalStageLeave({
        db: asFirestore(fake), collegeId: "c1", id: "r1", req: stale, action: "APPROVE",
        decidedByUid: "p1", decider: "PRINCIPAL",
      })
    ).rejects.toThrow();
    expect(fake.read(BAL)!.used).toBe(2);
  });

  it("approve racing reject: exactly one wins and the balance matches the winner", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const fake = setup({}, seed);
      const results = await Promise.allSettled([decide(fake, "APPROVE", "p1"), decide(fake, "REJECT", "p2")]);
      expect(results.filter((r) => r.status === "fulfilled"), `seed ${seed}`).toHaveLength(1);
      const status = fake.read(REQ)!.status;
      expect(fake.read(BAL)!.used, `seed ${seed}`).toBe(status === "APPROVED" ? 2 : 0);
    }
  });

  it("a failing status update cannot leave a consumed balance behind", async () => {
    const fake = setup();
    // Fail any commit that writes the request doc - the balance write rides in the same commit.
    fake.failWhen = (ops) => ops.some((o) => o.path === REQ);
    await expect(decide(fake, "APPROVE")).rejects.toThrow();
    expect(fake.read(BAL)!.used).toBe(0);
    expect(fake.read(REQ)!.status).toBe("PENDING_PRINCIPAL");
  });

  it("splits days beyond the remaining balance into Loss of Pay (unchanged semantics)", async () => {
    const fake = setup({ totalDays: 5 });
    fake.seed(BAL, { collegeId: "c1", uid: "u1", leaveTypeCode: "CL", year: 2026, entitled: 12, used: 10, pending: 0 });
    const { lopDays } = await decide(fake, "APPROVE");
    expect(lopDays).toBe(3);
    expect(fake.read(BAL)!.used).toBe(12); // only the 2 within-balance days are committed
    expect(fake.read(REQ)).toMatchObject({ status: "APPROVED", lopDays: 3 });
  });

  it("falls back to the profile's default entitlement when no balance doc exists (unchanged semantics)", async () => {
    const fake = new FakeFirestore({ latencyMs: 2 });
    fake.seed(REQ, {
      collegeId: "c1", uid: "u1", employeeName: "A", leaveTypeCode: "CL", isOtherRequest: false,
      fromDate: when, toDate: when, totalDays: 2, status: "PENDING_PRINCIPAL", updatedAt: when,
    });
    fake.seed("colleges/c1/employeeLeaveProfiles/u1", { uid: "u1", dateOfJoining: Timestamp.fromDate(new Date(2015, 0, 1)), staffCategory: "NON_VACATION" });
    const { lopDays } = await decide(fake, "APPROVE");
    expect(lopDays).toBe(0); // CL default entitlement is 12 > 2
    expect(fake.read(BAL)).toMatchObject({ used: 2, uid: "u1", leaveTypeCode: "CL", year: 2026 });
  });

  it("reject releases the (zero) reservation and marks REJECTED without touching used", async () => {
    const fake = setup();
    fake.seed(BAL, { collegeId: "c1", uid: "u1", leaveTypeCode: "CL", year: 2026, entitled: 12, used: 4, pending: 0 });
    await decide(fake, "REJECT");
    expect(fake.read(BAL)!.used).toBe(4);
    expect(fake.read(REQ)!.status).toBe("REJECTED");
  });
});
