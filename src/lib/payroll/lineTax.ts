import type { LineTaxCalc, PayrollLine, PayrollSettings, PayrollTaxProfile, PayrollTaxRules } from "@/types/payroll";
import { computeLine, type LineResult } from "./calc";
import { annualTax, monthlyTds, monthsAfter, monthsLeftInFy, type SalaryYear } from "./tax";
import { financialYear, priceLine } from "./run";

// A line's TDS - pure. The year's salary = what was paid before (opening figures from before the app +
// released months, both from the ledger) + this month's line + the rest of the year projected at the
// person's current full-month pay (stopping at their last working month) + a previous employer's salary.

type Settings = Pick<PayrollSettings, "earnings" | "deductions" | "tdsRoundTo">;
export type TaxFigures = Omit<SalaryYear, never> & { tds: number };

export const ZERO_FIGURES: TaxFigures = { gross: 0, hra: 0, basic: 0, pf: 0, pt: 0, tds: 0 };
export const addFigures = (a: TaxFigures, b: Partial<TaxFigures>): TaxFigures => ({
  gross: a.gross + (b.gross ?? 0), hra: a.hra + (b.hra ?? 0), basic: a.basic + (b.basic ?? 0), pf: a.pf + (b.pf ?? 0), pt: a.pt + (b.pt ?? 0), tds: a.tds + (b.tds ?? 0),
});

/** Tax figures of one month from its result (or a ledger entry: same shape of earned / deductions). */
export function monthFigures(r: Pick<LineResult, "earned" | "oneOffTotal" | "deductions">, settings: Pick<PayrollSettings, "earnings" | "deductions">, rules: Pick<PayrollTaxRules, "basicParts" | "hraPart">): TaxFigures {
  const ofKind = (kind: string) => settings.deductions.filter((d) => d.kind === kind).reduce((s, d) => s + (r.deductions[d.id] ?? 0), 0);
  return {
    gross: settings.earnings.filter((e) => e.taxable).reduce((s, e) => s + (r.earned[e.id] ?? 0), 0) + r.oneOffTotal,
    hra: rules.hraPart ? r.earned[rules.hraPart] ?? 0 : 0,
    basic: rules.basicParts.reduce((s, id) => s + (r.earned[id] ?? 0), 0),
    pf: ofKind("PF"), pt: ofKind("SLAB"), tds: ofKind("INCOME_TAX"),
  };
}

export interface PersonTaxContext {
  rules: PayrollTaxRules | null;        // null = Accounts haven't confirmed this FY's rules
  profile: PayrollTaxProfile;
  prior: TaxFigures;                    // paid this FY before the month (opening + released months)
}

export function lineTax(
  line: Pick<PayrollLine, "amounts" | "exempt" | "result" | "lastWorkingDate">,
  month: string, settings: Settings, ctx: PersonTaxContext,
): { tdsAuto: number; taxCalc: LineTaxCalc; year: SalaryYear } {
  const fy = financialYear(month);
  const { profile, rules } = ctx;
  const monthsLeft = monthsLeftInFy(month);
  const deductedBefore = ctx.prior.tds + profile.previousEmployer.tds;
  if (!rules) {
    return { tdsAuto: 0, taxCalc: { fy, regime: profile.regime, rulesConfirmed: false, annualSalary: 0, taxableIncome: 0, annualTax: 0, deductedBefore, monthsLeft }, year: { gross: 0, hra: 0, basic: 0, pf: 0, pt: 0 } };
  }
  const now = monthFigures(line.result, settings, rules);
  const future = monthsAfter(month, line.lastWorkingDate?.slice(0, 7));
  const full = computeLine({ settings, amounts: line.amounts, exempt: line.exempt, monthDays: 30, payDays: 30 });
  const each = monthFigures(full, settings, rules);
  const n = future.length;
  const year: SalaryYear = {
    gross: ctx.prior.gross + now.gross + each.gross * n + profile.previousEmployer.salary,
    hra: ctx.prior.hra + now.hra + each.hra * n,
    basic: ctx.prior.basic + now.basic + each.basic * n,
    pf: ctx.prior.pf + now.pf + each.pf * n,
    pt: ctx.prior.pt + now.pt + each.pt * n + profile.previousEmployer.pt,
  };
  const a = annualTax(profile.regime, year, profile, rules);
  return {
    tdsAuto: monthlyTds(a.tax.total, deductedBefore, month, settings.tdsRoundTo),
    taxCalc: { fy, regime: profile.regime, rulesConfirmed: true, annualSalary: year.gross, taxableIncome: a.taxableIncome, annualTax: a.tax.total, deductedBefore, monthsLeft },
    year,
  };
}

/** What counts as "paid before" a month: the opening figures (if they end before it) + released ledger months after them. */
export function priorFigures(profile: PayrollTaxProfile, ledger: { month: string; figures: TaxFigures }[], month: string): TaxFigures {
  const open = profile.opening && profile.opening.upToMonth < month ? profile.opening : undefined;
  let out = open ? { gross: open.gross, hra: open.hra, basic: open.basic, pf: open.pf, pt: open.pt, tds: open.tds } : { ...ZERO_FIGURES };
  for (const l of ledger) {
    if (l.month >= month) continue;
    if (open && l.month <= open.upToMonth) continue;
    out = addFigures(out, l.figures);
  }
  return out;
}

/**
 * Prices a line with its TDS: first without tax (to know this month's salary), then works out the TDS
 * and prices again. An Accounts override wins over the worked-out amount. No context (the college has
 * no income-tax deduction in use) = no TDS.
 */
export function priceWithTax(base: Omit<PayrollLine, "payDays" | "result" | "issues">, settings: Settings, month: string, ctx: PersonTaxContext | null): PayrollLine {
  const usesTax = settings.deductions.some((d) => d.kind === "INCOME_TAX" && d.active);
  if (!ctx || !usesTax) return priceLine({ ...base, tds: base.tdsOverride?.amount ?? 0 }, settings);
  const first = priceLine({ ...base, tds: 0 }, settings);
  const t = lineTax(first, month, settings, ctx);
  return priceLine({ ...base, tdsAuto: t.tdsAuto, taxCalc: t.taxCalc, tds: base.tdsOverride ? base.tdsOverride.amount : t.tdsAuto }, settings);
}
