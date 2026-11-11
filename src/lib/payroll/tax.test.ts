import { describe, expect, it } from "vitest";
import { annualTax, cleanTaxProfile, defaultTaxRules, monthlyTds, monthsAfter, monthsLeftInFy, regimeTax, slabTax } from "./tax";
import { lineTax, priorFigures, ZERO_FIGURES } from "./lineTax";
import { computeLine } from "./calc";
import { defaultPayrollSettings } from "./rules";
import { emptyTaxProfile } from "./tax";

const rules = defaultTaxRules("2026-27");
const NEW = rules.newRegime, OLD = rules.oldRegime;
const none = { declarations: { c80C: 0, c80CCD1B: 0, c80D: 0, c24b: 0, other: 0, rentPaid: 0, metro: false }, otherIncome: 0 };
const yr = (gross: number, extra: Partial<{ hra: number; basic: number; pf: number; pt: number }> = {}) => ({ gross, hra: 0, basic: 0, pf: 0, pt: 0, ...extra });

describe("new regime FY 2026-27 (the user's worked examples)", () => {
  it("taxable 16,25,000 -> 1,25,000 + cess 5,000 = 1,30,000", () => {
    expect(slabTax(1625000, NEW.slabs)).toBe(125000);
    expect(regimeTax(1625000, NEW, 4)).toMatchObject({ rebate: 0, surcharge: 0, cess: 5000, total: 130000 });
  });
  it("12,00,000 -> 0 (87A); 12,10,000 -> 10,000 + cess (marginal relief); gross 12,75,000 -> 0", () => {
    expect(regimeTax(1200000, NEW, 4).total).toBe(0);
    expect(regimeTax(1210000, NEW, 4)).toMatchObject({ slabTax: 61500, rebate: 51500, total: 10400 });
    expect(annualTax("NEW", yr(1275000), none, rules)).toMatchObject({ taxableIncome: 1200000, tax: { total: 0 } });
    // relief ends where slab tax is below the income over 12L
    expect(regimeTax(1300000, NEW, 4).total).toBe(Math.round(75000 * 1.04));
  });
  it("sheet row 10: 1,55,500 a month all year -> 13,700 a month", () => {
    const a = annualTax("NEW", yr(155500 * 12), none, rules);
    expect(a.taxableIncome).toBe(1791000);
    expect(a.tax.total).toBe(164528);
    expect(monthlyTds(a.tax.total, 0, "2026-04", 100)).toBe(13700);
  });
  it("surcharge with marginal relief just above 50 lakh", () => {
    const at = regimeTax(5000000, NEW, 0).total;
    const just = regimeTax(5010000, NEW, 0);
    expect(just.surcharge).toBeLessThan(((just.slabTax) * 10) / 100);
    expect(just.total).toBe(at + 10000);
    expect(regimeTax(6000000, NEW, 0).surcharge).toBe(slabTax(6000000, NEW.slabs) * 0.1);
  });
});

describe("old regime", () => {
  it("HRA exemption, standard deduction, PT, 80C with PF, 24(b), 87A", () => {
    const p = { declarations: { c80C: 100000, c80CCD1B: 60000, c80D: 20000, c24b: 250000, other: 0, rentPaid: 240000, metro: false }, otherIncome: 10000 };
    const a = annualTax("OLD", yr(1200000, { hra: 120000, basic: 600000, pf: 36000, pt: 2400 }), p, rules);
    // HRA: least of 1,20,000 / 2,40,000 - 60,000 / 40% of 6,00,000 = 1,20,000
    expect(a.hraExemption).toBe(120000);
    expect(a.chapterVIA).toBe(136000 + 50000 + 20000); // 80C 1,00,000 + PF 36,000 is under the 1.5L cap
    expect(a.houseLoss).toBe(200000);
    expect(a.taxableIncome).toBe(1200000 - 120000 - 50000 - 2400 + 10000 - 200000 - 206000);
    expect(regimeTax(500000, OLD, 4).total).toBe(0);
    expect(regimeTax(510000, OLD, 4).total).toBe(Math.round((12500 + 2000) * 1.04));
  });
});

describe("monthly TDS", () => {
  it("spreads what's left over the months to March; March takes the rest; never negative", () => {
    expect([monthsLeftInFy("2026-04"), monthsLeftInFy("2026-11"), monthsLeftInFy("2027-03")]).toEqual([12, 5, 1]);
    expect(monthsAfter("2026-11")).toEqual(["2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(monthsAfter("2026-11", "2027-01")).toEqual(["2026-12", "2027-01"]);
    expect(monthlyTds(130000, 60000, "2026-11", 100)).toBe(14000);
    expect(monthlyTds(130000, 129950, "2027-03", 100)).toBe(50);
    expect(monthlyTds(130000, 140000, "2026-11", 100)).toBe(0);
  });
  it("a line: opening Apr-Sep + released Oct + November + Dec-Mar projected", () => {
    const settings = defaultPayrollSettings();
    const amounts = { EB: 50263, AGP: 9000, DA: 88895, HRA: 5926, OA: 1416 }; // row 10, 1,55,500
    const result = computeLine({ settings, amounts, monthDays: 30, payDays: 30, exempt: [] });
    const profile = { ...emptyTaxProfile("FACULTY_x", "2026-27"), opening: { upToMonth: "2026-09", gross: 155500 * 6, hra: 0, basic: 0, tds: 13700 * 6, pf: 18000, pt: 1200 } };
    const oct = { month: "2026-10", figures: { ...ZERO_FIGURES, gross: 155500, tds: 13700 } };
    const prior = priorFigures(profile, [oct, { month: "2026-09", figures: { ...ZERO_FIGURES, gross: 999999 } }], "2026-11");
    expect(prior.gross).toBe(155500 * 7);
    const t = lineTax({ amounts, exempt: [], result }, "2026-11", settings, { rules, profile, prior });
    expect(t.taxCalc).toMatchObject({ annualSalary: 155500 * 12, annualTax: 164528, deductedBefore: 13700 * 7, monthsLeft: 5 });
    expect(t.tdsAuto).toBe(Math.round((164528 - 95900) / 5 / 100) * 100);
    // rules not confirmed -> nothing worked out
    expect(lineTax({ amounts, exempt: [], result }, "2026-11", settings, { rules: null, profile, prior }).tdsAuto).toBe(0);
  });
  it("profile checks", () => {
    expect(() => cleanTaxProfile({ regime: "X" }, "2026-27")).toThrow(/regime/);
    expect(() => cleanTaxProfile({ regime: "NEW", opening: { upToMonth: "2027-04" } }, "2026-27")).toThrow(/between/);
    expect(cleanTaxProfile({ regime: "OLD", declarations: { c80C: "150000" } }, "2026-27").declarations.c80C).toBe(150000);
  });
});
