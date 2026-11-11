import { describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";
import { computeLine } from "./calc";
import { defaultPayrollSettings } from "./rules";
import { maskAccount, payslipFromLine } from "./payslip";
import { isAllowedReadOnlyRequest, isAllowedReadOnlyPage } from "@/lib/auth/readOnlyAccess";
import { getPayslipHTML } from "@/lib/pdf/payslipTemplate";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// Payslips: built from a month's line; each person reads only their OWN, only for released months.

const fake = new FakeFirestore();
const who = { uid: "u1", role: "PANEL_MEMBER", collegeId: "c1" };
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => asFirestore(fake) }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x", role: who.role, collegeId: who.collegeId, locationId: "", exp: 0 };
  },
  requireRole: async () => { throw new Error("UNAUTHORIZED"); },
}));

const settings = defaultPayrollSettings();
const lineOf = (key: string, name: string, payDays = 31): PayrollLine => {
  const amounts = { EB: 16550, AGP: 6000, DA: 2255, HRA: 2255, OA: 540 };
  return {
    employeeKey: key, kind: "FACULTY", recordId: key.slice(8), employeeCode: name, name, department: "ME", designation: "AP", section: "TEACHING",
    bank: { account: "12345678901", ifsc: "SBIN0001", bankName: "SBI" }, revisionFrom: "2026-04", amounts, exempt: [],
    auto: { monthDays: 31, notEmployedDays: 0, leaveLop: 0, attendanceLop: 0, absentDates: [], lop: 31 - payDays, payDays },
    payDays, oneOffs: [], manual: {}, tds: 0, advance: 0, issues: [], history: [],
    result: computeLine({ settings, amounts, monthDays: 31, payDays }),
  };
};
const run = (month: string, status: PayrollRun["status"]) => ({ month, status, settings, release: status === "RELEASED" ? { paidOn: `${month}-30`, reference: "R", at: "", byName: "" } : undefined });

fake.seed("colleges/c1", { name: "VWU" });
fake.seed("colleges/c1/facultyMembers/f1", { employeeId: "E1", legalName: "MOUNIKA", status: "ACTIVE", userUid: "u1" });
fake.seed("colleges/c1/facultyMembers/f2", { employeeId: "E2", legalName: "OTHER", status: "ACTIVE", userUid: "u2" });
for (const [m, st] of [["2026-09", "RELEASED"], ["2026-10", "RELEASED"], ["2026-11", "DRAFT"]] as const) {
  fake.seed(`colleges/c1/payrollRuns/${m}`, run(m, st));
  fake.seed(`colleges/c1/payrollRuns/${m}/lines/FACULTY_f1`, lineOf("FACULTY_f1", "MOUNIKA", m === "2026-10" ? 29.5 : 31) as unknown as Record<string, unknown>);
  fake.seed(`colleges/c1/payrollRuns/${m}/lines/FACULTY_f2`, lineOf("FACULTY_f2", "OTHER") as unknown as Record<string, unknown>);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON in a test
const get = async (path: Promise<Json>, params?: Record<string, string>) => {
  const res = await (await path).GET(new Request("http://x/"), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status as number, json: (await res.json()) as Json };
};

describe("payslips", () => {
  it("builds from a line: earned beside fixed, masked account, LOP, net in words", () => {
    const p = payslipFromLine(run("2026-10", "RELEASED") as PayrollRun, lineOf("FACULTY_f1", "MOUNIKA", 29.5), { name: "VWU" });
    expect(p).toMatchObject({ final: true, lop: 1.5, payDays: 29.5, paidOn: "2026-10-30", person: { bank: "SBI XXXX8901" } });
    expect(p.earnings[0]).toEqual({ label: "E.B", fixed: 16550, earned: Math.round((16550 * 29.5) / 31) });
    expect(p.net).toBe(p.gross - p.totalDeductions);
    expect(maskAccount("")).toBe("-");
    const html = getPayslipHTML(p);
    expect(html).toContain("Payslip for October 2026");
    expect(html).not.toContain("PREVIEW");
    expect(getPayslipHTML({ ...p, final: false })).toContain("PREVIEW");
  });

  it("each person sees only their own released months", async () => {
    const my = await get(import("@/app/api/college/payroll/my/route"));
    expect(my.json.employee.employeeCode).toBe("E1");
    expect(my.json.payslips.map((x: Json) => x.month)).toEqual(["2026-10", "2026-09"]);
    expect((await get(import("@/app/api/college/payroll/my/[month]/route"), { month: "2026-10" })).json.payslip.person.name).toBe("MOUNIKA");
    expect((await get(import("@/app/api/college/payroll/my/[month]/route"), { month: "2026-11" })).status).toBe(404);
    Object.assign(who, { uid: "nobody" });
    expect((await get(import("@/app/api/college/payroll/my/route"))).json).toEqual({ employee: null, payslips: [] });
    Object.assign(who, { uid: "u2" });
    expect((await get(import("@/app/api/college/payroll/my/[month]/route"), { month: "2026-10" })).json.payslip.person.name).toBe("OTHER");
    Object.assign(who, { uid: "u1", role: "STUDENT" });
    expect((await get(import("@/app/api/college/payroll/my/route"))).status).toBe(401);
    Object.assign(who, { role: "PANEL_MEMBER" });
  });

  it("someone who has left keeps their own payslips (read only)", () => {
    expect(isAllowedReadOnlyRequest("GET", "/api/college/payroll/my")).toBe(true);
    expect(isAllowedReadOnlyRequest("GET", "/api/college/payroll/my/2026-10")).toBe(true);
    expect(isAllowedReadOnlyRequest("GET", "/api/college/payroll/my/tax")).toBe(true);
    expect(isAllowedReadOnlyRequest("GET", "/api/college/payroll/runs")).toBe(false);
    expect(isAllowedReadOnlyRequest("POST", "/api/college/payroll/my")).toBe(false);
    expect(isAllowedReadOnlyPage("/payslips")).toBe(true);
  });
});

describe("EPF figures for the ECR", () => {
  it("wages as deducted: a capped 3,000 is 25,000 wages; EPS on up to 15,000; NCP = days not paid", async () => {
    const { epfRow } = await import("@/components/payroll/payrollExports");
    const r = run("2026-10", "RELEASED") as PayrollRun;
    expect(epfRow(r, lineOf("FACULTY_f1", "M"))).toMatchObject({ pf: 2977, epfWages: 24805, epsWages: 15000, eps: 1250, diff: 1727, ncp: 0 });
    const big = lineOf("FACULTY_f2", "B");
    big.result = computeLine({ settings, amounts: { EB: 50000 }, monthDays: 31, payDays: 29.5 });
    big.payDays = 29.5;
    expect(epfRow(r, big)).toMatchObject({ pf: 3000, epfWages: 25000, ncp: 2 });
  });
});
