import type { PayrollSettings } from "@/types/payroll";
import { ceilRupee, roundRupee, slabAmount } from "./rules";

// One employee's salary for one month - pure. Reproduces the College Office sheet exactly:
//  - each part is prorated and rounded on its own; G.SAL is the sum of the rounded parts
//    (never round(gross x days / month days) - they differ by a rupee on part months);
//  - PF = 12% of the earned PF wage (E.B + AGP + DA), half up, capped;
//  - ESI = 0.75% of the earned ESI wage (the same parts, NOT gross), rounded up. Whether ESI applies
//    is judged on the FULL monthly ESI wage (the sheet's 12-day row: earned 13,094 but full 33,826 ->
//    no ESI), so a short month never brings someone into ESI;
//  - PT from the slab on earned G.SAL; SWF flat;
//  - no pay this month (G.SAL 0) -> every deduction 0, the advance waits for next month.

export interface OneOffEarning {
  label: string;
  amount: number;
  /** When it is arrears of a pay part, that part's id - it then counts for PF / ESI like the part. */
  componentId?: string;
}

export interface LineInput {
  settings: Pick<PayrollSettings, "earnings" | "deductions">;
  amounts: Record<string, number>;      // fixed monthly amount per earning id
  exempt?: string[];                    // deduction ids that don't apply to this person
  monthDays: number;
  payDays: number;                      // may be a half (20.5)
  oneOffs?: OneOffEarning[];
  tds?: number;                         // this month's income tax (worked out elsewhere)
  advance?: number;                     // this month's advance instalment due
  manual?: Record<string, number>;      // MANUAL deduction id -> amount this month
}

export interface LineResult {
  earned: Record<string, number>;       // per earning id
  oneOffTotal: number;
  gross: number;                        // G.SAL
  grossActual: number;                  // fixed monthly total
  pfWage: number;
  esiWage: number;
  deductions: Record<string, number>;   // per deduction id
  totalDeductions: number;
  net: number;
  /** Advance not recovered this month (no pay, or cut so the net stays >= 0). */
  advanceDeferred: number;
  /** Deductions still above G.SAL after the advance and manual items were cut - Accounts must resolve. */
  shortfall: number;
}

const amt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

export function computeLine(input: LineInput): LineResult {
  const { settings, amounts, monthDays } = input;
  if (!(monthDays > 0)) throw new Error("monthDays must be positive");
  const payDays = Math.min(Math.max(input.payDays, 0), monthDays);
  const exempt = new Set(input.exempt ?? []);

  const earned: Record<string, number> = {};
  let pfWage = 0, esiWage = 0, esiWageFixed = 0, grossActual = 0;
  const byId = new Map(settings.earnings.map((e) => [e.id, e]));
  for (const e of settings.earnings) {
    const fixed = amt(amounts[e.id]);
    grossActual += fixed;
    const value = e.prorate ? (payDays === monthDays ? fixed : roundRupee((fixed * payDays) / monthDays)) : payDays > 0 ? fixed : 0;
    earned[e.id] = value;
    if (e.pfWage) pfWage += value;
    if (e.esiWage) { esiWage += value; esiWageFixed += fixed; }
  }
  let oneOffTotal = 0;
  for (const o of input.oneOffs ?? []) {
    const v = roundRupee(amt(o.amount));
    oneOffTotal += v;
    const part = o.componentId ? byId.get(o.componentId) : undefined;
    if (part?.pfWage) pfWage += v;
    if (part?.esiWage) esiWage += v;
  }
  const gross = Object.values(earned).reduce((a, v) => a + v, 0) + oneOffTotal;

  const deductions: Record<string, number> = {};
  const advanceDue = roundRupee(amt(input.advance));
  if (gross <= 0) {
    for (const d of settings.deductions) deductions[d.id] = 0;
    return { earned, oneOffTotal, gross: 0, grossActual, pfWage: 0, esiWage: 0, deductions, totalDeductions: 0, net: 0, advanceDeferred: advanceDue, shortfall: 0 };
  }

  let advanceId: string | null = null;
  const manualIds: string[] = [];
  for (const d of settings.deductions) {
    if (!d.active || exempt.has(d.id)) { deductions[d.id] = 0; continue; }
    switch (d.kind) {
      case "PF": deductions[d.id] = Math.min(roundRupee((pfWage * d.percent) / 100), d.cap); break;
      case "ESI": {
        const v = (esiWage * d.percent) / 100;
        deductions[d.id] = esiWage > 0 && esiWageFixed <= d.wageLimit ? (d.roundUp ? ceilRupee(v) : roundRupee(v)) : 0;
        break;
      }
      case "SLAB": deductions[d.id] = slabAmount(d.slabs, gross); break;
      case "FLAT": deductions[d.id] = d.amount; break;
      case "INCOME_TAX": deductions[d.id] = roundRupee(amt(input.tds)); break;
      case "ADVANCE": advanceId = d.id; deductions[d.id] = advanceDue; break;
      case "MANUAL": manualIds.push(d.id); deductions[d.id] = roundRupee(amt(input.manual?.[d.id])); break;
    }
  }

  // Net never silently below 0: cut the advance first, then manual items; anything left is a shortfall.
  let total = Object.values(deductions).reduce((a, v) => a + v, 0);
  let advanceDeferred = advanceId ? 0 : advanceDue;
  for (const id of [advanceId, ...manualIds]) {
    if (!id || total <= gross) continue;
    const cut = Math.min(deductions[id], total - gross);
    deductions[id] -= cut;
    total -= cut;
    if (id === advanceId) advanceDeferred += cut;
  }
  const shortfall = Math.max(0, total - gross);
  return { earned, oneOffTotal, gross, grossActual, pfWage, esiWage, deductions, totalDeductions: total, net: gross - total, advanceDeferred, shortfall };
}
