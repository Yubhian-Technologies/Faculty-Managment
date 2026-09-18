import { describe, expect, it } from "vitest";
import { evaluateODProof, unprovenODLopDays, OD_PROOF_GRACE_DAYS } from "./odProof";
import type { LeaveRequest, LeaveTypeCode, ODProofStatus } from "@/types/leave";

// A fixed "now" so every case is deterministic. All the dates below are
// expressed relative to it.
const NOW = new Date(2026, 7, 20, 10, 0, 0); // 20 Aug 2026, 10:00

function daysBefore(n: number): Date {
  return new Date(2026, 7, 20 - n);
}

function req(over: {
  code?: LeaveTypeCode;
  status?: LeaveRequest["status"];
  to?: Date;
  required?: boolean;
  proof?: ODProofStatus;
  totalDays?: number;
  isHalfDay?: boolean;
}): LeaveRequest {
  return {
    id: "r1",
    collegeId: "c1",
    uid: "u1",
    employeeName: "Dr. Anil",
    leaveTypeCode: over.code ?? "OD",
    fromDate: over.to ?? daysBefore(10),
    toDate: over.to ?? daysBefore(10),
    totalDays: over.totalDays ?? 1,
    isHalfDay: over.isHalfDay,
    reason: "duty",
    status: over.status ?? "APPROVED",
    odProofRequired: over.required ?? true,
    odProofStatus: over.proof,
  } as unknown as LeaveRequest;
}

describe("evaluateODProof - what it does NOT apply to", () => {
  // The single most important test here: SH (Summer Vacation) shares OD's
  // `rules.unlimited` flag, which every other guard in the codebase keys on.
  // Sweeping a whole vacation into Loss of Pay would be a serious bug.
  it("ignores Summer Vacation even long after it ended", () => {
    const e = evaluateODProof(req({ code: "SH", to: daysBefore(30) }), NOW);
    expect(e.applicable).toBe(false);
    expect(e.isUnprovenLop).toBe(false);
  });

  it.each(["CL", "SL", "SCL", "EL"] as LeaveTypeCode[])(
    "ignores %s however long past",
    (code) => {
      expect(evaluateODProof(req({ code, to: daysBefore(60) }), NOW).isUnprovenLop).toBe(false);
    }
  );

  // Grandfathering: an OD approved before this feature shipped has no
  // odProofRequired stamp, so it stays paid forever with no backfill.
  it("ignores an OD that predates the feature (no odProofRequired stamp)", () => {
    const e = evaluateODProof(req({ required: false, to: daysBefore(60) }), NOW);
    expect(e.state).toBe("NOT_APPLICABLE");
    expect(e.isUnprovenLop).toBe(false);
  });

  it.each(["PENDING_HOD", "PENDING_PRINCIPAL", "REJECTED", "CANCELLED"] as const)(
    "ignores an OD in status %s",
    (status) => {
      expect(evaluateODProof(req({ status, to: daysBefore(60) }), NOW).applicable).toBe(false);
    }
  );
});

describe("evaluateODProof - the window", () => {
  it("asks for nothing while the OD period is still running", () => {
    const e = evaluateODProof(req({ to: new Date(2026, 7, 25) }), NOW);
    expect(e.state).toBe("NOT_DUE");
    expect(e.canUpload).toBe(false);
    expect(e.isUnprovenLop).toBe(false);
  });

  it("opens for upload the day after the period ends", () => {
    const e = evaluateODProof(req({ to: daysBefore(1) }), NOW);
    expect(e.state).toBe("AWAITING_UPLOAD");
    expect(e.canUpload).toBe(true);
    expect(e.isUnprovenLop).toBe(false);
  });

  // Both sides of the deadline, to the millisecond.
  it("is not Loss of Pay at the last instant of the grace window", () => {
    const to = new Date(2026, 7, 1);
    const lastInstant = new Date(2026, 7, 1 + OD_PROOF_GRACE_DAYS, 23, 59, 59, 999);
    expect(evaluateODProof(req({ to }), lastInstant).isUnprovenLop).toBe(false);
  });

  it("is Loss of Pay one millisecond later", () => {
    const to = new Date(2026, 7, 1);
    const justAfter = new Date(2026, 7, 1 + OD_PROOF_GRACE_DAYS, 23, 59, 59, 999).getTime() + 1;
    const e = evaluateODProof(req({ to }), new Date(justAfter));
    expect(e.state).toBe("OVERDUE");
    expect(e.isUnprovenLop).toBe(true);
  });
});

describe("evaluateODProof - proof states past the deadline", () => {
  const overdue = { to: daysBefore(30) };

  // The user's explicit policy call: the requester uploaded on time, so an
  // approver who hasn't looked yet must not cost them pay. Flipping this
  // policy should be a one-line change and should break exactly this test.
  it("protects an uploaded-but-unreviewed proof from Loss of Pay", () => {
    const e = evaluateODProof(req({ ...overdue, proof: "PENDING_VERIFICATION" }), NOW);
    expect(e.awaitingVerification).toBe(true);
    expect(e.isUnprovenLop).toBe(false);
  });

  it("charges Loss of Pay once that proof is rejected", () => {
    expect(evaluateODProof(req({ ...overdue, proof: "REJECTED" }), NOW).isUnprovenLop).toBe(true);
  });

  it("never charges a verified proof, and stops offering re-upload", () => {
    const e = evaluateODProof(req({ ...overdue, proof: "VERIFIED" }), NOW);
    expect(e.state).toBe("VERIFIED");
    expect(e.isUnprovenLop).toBe(false);
    expect(e.canUpload).toBe(false);
  });

  // Lazy evaluation is what makes this possible: nothing has been written, so
  // a late verification simply changes what the next read computes.
  it("still allows a late upload after the deadline, so LOP can be undone", () => {
    expect(evaluateODProof(req(overdue), NOW).canUpload).toBe(true);
    expect(evaluateODProof(req({ ...overdue, proof: "REJECTED" }), NOW).canUpload).toBe(true);
  });
});

describe("unprovenODLopDays", () => {
  const days = (r: LeaveRequest) => (r.isHalfDay ? 0.5 : r.totalDays);

  it("counts only overdue ODs, leaving other LOP sources untouched", () => {
    const list = [
      // A CL carrying real balance-overflow lopDays - handled by standardLopDays.
      { ...req({ code: "CL", to: daysBefore(30), required: false }), lopDays: 3 } as LeaveRequest,
      // An unpaid "Other" - handled by otherLopDays.
      { ...req({ code: "CL", to: daysBefore(30), required: false }), isOtherRequest: true, isPaidLeave: false } as LeaveRequest,
      req({ to: daysBefore(30), proof: "VERIFIED", totalDays: 5 }),
      req({ to: daysBefore(30), totalDays: 2 }),
    ];
    expect(unprovenODLopDays(list, days, NOW)).toBe(2);
  });

  it("charges a half-day OD as 0.5, not 1", () => {
    const list = [req({ to: daysBefore(30), totalDays: 1, isHalfDay: true })];
    expect(unprovenODLopDays(list, days, NOW)).toBe(0.5);
  });

  it("is 0 when nothing is overdue", () => {
    expect(unprovenODLopDays([req({ to: daysBefore(1) })], days, NOW)).toBe(0);
    expect(unprovenODLopDays([], days, NOW)).toBe(0);
  });
});
