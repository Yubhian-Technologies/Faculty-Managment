import type { PayrollTaxProfile, PayrollTaxRules, RegimeRules, SurchargeSlab, TaxRegime, TaxSlab } from "@/types/payroll";
import { PayrollRuleError, roundRupee, roundTo } from "./rules";

// Income tax on salary (TDS) - pure.
//   New regime: salary - standard deduction + other income = taxable income; slab tax; 87A rebate up to
//   the limit with marginal relief just above it; surcharge (with marginal relief); cess.
//   Old regime: salary - HRA exemption - standard deduction - professional tax + other income
//   - house-loan interest (24b) - 80C (incl. employee PF) - 80CCD(1B) - 80D - other = taxable income; slabs;
//   87A rebate; surcharge; cess.
// Taxable income is rounded to the nearest 10 (s.288A), tax to the nearest rupee.
// Monthly TDS = (annual tax - TDS already deducted this year) / months left including this one, rounded to
// the college's step (Rs. 100 on the sheet); March takes exactly what is left. Never negative.

const NEW_SURCHARGE: SurchargeSlab[] = [{ above: 5_000_000, rate: 10 }, { above: 10_000_000, rate: 15 }, { above: 20_000_000, rate: 25 }];

/** FY 2026-27 values as printed on the user's sheet - Accounts must confirm (save) them before any TDS is worked out. */
export function defaultTaxRules(fy: string): PayrollTaxRules {
  return {
    fy,
    newRegime: {
      slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }],
      standardDeduction: 75000, rebateIncomeLimit: 1200000, rebateMax: 60000, rebateMarginalRelief: true, surcharge: NEW_SURCHARGE,
    },
    oldRegime: {
      slabs: [{ upTo: 250000, rate: 0 }, { upTo: 500000, rate: 5 }, { upTo: 1000000, rate: 20 }, { upTo: null, rate: 30 }],
      standardDeduction: 50000, rebateIncomeLimit: 500000, rebateMax: 12500, rebateMarginalRelief: false,
      surcharge: [...NEW_SURCHARGE, { above: 50_000_000, rate: 37 }],
    },
    cessPercent: 4,
    caps: { c80C: 150000, c80CCD1B: 50000, c80D: 100000, c24b: 200000 },
    basicParts: ["EB", "DA"],
    hraPart: "HRA",
    version: 0,
  };
}

export function slabTax(income: number, slabs: TaxSlab[]): number {
  let tax = 0, from = 0;
  for (const s of slabs) {
    const to = s.upTo ?? Infinity;
    if (income > from) tax += ((Math.min(income, to) - from) * s.rate) / 100;
    from = to;
    if (income <= to) break;
  }
  return tax;
}

export interface RegimeTax { slabTax: number; rebate: number; surcharge: number; cess: number; total: number }

/** Tax on a taxable income under one regime (income already rounded to 10). */
export function regimeTax(income: number, r: RegimeRules, cessPercent: number): RegimeTax {
  const base = slabTax(income, r.slabs);
  let afterRebate = base;
  if (income <= r.rebateIncomeLimit) afterRebate = Math.max(0, base - r.rebateMax);
  else if (r.rebateMarginalRelief) afterRebate = Math.min(base, income - r.rebateIncomeLimit);
  const rebate = base - afterRebate;

  // Surcharge at the highest step crossed, with marginal relief: tax + surcharge never more than the tax
  // + surcharge at that step's income plus the income above it.
  let surcharge = 0;
  const steps = [...r.surcharge].sort((a, b) => a.above - b.above);
  const step = [...steps].reverse().find((s) => income > s.above);
  if (step) {
    surcharge = (afterRebate * step.rate) / 100;
    const prev = steps.filter((s) => s.above < step.above).pop();
    const atStep = slabTax(step.above, r.slabs);
    const atStepTotal = atStep + (prev ? (atStep * prev.rate) / 100 : 0);
    const cap = atStepTotal + (income - step.above);
    if (afterRebate + surcharge > cap) surcharge = Math.max(0, cap - afterRebate);
  }
  const cess = ((afterRebate + surcharge) * cessPercent) / 100;
  return { slabTax: base, rebate, surcharge, cess, total: roundRupee(afterRebate + surcharge + cess) };
}

export interface SalaryYear {
  gross: number;   // taxable salary of the year (paid + this month + projected), incl. a previous employer's
  hra: number;     // HRA received in the year (old regime exemption)
  basic: number;   // basic (E.B + DA) of the year
  pf: number;      // employee PF (counts in 80C)
  pt: number;      // professional tax (old regime deduction)
}

export interface AnnualTax {
  regime: TaxRegime;
  salary: number;
  hraExemption: number;
  standardDeduction: number;
  ptDeduction: number;
  otherIncome: number;
  houseLoss: number;
  chapterVIA: number;
  taxableIncome: number;
  tax: RegimeTax;
}

export function annualTax(regime: TaxRegime, year: SalaryYear, profile: Pick<PayrollTaxProfile, "declarations" | "otherIncome">, rules: PayrollTaxRules): AnnualTax {
  const r = regime === "NEW" ? rules.newRegime : rules.oldRegime;
  const d = profile.declarations;
  const otherIncome = Math.max(0, profile.otherIncome);
  let hraExemption = 0, ptDeduction = 0, houseLoss = 0, chapterVIA = 0;
  if (regime === "OLD") {
    if (year.hra > 0 && d.rentPaid > 0) {
      hraExemption = Math.max(0, Math.min(year.hra, d.rentPaid - 0.1 * year.basic, (d.metro ? 0.5 : 0.4) * year.basic));
    }
    ptDeduction = Math.min(year.pt, 2500);
    houseLoss = Math.min(d.c24b, rules.caps.c24b);
    chapterVIA = Math.min(d.c80C + year.pf, rules.caps.c80C) + Math.min(d.c80CCD1B, rules.caps.c80CCD1B) + Math.min(d.c80D, rules.caps.c80D) + Math.max(0, d.other);
  }
  const salaryIncome = Math.max(0, year.gross - hraExemption - Math.min(r.standardDeduction, year.gross) - ptDeduction);
  const gross = Math.max(0, salaryIncome + otherIncome - houseLoss);
  const taxableIncome = Math.max(0, Math.round(Math.max(0, gross - chapterVIA) / 10) * 10);
  return {
    regime, salary: year.gross, hraExemption: roundRupee(hraExemption), standardDeduction: Math.min(r.standardDeduction, year.gross), ptDeduction,
    otherIncome, houseLoss, chapterVIA, taxableIncome, tax: regimeTax(taxableIncome, r, rules.cessPercent),
  };
}

/** Months from `month` to March of its financial year, both included (Apr -> 12, Mar -> 1). */
export const monthsLeftInFy = (month: string) => {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 16 - m : 4 - m;
};

/** The months of a financial year after `month`, up to March (and not past `lastMonth`). */
export function monthsAfter(month: string, lastMonth?: string): string[] {
  const out: string[] = [];
  let [y, m] = month.split("-").map(Number);
  for (let i = 1; i < monthsLeftInFy(month); i++) {
    m++; if (m > 12) { m = 1; y++; }
    const k = `${y}-${String(m).padStart(2, "0")}`;
    if (lastMonth && k > lastMonth) break;
    out.push(k);
  }
  return out;
}

export function monthlyTds(annual: number, deductedBefore: number, month: string, roundStep: number): number {
  const left = Math.max(0, annual - deductedBefore);
  const months = monthsLeftInFy(month);
  if (left <= 0) return 0;
  return months <= 1 ? roundRupee(left) : Math.min(left, roundTo(left / months, roundStep));
}

// ─── Checks on save ─────────────────────────────────────────────────────────────

const money = (v: unknown, what: string) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new PayrollRuleError(`${what}: give an amount`);
  return Math.round(n);
};
const pct = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new PayrollRuleError(`${what}: give a % from 0 to 100`);
  return n;
};

function cleanRegime(r: unknown, label: string): RegimeRules {
  const b = (r ?? {}) as Partial<RegimeRules>;
  if (!Array.isArray(b.slabs) || b.slabs.length === 0) throw new PayrollRuleError(`${label}: add the slabs`);
  const slabs = b.slabs.map((s, i) => ({ upTo: s?.upTo === null || s?.upTo === undefined || (s.upTo as unknown) === "" ? null : money(s.upTo, `${label} slab ${i + 1}`), rate: pct(s?.rate, `${label} slab ${i + 1}`) }));
  slabs.forEach((s, i) => {
    if (i < slabs.length - 1 && s.upTo === null) throw new PayrollRuleError(`${label}: only the last slab may be "and above"`);
    if (i > 0 && s.upTo !== null && (slabs[i - 1].upTo ?? Infinity) >= s.upTo) throw new PayrollRuleError(`${label}: slab limits must go up`);
  });
  if (slabs[slabs.length - 1].upTo !== null) throw new PayrollRuleError(`${label}: the last slab must be "and above"`);
  const surcharge = (Array.isArray(b.surcharge) ? b.surcharge : []).map((s, i) => ({ above: money(s?.above, `${label} surcharge ${i + 1}`), rate: pct(s?.rate, `${label} surcharge ${i + 1}`) }))
    .sort((a, c) => a.above - c.above);
  return {
    slabs, surcharge, standardDeduction: money(b.standardDeduction, `${label} standard deduction`),
    rebateIncomeLimit: money(b.rebateIncomeLimit, `${label} 87A income limit`), rebateMax: money(b.rebateMax, `${label} 87A rebate`), rebateMarginalRelief: !!b.rebateMarginalRelief,
  };
}

export function cleanTaxRules(input: unknown, fy: string, earningIds: string[]): Omit<PayrollTaxRules, "version" | "updatedAt" | "updatedByName"> {
  const b = (input ?? {}) as Partial<PayrollTaxRules>;
  const caps = (b.caps ?? {}) as Partial<PayrollTaxRules["caps"]>;
  const basicParts = (Array.isArray(b.basicParts) ? b.basicParts : []).map(String).filter((x) => earningIds.includes(x));
  const hraPart = b.hraPart && earningIds.includes(String(b.hraPart)) ? String(b.hraPart) : null;
  return {
    fy, newRegime: cleanRegime(b.newRegime, "New regime"), oldRegime: cleanRegime(b.oldRegime, "Old regime"), cessPercent: pct(b.cessPercent, "Cess"),
    caps: { c80C: money(caps.c80C, "80C limit"), c80CCD1B: money(caps.c80CCD1B, "80CCD(1B) limit"), c80D: money(caps.c80D, "80D limit"), c24b: money(caps.c24b, "24(b) limit") },
    basicParts, hraPart,
  };
}

export function emptyTaxProfile(employeeKey: string, fy: string): PayrollTaxProfile {
  return {
    employeeKey, fy, regime: "NEW", declarations: { c80C: 0, c80CCD1B: 0, c80D: 0, c24b: 0, other: 0, rentPaid: 0, metro: false },
    otherIncome: 0, previousEmployer: { salary: 0, tds: 0, pt: 0 }, rev: 0,
  };
}

/** Checks a tax profile; `opening.upToMonth` must sit inside the financial year. */
export function cleanTaxProfile(input: unknown, fy: string): Pick<PayrollTaxProfile, "regime" | "declarations" | "otherIncome" | "previousEmployer" | "opening"> {
  const b = (input ?? {}) as Partial<PayrollTaxProfile>;
  if (b.regime !== "NEW" && b.regime !== "OLD") throw new PayrollRuleError("Pick the tax regime");
  const d = (b.declarations ?? {}) as Partial<PayrollTaxProfile["declarations"]>;
  const p = (b.previousEmployer ?? {}) as Partial<PayrollTaxProfile["previousEmployer"]>;
  const out: ReturnType<typeof cleanTaxProfile> = {
    regime: b.regime,
    declarations: { c80C: money(d.c80C, "80C"), c80CCD1B: money(d.c80CCD1B, "80CCD(1B)"), c80D: money(d.c80D, "80D"), c24b: money(d.c24b, "Housing loan interest"), other: money(d.other, "Other deductions"), rentPaid: money(d.rentPaid, "Rent paid"), metro: !!d.metro },
    otherIncome: money(b.otherIncome, "Other income"),
    previousEmployer: { salary: money(p.salary, "Previous employer salary"), tds: money(p.tds, "Previous employer TDS"), pt: money(p.pt, "Previous employer PT") },
  };
  if (b.opening) {
    const o = b.opening as Partial<NonNullable<PayrollTaxProfile["opening"]>>;
    const start = `${fy.slice(0, 4)}-04`, end = `${Number(fy.slice(0, 4)) + 1}-03`;
    if (typeof o.upToMonth !== "string" || o.upToMonth < start || o.upToMonth > end) throw new PayrollRuleError(`Opening figures: the last month must be between ${start} and ${end}`);
    out.opening = { upToMonth: o.upToMonth, gross: money(o.gross, "Opening gross"), hra: money(o.hra, "Opening HRA"), basic: money(o.basic, "Opening basic"), tds: money(o.tds, "Opening TDS"), pf: money(o.pf, "Opening PF"), pt: money(o.pt, "Opening PT") };
  }
  return out;
}
