import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

// The whole month through the REAL routes on an in-memory Firestore: the Office prepares October
// (pay days from joining / last working day, leave LOP and attendance), adjusts and submits; Accounts
// set IT, return it; the Office recalculates (adjustments kept) and resubmits; Accounts approve and
// release - ledgers written once, the month locked, pay can't be changed back into it.

const fake = new FakeFirestore();
const who = { uid: "office1", role: "COLLEGE_OFFICE", collegeId: "c1", locationId: "" };

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => asFirestore(fake) }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: `${who.uid}@x`, role: who.role, collegeId: who.collegeId, locationId: who.locationId, exp: 0 };
  },
}));

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test

const as = (role: "OFFICE" | "ACCOUNTS") => {
  if (role === "OFFICE") Object.assign(who, { uid: "office1", role: "COLLEGE_OFFICE", collegeId: "c1", locationId: "" });
  else Object.assign(who, { uid: "acc1", role: "ACCOUNTS", collegeId: "", locationId: "L1" });
};
const q = "?collegeId=c1";
const call = async (mod: Promise<Json>, method: string, url: string, body?: unknown, params?: Record<string, string>) => {
  const handler = (await mod)[method];
  const res = await handler(new Request(`http://x${url}${q}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status as number, json: (await res.json()) as Json };
};
const runs = () => import("@/app/api/college/payroll/runs/route");
const month = () => import("@/app/api/college/payroll/runs/[month]/route");
const recalc = () => import("@/app/api/college/payroll/runs/[month]/recalculate/route");
const line = () => import("@/app/api/college/payroll/runs/[month]/lines/[employeeKey]/route");
const pay = () => import("@/app/api/college/payroll/pay/[employeeKey]/route");
const M = { month: "2026-10" };

const rev = (amounts: Record<string, number>, exempt: string[] = []) => ({ revisions: [{ effectiveFrom: "2026-04", amounts, exempt, byName: "a", byUid: "a", at: "t" }] });

beforeEach(() => {
  fake.seed("colleges/c1", { name: "VWU", locationId: "L1" });
  fake.seed("locations/L1/locationUsers/acc1", { role: "ACCOUNTS" });
  fake.seed("colleges/c1/facultyMembers/f1", { employeeId: "SVECW0679", legalName: "G MOUNIKA", department: "ME", designation: "ASSISTANT_PROFESSOR", status: "ACTIVE", userUid: "u1", joiningDate: new Date("2020-06-01"), bankAccountNumber: "1234", ifscCode: "sbin0001" });
  fake.seed("colleges/c1/facultyMembers/f2", { employeeId: "SVECW0900", legalName: "V RAMA DEVI", department: "CSE", designation: "ASSISTANT_PROFESSOR", status: "ACTIVE", joiningDate: new Date("2026-10-14"), bankAccountNumber: "9", ifscCode: "X" });
  fake.seed("colleges/c1/facultyMembers/f3", { employeeId: "SVECW0500", legalName: "LEFT", department: "IT", status: "RESIGNED", resignedDate: new Date("2026-10-20"), joiningDate: new Date("2019-01-01"), bankAccountNumber: "9", ifscCode: "X" });
  fake.seed("colleges/c1/facultyMembers/f4", { employeeId: "SVECW0501", legalName: "NO PAY", department: "IT", status: "ACTIVE", joiningDate: new Date("2019-01-01") });
  fake.seed("colleges/c1/supportingStaff/s1", { employeeId: "SVECW0601", legalName: "P SURYA PAVAN", department: "AI", designation: "LAB_ASSISTANT", status: "ACTIVE", joiningDate: new Date("2021-01-01"), bankAccountNumber: "77", ifscCode: "Y" });
  fake.seed("colleges/c1/employeePay/FACULTY_f1", rev({ EB: 16550, AGP: 6000, DA: 2255, HRA: 2255, OA: 540 }));
  fake.seed("colleges/c1/employeePay/FACULTY_f2", rev({ EB: 31000 }));
  fake.seed("colleges/c1/employeePay/FACULTY_f3", rev({ EB: 31000 }, ["PF"]));
  fake.seed("colleges/c1/employeePay/STAFF_s1", rev({ EB: 7720, DA: 5551, HRA: 965, OA: 12014 }));
  // u1: 2 days of CL beyond balance (5-6 Oct, both LOP), absent on 8 Oct, half day on 12 Oct,
  // and an ABSENT mark on 6 Oct that the leave already covers (not counted twice).
  fake.seed("colleges/c1/leaveRequests/l1", { uid: "u1", status: "APPROVED", leaveTypeCode: "CL", fromDate: new Date("2026-10-05"), toDate: new Date("2026-10-06"), totalDays: 2, lopDays: 2 });
  fake.seed("colleges/c1/attendanceRecords/u1_2026-10-08", { facultyId: "u1", dateKey: "2026-10-08", status: "ABSENT" });
  fake.seed("colleges/c1/attendanceRecords/u1_2026-10-12", { facultyId: "u1", dateKey: "2026-10-12", status: "HALF_DAY" });
  const advance = (key: string, amount: number, instalment: number, recoveredBefore = 0) => ({ employeeKey: key, employeeCode: "x", name: "x", amount, recoveredBefore, instalment, recoveryPercent: 0, startMonth: "2026-10", status: "ACTIVE", recoveries: {}, rev: 1, createdAt: "2026-09-01", createdByName: "a", history: [] });
  fake.seed("colleges/c1/salaryAdvances/a1", advance("FACULTY_f1", 20000, 6667));
  fake.seed("colleges/c1/salaryAdvances/a2", advance("STAFF_s1", 3000, 1000));
  fake.seed("colleges/c1/salaryAdvances/a3", advance("FACULTY_f3", 10000, 5000, 8000));
  fake.seed("colleges/c1/attendanceRecords/u1_2026-10-06", { facultyId: "u1", dateKey: "2026-10-06", status: "ABSENT" });
});

describe("monthly payroll run", () => {
  it("prepare -> adjust -> submit -> return -> recalc -> approve -> release", async () => {
    as("OFFICE");
    const prep = await call(runs(), "POST", "/runs", { month: "2026-10" });
    expect(prep.status).toBe(200);
    expect((await call(runs(), "POST", "/runs", { month: "2026-10" })).status).toBe(409);

    let m = await call(month(), "GET", "/m", undefined, M);
    const byKey = (k: string) => (m.json.lines as Json[]).find((l) => l.employeeKey === k)!;
    expect((m.json.lines as Json[]).map((l) => l.employeeKey).sort()).toEqual(["FACULTY_f1", "FACULTY_f2", "FACULTY_f3", "STAFF_s1"]);
    expect(m.json.run.excluded).toEqual([expect.objectContaining({ employeeKey: "FACULTY_f4", reason: "No pay set for this month" })]);
    expect(byKey("FACULTY_f1").auto).toMatchObject({ leaveLop: 2, attendanceLop: 1.5, lop: 3.5, payDays: 27.5, absentDates: ["2026-10-08", "2026-10-12"] });
    expect(byKey("FACULTY_f2")).toMatchObject({ payDays: 18, result: { gross: 18000 } });   // joined 14 Oct
    expect(byKey("FACULTY_f3")).toMatchObject({ payDays: 20, result: { gross: 20000 } });   // last day 20 Oct
    expect(byKey("STAFF_s1").result).toMatchObject({ gross: 26250, deductions: { PF: 1593, PT: 200, ESI: 100, SWF: 30, ADV: 1000 }, net: 23327 });
    expect(byKey("FACULTY_f1")).toMatchObject({ advance: 6667, advanceAuto: 6667, advanceBalance: 20000 });
    expect(byKey("FACULTY_f3")).toMatchObject({ advance: 2000, advanceBalance: 2000 });
    let rv = m.json.run.rev as number;

    // Office: LOP override needs a reason; IT is Accounts' only.
    expect((await call(line(), "PATCH", "/l", { rev: rv, edit: { lopOverride: { days: 3 } } }, { ...M, employeeKey: "FACULTY_f1" })).status).toBe(400);
    let r = await call(line(), "PATCH", "/l", { rev: rv, edit: { lopOverride: { days: 3, reason: "Half day was permission" } } }, { ...M, employeeKey: "FACULTY_f1" });
    expect(r.status).toBe(200);
    expect(r.json.line.payDays).toBe(28);
    rv = r.json.rev;
    expect((await call(line(), "PATCH", "/l", { rev: rv, edit: { tdsOverride: { amount: 500, reason: "x" } } }, { ...M, employeeKey: "FACULTY_f1" })).status).toBe(400);
    r = await call(line(), "PATCH", "/l", { rev: rv, edit: { hold: { reason: "Bank details pending" } } }, { ...M, employeeKey: "STAFF_s1" });
    rv = r.json.rev;
    expect(r.json.totals.held).toBe(1);
    expect((await call(month(), "POST", "/m", { action: "SUBMIT", rev: rv }, M)).status).toBe(200);
    rv++;

    // Accounts: set IT, return with remarks.
    as("ACCOUNTS");
    expect((await call(month(), "POST", "/m", { action: "APPROVE", rev: rv - 1 }, M)).status).toBe(409);
    expect((await call(line(), "PATCH", "/l", { rev: rv, edit: { tdsOverride: { amount: 500 } } }, { ...M, employeeKey: "FACULTY_f1" })).status).toBe(400);
    r = await call(line(), "PATCH", "/l", { rev: rv, edit: { tdsOverride: { amount: 500, reason: "Asked for more" } } }, { ...M, employeeKey: "FACULTY_f1" });
    expect(r.json.line.result.deductions.IT).toBe(500);
    rv = r.json.rev;
    // This month's advance recovery: lowered with a reason; never above the balance.
    expect((await call(line(), "PATCH", "/l", { rev: rv, edit: { advanceOverride: { amount: 25000, reason: "x" } } }, { ...M, employeeKey: "FACULTY_f1" })).status).toBe(400);
    r = await call(line(), "PATCH", "/l", { rev: rv, edit: { advanceOverride: { amount: 5000, reason: "Asked to spread it" } } }, { ...M, employeeKey: "FACULTY_f1" });
    expect(r.json.line.result.deductions.ADV).toBe(5000);
    rv = r.json.rev;
    expect((await call(month(), "POST", "/m", { action: "RETURN", rev: rv }, M)).status).toBe(400);
    expect((await call(month(), "POST", "/m", { action: "RETURN", rev: rv, remarks: "Check Mounika's LOP" }, M)).status).toBe(200);
    rv++;

    // Office: recalculate keeps the override, hold and IT; resubmit.
    as("OFFICE");
    expect((await call(month(), "POST", "/m", { action: "APPROVE", rev: rv }, M)).status).toBe(400);
    r = await call(recalc(), "POST", "/r", { rev: rv }, M);
    expect(r.status).toBe(200);
    rv = r.json.rev;
    m = await call(month(), "GET", "/m", undefined, M);
    expect(byKey("FACULTY_f1")).toMatchObject({ payDays: 28, tds: 500, lopOverride: { days: 3 }, advance: 5000, advanceAuto: 6667 });
    expect(byKey("STAFF_s1").hold).toBeTruthy();
    expect(m.json.run.returnRemarks).toBe("Check Mounika's LOP");
    expect((await call(month(), "POST", "/m", { action: "SUBMIT", rev: rv }, M)).status).toBe(200);
    rv++;
    expect((await call(line(), "PATCH", "/l", { rev: rv, edit: { hold: null } }, { ...M, employeeKey: "STAFF_s1" })).status).toBe(409);

    // Accounts: approve, release (needs date + reference).
    as("ACCOUNTS");
    expect((await call(month(), "POST", "/m", { action: "APPROVE", rev: rv }, M)).status).toBe(200);
    rv++;
    expect((await call(month(), "POST", "/m", { action: "RELEASE", rev: rv }, M)).status).toBe(400);
    expect((await call(month(), "POST", "/m", { action: "RELEASE", rev: rv, paidOn: "2026-10-31", reference: "NEFT-123" }, M)).status).toBe(200);

    m = await call(month(), "GET", "/m", undefined, M);
    expect(m.json.run.status).toBe("RELEASED");
    expect(m.json.run.release).toMatchObject({ paidOn: "2026-10-31", reference: "NEFT-123" });
    const ledger = fake.list("colleges/c1/payrollLedger");
    expect(ledger.map((l) => l.id).sort()).toEqual(["FACULTY_f1__2026-10", "FACULTY_f2__2026-10", "FACULTY_f3__2026-10"]); // s1 on hold
    expect(ledger.find((l) => l.id === "FACULTY_f1__2026-10")).toMatchObject({ fy: "2026-27", tds: 500, payDays: 28 });

    // Advances: what was deducted is recorded; the held person's recovers nothing; a paid-off one closes.
    const advs = Object.fromEntries(fake.list("colleges/c1/salaryAdvances").map((a) => [a.id, a]));
    expect(advs.a1).toMatchObject({ recoveries: { "2026-10": 5000 }, status: "ACTIVE" });
    expect(advs.a2).toMatchObject({ recoveries: {}, status: "ACTIVE" });
    expect(advs.a3).toMatchObject({ recoveries: { "2026-10": 2000 }, status: "CLOSED" });
    // November carries on from the balance.
    as("OFFICE");
    expect((await call(runs(), "POST", "/runs", { month: "2026-11" })).status).toBe(200);
    const nov = await call(month(), "GET", "/m", undefined, { month: "2026-11" });
    expect((nov.json.lines as Json[]).find((l) => l.employeeKey === "FACULTY_f1")).toMatchObject({ advance: 6667, advanceBalance: 15000 });
    as("ACCOUNTS");

    // Locked: no more moves, edits or recalculation; pay can't be changed into October.
    rv = m.json.run.rev;
    expect((await call(month(), "POST", "/m", { action: "RETURN", rev: rv, remarks: "x" }, M)).status).toBe(400);
    expect((await call(recalc(), "POST", "/r", { rev: rv }, M)).status).toBe(409);
    const put = await call(pay(), "PUT", "/p", { revisionCount: 1, revision: { effectiveFrom: "2026-10", amounts: { EB: 40000 } } }, { employeeKey: "FACULTY_f2" });
    expect(put.status).toBe(409);
    expect((await call(pay(), "PUT", "/p", { revisionCount: 1, revision: { effectiveFrom: "2026-11", amounts: { EB: 40000 } } }, { employeeKey: "FACULTY_f2" })).status).toBe(200);
  });

  it("only the Office prepares and removes a draft; the Principal reads", async () => {
    as("ACCOUNTS");
    expect((await call(runs(), "POST", "/runs", { month: "2026-09" })).status).toBe(403);
    as("OFFICE");
    expect((await call(runs(), "POST", "/runs", { month: "2026-09" })).status).toBe(200);
    Object.assign(who, { uid: "p1", role: "PRINCIPAL", collegeId: "c1" });
    expect((await call(month(), "GET", "/m", undefined, { month: "2026-09" })).status).toBe(200);
    expect((await call(month(), "POST", "/m", { action: "SUBMIT", rev: 1 }, { month: "2026-09" })).status).toBe(401);
    as("OFFICE");
    expect((await call(month(), "DELETE", "/m", undefined, { month: "2026-09" })).status).toBe(200);
    expect(fake.list("colleges/c1/payrollRuns/2026-09/lines")).toHaveLength(0);
  });
});
