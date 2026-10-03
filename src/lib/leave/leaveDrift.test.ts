import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { computeLeaveBalanceDrift } from "../../../scripts/lib/leaveDrift.mjs";

const ts = (y: number, m = 3, d = 10) => Timestamp.fromDate(new Date(y, m - 1, d));
const bal = (uid: string, code: string, year: number, used: number, extra = {}) =>
  ({ id: `${uid}_${code}_${year}`, uid, leaveTypeCode: code, year, used, entitled: 12, ...extra });
const approved = (id: string, uid: string, code: string, totalDays: number, extra = {}) =>
  ({ id, uid, leaveTypeCode: code, status: "APPROVED", fromDate: ts(2026), totalDays, ...extra });

describe("computeLeaveBalanceDrift", () => {
  it("reports nothing when stored used equals the approved requests", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 3)],
      requests: [approved("a", "u1", "CL", 2), approved("b", "u1", "CL", 1)],
    });
    expect(r.driftRows).toBe(0);
    expect(r.approvedRequestsCounted).toBe(2);
  });

  it("flags the concurrent-approval signature: stored used lower than the approved requests", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 1)],
      requests: [approved("a", "u1", "CL", 1), approved("b", "u1", "CL", 1)],
    });
    expect(r.rows[0]).toMatchObject({ kind: "UNDER_DEDUCTED", storedUsed: 1, expectedUsed: 2, delta: -1 });
    expect(r.rows[0].approvedRequestIds.sort()).toEqual(["a", "b"]);
  });

  it("flags over-deduction (e.g. a lost cancel)", () => {
    const r = computeLeaveBalanceDrift({ balances: [bal("u1", "CL", 2026, 5)], requests: [approved("a", "u1", "CL", 2)] });
    expect(r.rows[0]).toMatchObject({ kind: "OVER_DEDUCTED", delta: 3 });
  });

  it("charges only the within-balance days: Loss of Pay days were never committed", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 2)],
      requests: [approved("a", "u1", "CL", 5, { lopDays: 3 })],
    });
    expect(r.driftRows).toBe(0);
  });

  it("ignores requests that are not APPROVED (pending, rejected, cancelled)", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 0)],
      requests: ["PENDING_HOD", "REJECTED", "CANCELLED"].map((status, i) => approved(`x${i}`, "u1", "CL", 2, { status })),
    });
    expect(r.driftRows).toBe(0);
    expect(r.approvedRequestsCounted).toBe(0);
  });

  it("ignores types with no tracked balance (OD, SH)", () => {
    const r = computeLeaveBalanceDrift({ balances: [], requests: [approved("a", "u1", "OD", 3), approved("b", "u1", "SH", 9)] });
    expect(r.driftRows).toBe(0);
  });

  it("keeps years and leave types apart", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 2), bal("u1", "CL", 2027, 0), bal("u1", "SL", 2026, 0)],
      requests: [approved("a", "u1", "CL", 2), approved("b", "u1", "CL", 1, { fromDate: ts(2027) })],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ leaveTypeCode: "CL", year: 2027, delta: -1 });
  });

  it("reports approved days with no balance doc, and used with no approved request, as their own kinds", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u2", "EL", 2026, 4)],
      requests: [approved("a", "u1", "CL", 2)],
    });
    const kinds = Object.fromEntries(r.rows.map((x) => [x.uid, x.kind]));
    expect(kinds).toEqual({ u1: "NO_BALANCE_DOC", u2: "USED_WITHOUT_APPROVED_REQUESTS" });
  });

  it("counts the automatic late-attendance penalty (0.5, already APPROVED) like any other request", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 0.5)],
      requests: [approved("p", "u1", "CL", 0.5, { isLateAttendancePenalty: true })],
    });
    expect(r.driftRows).toBe(0);
  });

  it("sorts the largest drift first and tolerates float noise", () => {
    const r = computeLeaveBalanceDrift({
      balances: [bal("u1", "CL", 2026, 0.1 + 0.2), bal("u2", "CL", 2026, 1), bal("u3", "CL", 2026, 9)],
      requests: [approved("a", "u1", "CL", 0.3), approved("b", "u2", "CL", 2), approved("c", "u3", "CL", 2)],
    });
    expect(r.rows.map((x) => x.uid)).toEqual(["u3", "u2"]);
  });

  it("skips (and counts) approved requests with no usable date instead of crashing", () => {
    const r = computeLeaveBalanceDrift({ balances: [], requests: [approved("a", "u1", "CL", 2, { fromDate: undefined })] });
    expect(r.skippedRequestsWithoutDate).toBe(1);
  });
});
