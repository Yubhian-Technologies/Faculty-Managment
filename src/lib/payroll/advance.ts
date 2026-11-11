import type { SalaryAdvance } from "@/types/payroll";
import { PayrollRuleError, isMonthKey, roundRupee } from "./rules";

// Salary advances - pure. Balance = amount - recovered before the app - recoveries of released months.
// Each month an ACTIVE advance (started, with a balance) is due min(instalment, balance); a person's
// several advances are recovered oldest first. What was actually deducted (it can be less: no pay,
// net kept above 0, an Accounts override) is split back over the advances when the month is released.

type Adv = Pick<SalaryAdvance, "amount" | "recoveredBefore" | "recoveries">;

export const advanceRecovered = (a: Adv) => a.recoveredBefore + Object.values(a.recoveries ?? {}).reduce((s, v) => s + v, 0);
export const advanceBalance = (a: Adv) => Math.max(0, a.amount - advanceRecovered(a));

/** Balance before `month` - a recovery already recorded for that month itself (a re-release) is not counted. */
export const balanceBefore = (a: Adv, month: string) => {
  const own = a.recoveries?.[month] ?? 0;
  return Math.max(0, a.amount - advanceRecovered(a) + own);
};

export const percentOf = (instalment: number, amount: number) => (amount > 0 ? Math.round((instalment / amount) * 100 * 1000) / 1000 : 0);

/** This month's dues of a person's advances, oldest first. */
export function advanceDues(advances: SalaryAdvance[], month: string): { parts: { advanceId: string; amount: number }[]; total: number; balance: number } {
  const open = advances
    .filter((a) => a.status !== "CLOSED" && a.startMonth <= month)
    .sort((a, b) => a.startMonth.localeCompare(b.startMonth) || a.createdAt.localeCompare(b.createdAt));
  const parts: { advanceId: string; amount: number }[] = [];
  let balance = 0;
  for (const a of open) {
    const bal = balanceBefore(a, month);
    balance += bal;
    if (a.status !== "ACTIVE" || bal <= 0) continue;
    parts.push({ advanceId: a.id, amount: Math.min(a.instalment, bal) });
  }
  return { parts, total: parts.reduce((s, p) => s + p.amount, 0), balance };
}

/**
 * Splits what was actually deducted over the person's advances, oldest first, never more than each
 * one's balance. `order` = the advances (oldest first) with their balance before the month.
 */
export function allocateRecovery(actual: number, order: { advanceId: string; balance: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let left = actual;
  for (const o of order) {
    if (left <= 0) break;
    const take = Math.min(left, o.balance);
    if (take > 0) { out[o.advanceId] = take; left -= take; }
  }
  return out;
}

// ─── Saving an advance ──────────────────────────────────────────────────────────

export interface AdvanceInput {
  amount: number;
  recoveredBefore: number;
  instalment: number;
  recoveryPercent: number;
  startMonth: string;
  givenOn?: string;
  note?: string;
}

const whole = (v: unknown, what: string, max = 10_000_000) => {
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  if (!Number.isFinite(n) || n < 0 || n > max || !Number.isInteger(n)) throw new PayrollRuleError(`${what}: give a whole rupee amount`);
  return n;
};

/**
 * Checks an advance. The monthly recovery is given either as `instalment` (rupees) or `recoveryPercent`
 * (of the amount, decimals allowed - rounded to the rupee); the other is worked out.
 */
export function cleanAdvance(input: unknown): AdvanceInput {
  const b = (input ?? {}) as Record<string, unknown>;
  const amount = whole(b.amount, "Advance amount");
  if (amount <= 0) throw new PayrollRuleError("Advance amount must be more than 0");
  const recoveredBefore = b.recoveredBefore === undefined || b.recoveredBefore === "" ? 0 : whole(b.recoveredBefore, "Already recovered");
  if (recoveredBefore >= amount) throw new PayrollRuleError("Already recovered must be less than the advance");
  let instalment: number;
  let recoveryPercent: number;
  if (b.instalment !== undefined && b.instalment !== "" && b.instalment !== null) {
    instalment = whole(b.instalment, "Monthly recovery");
    recoveryPercent = percentOf(instalment, amount);
  } else {
    recoveryPercent = Number(b.recoveryPercent);
    if (!Number.isFinite(recoveryPercent) || recoveryPercent <= 0 || recoveryPercent > 100) throw new PayrollRuleError("Give the monthly recovery as an amount or a % (more than 0, up to 100)");
    instalment = roundRupee((amount * recoveryPercent) / 100);
  }
  if (instalment <= 0) throw new PayrollRuleError("The monthly recovery must be at least Rs. 1");
  if (instalment > amount) throw new PayrollRuleError("The monthly recovery can't be more than the advance");
  if (!isMonthKey(b.startMonth)) throw new PayrollRuleError("Pick the first month to recover");
  const givenOn = typeof b.givenOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.givenOn) ? b.givenOn : undefined;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
  return { amount, recoveredBefore, instalment, recoveryPercent, startMonth: b.startMonth, ...(givenOn ? { givenOn } : {}), ...(note ? { note } : {}) };
}

/** An advance as the screens see it: with what's recovered, the balance and months left. */
export const advanceView = (a: SalaryAdvance) => ({ ...a, recovered: advanceRecovered(a), balance: advanceBalance(a), monthsLeft: a.status === "CLOSED" ? 0 : monthsLeft(a) });

/** Months still needed at the current instalment (for display). */
export const monthsLeft = (a: Adv & Pick<SalaryAdvance, "instalment">) => (a.instalment > 0 ? Math.ceil(advanceBalance(a) / a.instalment) : 0);

// ─── Import of advances already running at go-live ──────────────────────────────

export interface AdvanceImportRow { row: number; code: string; values: Record<string, string> }
export interface AdvanceImportPlanRow { row: number; code: string; employeeKey?: string; name?: string; advance?: AdvanceInput; status: "OK" | "ERROR"; error?: string }

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9%]/g, "");
const COLS: Record<string, keyof AdvanceInput | "code" | "ignore"> = {
  EMPCODE: "code", EMPLOYEECODE: "code", EMPLOYEEID: "code", NAME: "ignore", EMPNAME: "ignore",
  ADVANCEAMOUNT: "amount", AMOUNT: "amount", ADVANCE: "amount",
  RECOVEREDSOFAR: "recoveredBefore", ALREADYRECOVERED: "recoveredBefore", RECOVERED: "recoveredBefore",
  MONTHLYRECOVERY: "instalment", INSTALMENT: "instalment", MONTHLYAMOUNT: "instalment",
  "MONTHLY%": "recoveryPercent", "RECOVERY%": "recoveryPercent", PERCENT: "recoveryPercent",
  FIRSTMONTH: "startMonth", STARTMONTH: "startMonth", FROMMONTH: "startMonth", NOTE: "note", REMARKS: "note",
};

/** "Nov 2026", "11/2026", "2026-11", an Excel date "2026-11-01" -> "2026-11". */
export function monthFromCell(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^([A-Za-z]{3})[A-Za-z]*[\s-]+(\d{4})$/.exec(s);
  if (m) {
    const i = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[1].toUpperCase());
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  return null;
}

export function planAdvanceImport(headers: string[], rows: AdvanceImportRow[], employees: { employeeKey: string; employeeCode: string; name: string }[]) {
  const map = new Map<string, keyof AdvanceInput | "code" | "ignore">();
  const unknownColumns: string[] = [];
  for (const h of headers) {
    if (!h.trim()) continue;
    const k = COLS[norm(h)];
    if (k) map.set(h, k); else unknownColumns.push(h);
  }
  const byCode = new Map<string, typeof employees>();
  for (const e of employees) {
    const c = e.employeeCode.trim().toUpperCase();
    if (c) byCode.set(c, [...(byCode.get(c) ?? []), e]);
  }
  const out = rows.map((r): AdvanceImportPlanRow => {
    const fail = (error: string): AdvanceImportPlanRow => ({ row: r.row, code: r.code, status: "ERROR", error });
    const code = r.code.trim().toUpperCase();
    if (!code) return fail("Emp Code is blank");
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) return fail("No faculty or staff member has this Emp Code");
    if (matches.length > 1) return fail("Two people share this Emp Code - fix their records first");
    const raw: Record<string, string> = {};
    for (const [h, k] of map) if (k !== "code" && k !== "ignore") raw[k] = String(r.values[h] ?? "").trim().replace(/%$/, "");
    if (raw.startMonth) {
      const m = monthFromCell(raw.startMonth);
      if (!m) return fail(`First month "${raw.startMonth}" - write it like Nov 2026`);
      raw.startMonth = m;
    }
    try {
      return { row: r.row, code: r.code, employeeKey: matches[0].employeeKey, name: matches[0].name, advance: cleanAdvance(raw), status: "OK" };
    } catch (e) {
      return fail(e instanceof Error ? e.message : "Invalid row");
    }
  });
  return { rows: out, unknownColumns, errors: out.filter((r) => r.status === "ERROR").length + (unknownColumns.length ? 1 : 0) };
}
