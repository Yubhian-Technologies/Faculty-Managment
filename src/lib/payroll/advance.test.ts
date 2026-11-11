import { describe, expect, it } from "vitest";
import { advanceBalance, advanceDues, allocateRecovery, balanceBefore, cleanAdvance, monthFromCell, planAdvanceImport } from "./advance";
import type { SalaryAdvance } from "@/types/payroll";

const adv = (id: string, over: Partial<SalaryAdvance> = {}): SalaryAdvance => ({
  id, employeeKey: "FACULTY_a", employeeCode: "E1", name: "A", amount: 20000, recoveredBefore: 0, instalment: 6667, recoveryPercent: 33.335,
  startMonth: "2026-10", status: "ACTIVE", recoveries: {}, rev: 1, createdAt: `2026-10-0${id.length}`, createdByName: "x", history: [], ...over,
});

describe("salary advances", () => {
  it("20,000 at 6,667 a month: 6,667, 6,667, then the 6,666 left", () => {
    let a = adv("x");
    const got: number[] = [];
    for (const m of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
      const d = advanceDues([a], m);
      got.push(d.total);
      if (d.total) a = { ...a, recoveries: { ...a.recoveries, [m]: d.total } };
    }
    expect(got).toEqual([6667, 6667, 6666, 0]);
    expect(advanceBalance(a)).toBe(0);
  });
  it("not before its first month; paused owes nothing but keeps its balance; recovered-before counts", () => {
    expect(advanceDues([adv("x", { startMonth: "2026-11" })], "2026-10").total).toBe(0);
    expect(advanceDues([adv("x", { status: "PAUSED" })], "2026-10")).toMatchObject({ total: 0, balance: 20000 });
    expect(advanceDues([adv("x", { recoveredBefore: 18000 })], "2026-10").total).toBe(2000);
  });
  it("a re-release of the same month doesn't count its own recovery twice", () => {
    const a = adv("x", { recoveries: { "2026-10": 6667 } });
    expect(balanceBefore(a, "2026-10")).toBe(20000);
    expect(balanceBefore(a, "2026-11")).toBe(13333);
  });
  it("two advances: due added up, recovery split oldest first within each balance", () => {
    const d = advanceDues([adv("bb", { amount: 3000, instalment: 1000 }), adv("a", { amount: 500, instalment: 1000 })], "2026-10");
    expect(d).toMatchObject({ total: 1500, balance: 3500, parts: [{ advanceId: "a", amount: 500 }, { advanceId: "bb", amount: 1000 }] });
    expect(allocateRecovery(1200, [{ advanceId: "a", balance: 500 }, { advanceId: "bb", balance: 3000 }])).toEqual({ a: 500, bb: 700 });
    expect(allocateRecovery(0, [{ advanceId: "a", balance: 500 }])).toEqual({});
  });
  it("instalment typed or as a %", () => {
    expect(cleanAdvance({ amount: 20000, instalment: 6667, startMonth: "2026-11" })).toMatchObject({ instalment: 6667, recoveryPercent: 33.335 });
    expect(cleanAdvance({ amount: 20000, recoveryPercent: 25, startMonth: "2026-11" })).toMatchObject({ instalment: 5000, recoveryPercent: 25 });
    expect(() => cleanAdvance({ amount: 20000, startMonth: "2026-11" })).toThrow(/amount or a %/);
    expect(() => cleanAdvance({ amount: 1000, recoveredBefore: 1000, instalment: 1, startMonth: "2026-11" })).toThrow(/less than/);
    expect(() => cleanAdvance({ amount: 1000, instalment: 2000, startMonth: "2026-11" })).toThrow(/more than the advance/);
  });
  it("import of running advances", () => {
    expect([monthFromCell("Nov 2026"), monthFromCell("11/2026"), monthFromCell("2026-11-01"), monthFromCell("November-2026"), monthFromCell("x")]).toEqual(["2026-11", "2026-11", "2026-11", "2026-11", null]);
    const plan = planAdvanceImport(["Emp Code", "Name", "Advance amount", "Recovered so far", "Monthly recovery", "First month"], [
      { row: 2, code: "e1", values: { "Advance amount": "20,000", "Recovered so far": "6667", "Monthly recovery": "6667", "First month": "Nov 2026" } },
      { row: 3, code: "zz", values: { "Advance amount": "100", "Monthly recovery": "10", "First month": "Nov 2026" } },
      { row: 4, code: "E1", values: { "Advance amount": "100", "First month": "Nov 2026" } },
    ], [{ employeeKey: "FACULTY_a", employeeCode: "E1", name: "A" }]);
    expect(plan.rows.map((r) => r.status)).toEqual(["OK", "ERROR", "ERROR"]);
    expect(plan.rows[0].advance).toMatchObject({ amount: 20000, recoveredBefore: 6667, instalment: 6667, startMonth: "2026-11" });
    expect(planAdvanceImport(["Emp Code", "Bonus"], [], []).unknownColumns).toEqual(["Bonus"]);
  });
});
