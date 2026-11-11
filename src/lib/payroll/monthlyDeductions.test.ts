import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { planMonthlyDeductions } from "./monthlyDeductions";
import { defaultPayrollSettings } from "./rules";
import type { PayDeduction } from "@/types/payroll";

// A month's MediClaim (a deduction entered each month) from a file: the pure rules, then the real route on an
// in-memory Firestore - preview writes nothing, apply re-prices the lines and the month's totals.

const MEDICLAIM: PayDeduction = { kind: "MANUAL", id: "MEDICLAIM", label: "MediClaim", active: true };
const settings = { ...defaultPayrollSettings(), deductions: [...defaultPayrollSettings().deductions, MEDICLAIM] };
const lines = [
  { employeeKey: "FACULTY_a", employeeCode: "VWU0806", name: "A", manual: {} },
  { employeeKey: "FACULTY_b", employeeCode: "VWU0810", name: "B", manual: { MEDICLAIM: 500 } },
  { employeeKey: "FACULTY_c", employeeCode: "VWU0690", name: "C", manual: { MEDICLAIM: 900 } },
];
const r = (row: number, code: string, v: Record<string, string>) => ({ row, code, values: { "Emp Code": code, ...v } });

describe("monthly deductions file - rules", () => {
  it("blank leaves it, a number replaces it (0 = none); the salary sheet's other columns are ignored", () => {
    const headers = ["Emp Code", "EmpName", "E.B", "PF", "PT", "MediClaim", "Total Ded", "Net Salary"];
    const plan = planMonthlyDeductions(headers, [
      r(2, "vwu0806", { MediClaim: "3,402", "E.B": "15600", PF: "1800" }),
      r(3, "VWU0810", { MediClaim: "" }),
      r(4, "VWU0690", { MediClaim: "0" }),
      r(5, "", { EmpName: "Total" }),
    ], lines, settings);
    expect(plan.problem).toBeNull();
    expect(plan.unknownColumns).toEqual([]);
    expect(plan.skipped).toBe(1);
    expect(plan.rows.map((x) => [x.status, x.after])).toEqual([["CHANGED", { MEDICLAIM: 3402 }], ["SAME", { MEDICLAIM: 500 }], ["CHANGED", {}]]);
    expect(plan.errors).toBe(0);
  });
  it("every problem is listed and stops the file", () => {
    const plan = planMonthlyDeductions(["Emp Code", "MediClaim"], [
      r(2, "VWU0806", { MediClaim: "1.5" }), r(3, "NOPE", { MediClaim: "1" }), r(4, "VWU0806", { MediClaim: "1" }),
    ], lines, settings);
    expect(plan.rows.map((x) => x.error)).toEqual([expect.stringMatching(/whole rupee/), "Not in this month's salaries", "Emp Code repeated (row 2)"]);
    expect(plan.errors).toBe(3);
    expect(planMonthlyDeductions(["Emp Code", "E.B"], [], lines, settings).problem).toMatch(/no column for a deduction entered each month/);
    expect(planMonthlyDeductions(["Emp Code", "MediClaim"], [], lines, defaultPayrollSettings()).unknownColumns).toEqual(["MediClaim"]);
  });
});

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
const call = async (mod: Promise<Json>, method: string, url: string, body?: unknown, params?: Record<string, string>) => {
  const res = await (await mod)[method](new Request(`http://x${url}?collegeId=c1`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status as number, json: (await res.json()) as Json };
};

beforeEach(() => {
  fake.seed("colleges/c1", { name: "VWU", locationId: "L1" });
  fake.seed("colleges/c1/payrollSettings/config", { ...settings, version: 1 });
  fake.seed("colleges/c1/facultyMembers/f1", { employeeId: "VWU0806", legalName: "M HARI", department: "ME", status: "ACTIVE", joiningDate: new Date("2020-06-01"), bankAccountNumber: "1", ifscCode: "X" });
  fake.seed("colleges/c1/employeePay/FACULTY_f1", { revisions: [{ effectiveFrom: "2026-04", amounts: { EB: 15600, AGP: 6000, DA: 2592, HRA: 2160, OA: 3648 }, exempt: [], byName: "a", byUid: "a", at: "t" }] });
});

describe("monthly deductions file - route", () => {
  it("preview writes nothing; apply sets MediClaim on the line, re-prices it and the totals", async () => {
    const prep = await call(import("@/app/api/college/payroll/runs/route"), "POST", "/runs", { month: "2026-11" });
    expect(prep.status).toBe(200);
    const read = () => call(import("@/app/api/college/payroll/runs/[month]/route"), "GET", "/m", undefined, { month: "2026-11" });
    const before = await read();
    const net0 = before.json.lines[0].result.net as number;
    const route = import("@/app/api/college/payroll/runs/[month]/deductions-import/route");
    const file = { headers: ["Emp Code", "MediClaim"], rows: [{ row: 2, code: "VWU0806", values: { "Emp Code": "VWU0806", MediClaim: "3402" } }] };
    const preview = await call(route, "POST", "/d", { mode: "preview", rev: before.json.run.rev, ...file }, { month: "2026-11" });
    expect(preview.json.rows[0]).toMatchObject({ status: "CHANGED", after: { MEDICLAIM: 3402 } });
    expect((await read()).json.lines[0].manual).toEqual({});
    expect((await call(route, "POST", "/d", { mode: "apply", rev: before.json.run.rev - 1, ...file }, { month: "2026-11" })).status).toBe(409);
    const apply = await call(route, "POST", "/d", { mode: "apply", rev: before.json.run.rev, ...file }, { month: "2026-11" });
    expect(apply.json.applied).toBe(1);
    const after = await read();
    expect(after.json.lines[0]).toMatchObject({ manual: { MEDICLAIM: 3402 }, result: { net: net0 - 3402, deductions: { MEDICLAIM: 3402 } } });
    expect(after.json.run.totals.net).toBe(net0 - 3402);
    expect(after.json.lines[0].history.at(-1).change).toMatch(/MediClaim 3402 \(from a file\)/);
  });
});
