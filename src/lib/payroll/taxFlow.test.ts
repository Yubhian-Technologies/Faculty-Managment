import { describe, expect, it, vi } from "vitest";
import { FakeFirestore, asFirestore } from "@/test-support/fakeFirestore";

// Income tax through the REAL routes: nothing is worked out until Accounts confirm the year's rules;
// the go-live import brings April-September; October's TDS spreads what's left; after October is
// released, November spreads what's left again; a switch to the old regime with declarations lowers it.

const fake = new FakeFirestore();
const who = { uid: "office1", role: "COLLEGE_OFFICE", collegeId: "c1", locationId: "" };
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => asFirestore(fake) }));
vi.mock("@/lib/auth/verifySession", () => ({
  requireRole: async (...roles: string[]) => {
    if (!roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: `${who.uid}@x`, role: who.role, collegeId: who.collegeId, locationId: who.locationId, exp: 0 };
  },
}));
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON in a test
const as = (r: "OFFICE" | "ACCOUNTS") => Object.assign(who, r === "OFFICE" ? { uid: "office1", role: "COLLEGE_OFFICE", collegeId: "c1", locationId: "" } : { uid: "acc1", role: "ACCOUNTS", collegeId: "", locationId: "L1" });
const call = async (mod: Promise<Json>, method: string, query: string, body?: unknown, params?: Record<string, string>) => {
  const res = await (await mod)[method](new Request(`http://x/?collegeId=c1${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), params ? { params: Promise.resolve(params) } : undefined);
  return { status: res.status as number, json: (await res.json()) as Json };
};
const runs = () => import("@/app/api/college/payroll/runs/route");
const month = () => import("@/app/api/college/payroll/runs/[month]/route");
const recalc = () => import("@/app/api/college/payroll/runs/[month]/recalculate/route");
const rulesApi = () => import("@/app/api/college/payroll/tax/rules/route");
const importApi = () => import("@/app/api/college/payroll/tax/import/route");
const profileApi = () => import("@/app/api/college/payroll/tax/profiles/[employeeKey]/route");
const statement = () => import("@/app/api/college/payroll/tax/statement/[employeeKey]/route");
const FY = "&fy=2026-27";

fake.seed("colleges/c1", { name: "VWU", locationId: "L1" });
// Sheet row 10: 1,55,500 a month (E.B 50,263 AGP 9,000 DA 88,895 HRA 5,926 OA 1,416).
fake.seed("colleges/c1/facultyMembers/f1", { employeeId: "SVECW0393", legalName: "HK", department: "ME", status: "ACTIVE", joiningDate: new Date("2015-06-01"), bankAccountNumber: "1", ifscCode: "X" });
fake.seed("colleges/c1/employeePay/FACULTY_f1", { revisions: [{ effectiveFrom: "2026-04", amounts: { EB: 50263, AGP: 9000, DA: 88895, HRA: 5926, OA: 1416 }, exempt: [], byName: "a", byUid: "a", at: "t" }] });

describe("income tax in the monthly run", () => {
  it("rules -> opening import -> Oct TDS -> release -> Nov TDS -> old regime", async () => {
    as("OFFICE");
    await call(runs(), "POST", "", { month: "2026-10" });
    let m = await call(month(), "GET", "", undefined, { month: "2026-10" });
    expect(m.json.run.taxRulesConfirmed).toBe(false);
    expect(m.json.lines[0]).toMatchObject({ tds: 0, taxCalc: { rulesConfirmed: false } });

    as("ACCOUNTS");
    const r = await call(rulesApi(), "GET", FY);
    expect(r.json.saved).toBe(false);
    expect((await call(rulesApi(), "PUT", FY, { rules: r.json.rules, version: 0 })).status).toBe(200);
    // April - September paid outside the app: 6 x 1,55,500, TDS 6 x 13,700.
    const headers = ["Emp Code", "Regime", "Paid up to", "Gross paid", "Basic paid", "HRA paid", "TDS deducted", "PF deducted", "PT deducted"];
    const imp = await call(importApi(), "POST", FY, { mode: "apply", headers, rows: [{ row: 2, code: "svecw0393", values: { "Emp Code": "svecw0393", Regime: "New", "Paid up to": "Sep 2026", "Gross paid": "933000", "TDS deducted": "82200", "PF deducted": "18000", "PT deducted": "1200" } }] });
    expect(imp.json.applied).toBe(1);

    as("OFFICE");
    m = await call(month(), "GET", "", undefined, { month: "2026-10" });
    await call(recalc(), "POST", "", { rev: m.json.run.rev }, { month: "2026-10" });
    m = await call(month(), "GET", "", undefined, { month: "2026-10" });
    const oct = m.json.lines[0];
    // Annual 18,66,000 -> 1,64,528; 82,200 deducted; 6 months left -> 13,721 -> 13,700.
    expect(oct.taxCalc).toMatchObject({ rulesConfirmed: true, annualSalary: 1866000, annualTax: 164528, deductedBefore: 82200, monthsLeft: 6 });
    expect(oct.tds).toBe(13700);
    expect(oct.result.deductions.IT).toBe(13700);

    const rv = m.json.run.rev;
    await call(month(), "POST", "", { action: "SUBMIT", rev: rv }, { month: "2026-10" });
    as("ACCOUNTS");
    await call(month(), "POST", "", { action: "APPROVE", rev: rv + 1 }, { month: "2026-10" });
    expect((await call(month(), "POST", "", { action: "RELEASE", rev: rv + 2, paidOn: "2026-10-31", reference: "R1" }, { month: "2026-10" })).status).toBe(200);

    // November: 82,200 + 13,700 deducted, 5 months left -> (1,64,528 - 95,900) / 5 = 13,725.6 -> 13,700.
    as("OFFICE");
    await call(runs(), "POST", "", { month: "2026-11" });
    m = await call(month(), "GET", "", undefined, { month: "2026-11" });
    expect(m.json.lines[0]).toMatchObject({ tds: 13700, taxCalc: { deductedBefore: 95900, monthsLeft: 5 } });

    // Old regime with declarations - for this salary it costs MORE (2,53,843 vs 1,64,528); the statement shows both.
    as("ACCOUNTS");
    const st = await call(statement(), "GET", FY, undefined, { employeeKey: "FACULTY_f1" });
    expect(st.json.released.map((x: Json) => x.month)).toEqual(["2026-10"]);
    expect(st.json.estimate.calc.annualTax).toBe(164528);
    expect(st.json.estimate.otherRegimeTax).toBeGreaterThan(164528);
    const prof = st.json.profile;
    expect((await call(profileApi(), "PUT", FY, { rev: prof.rev, profile: { ...prof, regime: "OLD", declarations: { ...prof.declarations, c80C: 150000, c80D: 25000, c24b: 200000 } } }, { employeeKey: "FACULTY_f1" })).status).toBe(200);
    as("OFFICE");
    await call(recalc(), "POST", "", { rev: m.json.run.rev }, { month: "2026-11" });
    m = await call(month(), "GET", "", undefined, { month: "2026-11" });
    const nov = m.json.lines[0];
    expect(nov.taxCalc.regime).toBe("OLD");
    // 18,66,000 - 50,000 std - 2,400 PT - 2,00,000 24(b) - 1,50,000 80C - 25,000 80D = 14,38,600 -> 2,44,080 + cess
    expect(nov.taxCalc).toMatchObject({ taxableIncome: 1438600, annualTax: 253843 });
    expect(nov.tds).toBe(31600); // (2,53,843 - 95,900) / 5 = 31,588.6
  });
});
