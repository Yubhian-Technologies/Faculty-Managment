import { describe, expect, it } from "vitest";
import { fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { reverseLateCheckIn } from "./lateAttendancePenalty";

// Excusing one late check-in keeps the automatic deductions equal to floor(late check-ins / 3).

const C = "col1";
const UID = "u1";
const counter = `colleges/${C}/lateAttendanceCounters/${UID}_2026`;
const balance = `colleges/${C}/leaveBalances/${UID}_CL_2026`;
const penalty = (id: string, day: number) => ({
  [`colleges/${C}/leaveRequests/${id}`]: {
    uid: UID, leaveTypeCode: "CL", isLateAttendancePenalty: true, status: "APPROVED",
    fromDate: new Date(2026, 10, day), toDate: new Date(2026, 10, day), totalDays: 0.5, createdAt: new Date(2026, 10, day, 8),
  },
});

function setup(count: number, used: number, penalties: Record<string, unknown>) {
  return fakeFs({ [counter]: { uid: UID, year: 2026, count }, [balance]: { uid: UID, leaveTypeCode: "CL", year: 2026, used }, ...penalties });
}

describe("reverseLateCheckIn", () => {
  it("6 late (deductions on the 3rd and 6th), an earlier day excused: the later deduction goes", async () => {
    const { db, firestore } = setup(6, 3.5, { ...penalty("p19", 19), ...penalty("p23", 23) });
    await reverseLateCheckIn(firestore, C, UID, new Date(2026, 10, 21));
    expect(db.docs.get(counter)?.count).toBe(5);
    expect(db.docs.get(balance)?.used).toBe(3);
    expect(db.docs.has(`colleges/${C}/leaveRequests/p19`)).toBe(true);
    expect(db.docs.has(`colleges/${C}/leaveRequests/p23`)).toBe(false);
  });

  it("the excused day itself triggered a deduction: that one goes", async () => {
    const { db, firestore } = setup(6, 3.5, { ...penalty("p19", 19), ...penalty("p23", 23) });
    await reverseLateCheckIn(firestore, C, UID, new Date(2026, 10, 19));
    expect(db.docs.has(`colleges/${C}/leaveRequests/p19`)).toBe(false);
    expect(db.docs.has(`colleges/${C}/leaveRequests/p23`)).toBe(true);
    expect(db.docs.get(balance)?.used).toBe(3);
  });

  it("still a multiple of 3 left: no deduction removed", async () => {
    const { db, firestore } = setup(7, 3.5, { ...penalty("p19", 19), ...penalty("p23", 23) });
    await reverseLateCheckIn(firestore, C, UID, new Date(2026, 10, 24));
    expect(db.docs.get(counter)?.count).toBe(6);
    expect(db.docs.get(balance)?.used).toBe(3.5);
    expect(db.docs.has(`colleges/${C}/leaveRequests/p23`)).toBe(true);
  });

  it("no deductions yet: only the count drops", async () => {
    const { db, firestore } = setup(2, 1, {});
    await reverseLateCheckIn(firestore, C, UID, new Date(2026, 10, 24));
    expect(db.docs.get(counter)?.count).toBe(1);
    expect(db.docs.get(balance)?.used).toBe(1);
  });
});
