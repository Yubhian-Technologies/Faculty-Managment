import type { PayDeduction, PayEarning, PayRevision, PayrollSettings, PtSlab } from "@/types/payroll";

// Payroll components and rules: the defaults (matching the VWU October 2026 sheet), the checks run on
// every save, rounding, and which version of a person's pay applies to a month. Pure - no Firestore.

/** Drops floating-point noise (e.g. 0.1 + 0.2) before rounding money. */
const snap = (x: number) => Math.round(x * 1e6) / 1e6;
/** To the rupee, half up (amounts are never negative here). */
export const roundRupee = (x: number) => Math.floor(snap(x) + 0.5);
/** Up to the next rupee (ESI). */
export const ceilRupee = (x: number) => Math.ceil(snap(x));
/** To the nearest `step` rupees, half up (TDS to 100). */
export const roundTo = (x: number, step: number) => (step > 1 ? Math.floor(snap(x / step) + 0.5) * step : roundRupee(x));

export const DEFAULT_EARNINGS: PayEarning[] = [
  { id: "EB", label: "E.B", prorate: true, pfWage: true, esiWage: true, taxable: true, active: true },
  { id: "AGP", label: "AGP", prorate: true, pfWage: true, esiWage: true, taxable: true, active: true },
  { id: "DA", label: "DA", prorate: true, pfWage: true, esiWage: true, taxable: true, active: true },
  { id: "HRA", label: "HRA", prorate: true, pfWage: false, esiWage: false, taxable: true, active: true },
  { id: "OA", label: "OA", prorate: true, pfWage: false, esiWage: false, taxable: true, active: true },
  { id: "SA", label: "SA", prorate: true, pfWage: false, esiWage: false, taxable: true, active: true },
];

export const DEFAULT_DEDUCTIONS: PayDeduction[] = [
  { kind: "PF", id: "PF", label: "PF", active: true, percent: 12, cap: 3000 },
  { kind: "SLAB", id: "PT", label: "PT", active: true, slabs: [{ upTo: 15000, amount: 0 }, { upTo: 20000, amount: 150 }, { upTo: null, amount: 200 }] },
  { kind: "ESI", id: "ESI", label: "ESI", active: true, percent: 0.75, wageLimit: 21000, roundUp: true },
  { kind: "INCOME_TAX", id: "IT", label: "IT", active: true },
  { kind: "FLAT", id: "SWF", label: "SWF", active: true, amount: 30 },
  { kind: "ADVANCE", id: "ADV", label: "Salary Adv.", active: true },
];

export const DEFAULT_SIGNATURES = ["Prepared by", "Office Superintendent", "Registrar"];

export function defaultPayrollSettings(): PayrollSettings {
  return {
    earnings: DEFAULT_EARNINGS.map((e) => ({ ...e })),
    deductions: DEFAULT_DEDUCTIONS.map((d) => ({ ...d, ...(d.kind === "SLAB" ? { slabs: d.slabs.map((s) => ({ ...s })) } : {}) }) as PayDeduction),
    payDayBasis: "CALENDAR",
    tdsRoundTo: 100,
    signatureLabels: [...DEFAULT_SIGNATURES],
    version: 0,
  };
}

/** Calendar days of "YYYY-MM" (or 30 on the fixed basis). */
export function monthDays(month: string, basis: PayrollSettings["payDayBasis"] = "CALENDAR"): number {
  if (basis === "FIXED_30") return 30;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const isMonthKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The revision in force on the 1st of `month` (revisions are kept oldest first), or null before the first. */
export function revisionFor(revisions: PayRevision[], month: string): PayRevision | null {
  let found: PayRevision | null = null;
  for (const r of [...revisions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))) {
    if (r.effectiveFrom <= month) found = r;
  }
  return found;
}

/** Fixed monthly total of a revision (the sheet's Gross_Actual). */
export const grossActual = (amounts: Record<string, number>) => Object.values(amounts).reduce((a, v) => a + (v || 0), 0);

// ─── Checks on save ─────────────────────────────────────────────────────────────

const ID_RE = /^[A-Z][A-Z0-9_]{0,15}$/;
const money = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const text = (v: unknown, max = 40) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export class PayrollRuleError extends Error {}

/**
 * Cleans the settings Accounts sends. `previous` (the saved settings) guards ids already in use:
 * a part or deduction once saved may be retired (active: false) but never removed or re-typed.
 */
export function cleanPayrollSettings(input: unknown, previous: PayrollSettings | null): Omit<PayrollSettings, "version" | "updatedAt" | "updatedByName"> {
  const body = (input ?? {}) as Partial<PayrollSettings>;
  if (!Array.isArray(body.earnings) || !Array.isArray(body.deductions)) throw new PayrollRuleError("Earnings and deductions are required");
  const ids = new Set<string>();
  const claim = (id: unknown, what: string) => {
    if (typeof id !== "string" || !ID_RE.test(id)) throw new PayrollRuleError(`${what}: the code must be capital letters / digits (up to 16), starting with a letter`);
    if (ids.has(id)) throw new PayrollRuleError(`The code ${id} is used twice`);
    ids.add(id);
    return id;
  };

  const earnings: PayEarning[] = body.earnings.map((e, i) => {
    const label = text(e?.label);
    if (!label) throw new PayrollRuleError(`Earning ${i + 1} needs a name`);
    return { id: claim(e?.id, label), label, prorate: e?.prorate !== false, pfWage: !!e?.pfWage, esiWage: !!e?.esiWage, taxable: e?.taxable !== false, active: e?.active !== false };
  });
  if (!earnings.some((e) => e.active)) throw new PayrollRuleError("At least one earning must be in use");

  const deductions: PayDeduction[] = body.deductions.map((d, i) => {
    const label = text(d?.label);
    if (!label) throw new PayrollRuleError(`Deduction ${i + 1} needs a name`);
    const base = { id: claim(d?.id, label), label, active: d?.active !== false };
    switch (d?.kind) {
      case "PF": {
        if (!money(d.percent) || d.percent > 100 || !money(d.cap)) throw new PayrollRuleError(`${label}: give a percent (0-100) and a cap`);
        return { kind: "PF", ...base, percent: d.percent, cap: d.cap };
      }
      case "ESI": {
        if (!money(d.percent) || d.percent > 100 || !money(d.wageLimit)) throw new PayrollRuleError(`${label}: give a percent (0-100) and a wage limit`);
        return { kind: "ESI", ...base, percent: d.percent, wageLimit: d.wageLimit, roundUp: d.roundUp !== false };
      }
      case "SLAB": return { kind: "SLAB", ...base, slabs: cleanSlabs(d.slabs, label) };
      case "FLAT": {
        if (!money(d.amount)) throw new PayrollRuleError(`${label}: give an amount`);
        return { kind: "FLAT", ...base, amount: d.amount };
      }
      case "INCOME_TAX": case "ADVANCE": case "MANUAL": return { kind: d.kind, ...base };
      default: throw new PayrollRuleError(`${label}: unknown deduction type`);
    }
  });
  for (const kind of ["INCOME_TAX", "ADVANCE"] as const) {
    if (deductions.filter((d) => d.kind === kind).length > 1) throw new PayrollRuleError(`Only one ${kind === "INCOME_TAX" ? "income tax" : "salary advance"} deduction is allowed`);
  }

  if (previous) {
    const now = new Map<string, string>([...earnings.map((e) => [e.id, "EARNING"] as const), ...deductions.map((d) => [d.id, d.kind] as const)]);
    for (const e of previous.earnings) {
      if (now.get(e.id) !== "EARNING") throw new PayrollRuleError(`${e.label} was used before - retire it instead of removing it`);
    }
    for (const d of previous.deductions) {
      if (now.get(d.id) !== d.kind) throw new PayrollRuleError(`${d.label} was used before - retire it instead of removing or changing its type`);
    }
  }

  const tdsRoundTo = body.tdsRoundTo === undefined ? 100 : body.tdsRoundTo;
  if (![1, 10, 100].includes(tdsRoundTo)) throw new PayrollRuleError("TDS rounding must be 1, 10 or 100 rupees");
  const signatureLabels = (Array.isArray(body.signatureLabels) ? body.signatureLabels : DEFAULT_SIGNATURES).map((s) => text(s, 40)).filter(Boolean).slice(0, 6);
  return { earnings, deductions, payDayBasis: body.payDayBasis === "FIXED_30" ? "FIXED_30" : "CALENDAR", tdsRoundTo, signatureLabels };
}

function cleanSlabs(input: unknown, label: string): PtSlab[] {
  if (!Array.isArray(input) || input.length === 0) throw new PayrollRuleError(`${label}: add at least one slab`);
  const slabs = input.map((s) => ({ upTo: s?.upTo === null || s?.upTo === undefined || s?.upTo === "" ? null : Number(s.upTo), amount: Number(s?.amount) }));
  slabs.forEach((s, i) => {
    if (!money(s.amount)) throw new PayrollRuleError(`${label}: slab ${i + 1} needs an amount`);
    if (s.upTo !== null && !money(s.upTo)) throw new PayrollRuleError(`${label}: slab ${i + 1} has a wrong upper limit`);
    if (i < slabs.length - 1 && s.upTo === null) throw new PayrollRuleError(`${label}: only the last slab may be open-ended`);
    if (i > 0 && s.upTo !== null && (slabs[i - 1].upTo ?? Infinity) >= s.upTo) throw new PayrollRuleError(`${label}: slab limits must go up`);
  });
  if (slabs[slabs.length - 1].upTo !== null) throw new PayrollRuleError(`${label}: the last slab must be "and above"`);
  return slabs;
}

/** Amount of a slab table for a value (the first slab whose upper limit covers it). */
export function slabAmount(slabs: PtSlab[], value: number): number {
  for (const s of slabs) if (s.upTo === null || value <= s.upTo) return s.amount;
  return 0;
}
