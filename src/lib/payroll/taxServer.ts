import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";
import type { EmployeePay, PayrollSettings, PayrollTaxProfile, PayrollTaxRules } from "@/types/payroll";
import { computeLine } from "./calc";
import { lineTax, monthFigures, priorFigures, type PersonTaxContext, type TaxFigures } from "./lineTax";
import { revisionFor } from "./rules";
import { financialYear } from "./run";
import { annualTax, emptyTaxProfile } from "./tax";
import { payrollRefs, type PayEmployee } from "./server";
import { monthsAfter } from "./tax";

// Loads what TDS needs: the financial year's confirmed tax rules, each person's tax profile, and the
// released months of the year (payrollLedger).

export const taxRefs = (db: Firestore, collegeId: string) => {
  const { college } = payrollRefs(db, collegeId);
  return { rules: college.collection("payrollTaxRules"), profiles: college.collection("payrollTaxProfiles"), ledger: college.collection("payrollLedger") };
};
export const profileId = (fy: string, employeeKey: string) => `${fy}__${employeeKey}`;

export async function loadTaxRules(db: Firestore, collegeId: string, fy: string): Promise<PayrollTaxRules | null> {
  const snap = await taxRefs(db, collegeId).rules.doc(fy).get();
  return snap.exists ? (snap.data() as PayrollTaxRules) : null;
}

type LedgerDoc = { employeeKey: string; month: string; earned?: Record<string, number>; oneOffs?: number; deductions?: Record<string, number> };

function ledgerFigures(docs: LedgerDoc[], settings: Pick<PayrollSettings, "earnings" | "deductions">, rules: PayrollTaxRules | null) {
  const out = new Map<string, { month: string; figures: TaxFigures }[]>();
  for (const l of docs) {
    const figures = monthFigures({ earned: l.earned ?? {}, oneOffTotal: l.oneOffs ?? 0, deductions: l.deductions ?? {} }, settings, rules ?? { basicParts: [], hraPart: null });
    out.set(l.employeeKey, [...(out.get(l.employeeKey) ?? []), { month: l.month, figures }]);
  }
  return out;
}

/** Every person's tax context for a month (one read of rules, profiles and the year's ledger). */
export async function loadTaxContexts(db: Firestore, collegeId: string, month: string, settings: Pick<PayrollSettings, "earnings" | "deductions">) {
  const fy = financialYear(month);
  const refs = taxRefs(db, collegeId);
  const [rules, profSnap, ledSnap] = await Promise.all([loadTaxRules(db, collegeId, fy), refs.profiles.where("fy", "==", fy).get(), refs.ledger.where("fy", "==", fy).get()]);
  const profiles = new Map(profSnap.docs.map((d) => [(d.data() as PayrollTaxProfile).employeeKey, d.data() as PayrollTaxProfile]));
  const ledger = ledgerFigures(ledSnap.docs.map((d) => d.data() as LedgerDoc), settings, rules);
  const contextFor = (employeeKey: string): PersonTaxContext => {
    const profile = profiles.get(employeeKey) ?? emptyTaxProfile(employeeKey, fy);
    return { rules, profile, prior: priorFigures(profile, ledger.get(employeeKey) ?? [], month) };
  };
  return { fy, rules, contextFor };
}

/** One person's tax context (for re-pricing a single line). */
export async function loadPersonTaxContext(db: Firestore, collegeId: string, month: string, employeeKey: string, settings: Pick<PayrollSettings, "earnings" | "deductions">): Promise<PersonTaxContext> {
  const fy = financialYear(month);
  const refs = taxRefs(db, collegeId);
  const [rules, prof, led] = await Promise.all([
    loadTaxRules(db, collegeId, fy), refs.profiles.doc(profileId(fy, employeeKey)).get(),
    refs.ledger.where("employeeKey", "==", employeeKey).get(),
  ]);
  const profile = prof.exists ? (prof.data() as PayrollTaxProfile) : emptyTaxProfile(employeeKey, fy);
  const docs = led.docs.map((d) => d.data() as LedgerDoc & { fy?: string }).filter((d) => d.fy === fy);
  return { rules, profile, prior: priorFigures(profile, ledgerFigures(docs, settings, rules).get(employeeKey) ?? [], month) };
}

// ─── Estimates (the Income tax tab and the tax statement) ───────────────────────


/** ?fy=2026-27 (default: the financial year of the current month). */
export function fyFrom(request: Request): string {
  const asked = new URL(request.url).searchParams.get("fy");
  if (asked) {
    if (!/^\d{4}-\d{2}$/.test(asked) || (Number(asked.slice(0, 4)) + 1) % 100 !== Number(asked.slice(5))) throw new Error("BAD_FY");
    return asked;
  }
  return financialYear(istDateKey().slice(0, 7));
}

/** The month an estimate is made for: this month if it is in the FY, else its first / last month. */
export function estimateMonth(fy: string): string {
  const start = `${fy.slice(0, 4)}-04`, end = `${Number(fy.slice(0, 4)) + 1}-03`;
  const now = istDateKey().slice(0, 7);
  return now < start ? start : now > end ? end : now;
}

/**
 * A person's year as of `month`, treating that month as a full month at their current pay: annual tax,
 * TDS deducted so far and this month's TDS. null when they have no pay for the month.
 */
export function estimatePerson(pay: EmployeePay | undefined, month: string, settings: PayrollSettings, ctx: PersonTaxContext, lastWorkingDate?: string) {
  const rev = pay ? revisionFor(pay.revisions, month) : null;
  if (!rev) return null;
  const result = computeLine({ settings, amounts: rev.amounts, exempt: rev.exempt, monthDays: 30, payDays: 30 });
  const t = lineTax({ amounts: rev.amounts, exempt: rev.exempt, result, lastWorkingDate }, month, settings, ctx);
  const breakdown = ctx.rules ? annualTax(ctx.profile.regime, t.year, ctx.profile, ctx.rules) : null;
  const other = ctx.rules ? annualTax(ctx.profile.regime === "NEW" ? "OLD" : "NEW", t.year, ctx.profile, ctx.rules) : null;
  return { month, tdsNow: t.tdsAuto, calc: t.taxCalc, year: t.year, breakdown, otherRegimeTax: other?.tax.total ?? null };
}

/** A person's tax statement for a financial year: the computation as of this month, released months, projected months. */
export async function buildTaxStatement(db: Firestore, collegeId: string, employee: PayEmployee, fy: string, settings: PayrollSettings) {
  const month = estimateMonth(fy);
  const [paySnap, ledSnap] = await Promise.all([
    payrollRefs(db, collegeId).pay.doc(employee.employeeKey).get(),
    taxRefs(db, collegeId).ledger.where("employeeKey", "==", employee.employeeKey).get(),
  ]);
  const ctx = await loadPersonTaxContext(db, collegeId, month, employee.employeeKey, settings);
  const est = estimatePerson(paySnap.exists ? (paySnap.data() as EmployeePay) : undefined, month, settings, ctx, employee.extra.lastWorkingDate);
  const released = ledSnap.docs.map((d) => d.data() as { month: string; fy?: string; gross: number; tds: number; net: number })
    .filter((l) => l.fy === fy).sort((a, b) => a.month.localeCompare(b.month))
    .map((l) => ({ month: l.month, gross: l.gross, tds: l.tds, net: l.net, beforeOpening: !!ctx.profile.opening && l.month <= ctx.profile.opening.upToMonth }));
  const { extra: _x, ...person } = employee;
  void _x;
  return {
    fy, month, person, profile: ctx.profile, rulesConfirmed: !!ctx.rules, estimate: est, released,
    projectedMonths: est ? monthsAfter(month, employee.extra.lastWorkingDate?.slice(0, 7)) : [],
  };
}
