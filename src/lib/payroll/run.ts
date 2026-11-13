import type { PayrollLine, PayrollLineMark, PayrollRunStatus, PayrollSettings, PayrollTotals } from "@/types/payroll";
import { computeLine } from "./calc";
import { PayrollRuleError } from "./rules";
import { toHalf } from "./lop";

// The monthly run, pure: a line's pay days and money, run totals, what the College Office / Accounts
// may change on a line, and which status moves are allowed. The server (runServer.ts) only loads
// inputs and writes what these return.

type Settings = Pick<PayrollSettings, "earnings" | "deductions">;

/** Pay days after the Office's adjustments: not credited -> 0; an LOP override replaces the automatic LOP. */
export function effectivePayDays(line: Pick<PayrollLine, "auto" | "lopOverride" | "notCredited">): number {
  if (line.notCredited) return 0;
  const employed = line.auto.monthDays - line.auto.notEmployedDays;
  const lop = line.lopOverride ? Math.min(employed, line.lopOverride.days) : line.auto.lop;
  return Math.max(0, employed - lop);
}

/** Works out pay days, money and issues for a line from its inputs (everything else is kept). */
export function priceLine(line: Omit<PayrollLine, "payDays" | "result" | "issues">, settings: Settings): PayrollLine {
  const payDays = effectivePayDays(line);
  const result = computeLine({
    settings, amounts: line.amounts, exempt: line.exempt, monthDays: line.auto.monthDays, payDays,
    oneOffs: line.oneOffs, tds: line.tds, advance: line.advance, manual: line.manual,
  });
  const issues: string[] = [];
  if (result.shortfall > 0) issues.push(`Deductions are ₹${result.shortfall.toLocaleString("en-IN")} more than the salary - reduce IT or other deductions`);
  if (result.advanceDeferred > 0 && line.advance > 0 && result.gross > 0) issues.push(`Advance cut by ₹${result.advanceDeferred.toLocaleString("en-IN")} so the net stays above 0`);
  if (!line.hold && !line.notCredited && result.net > 0 && (!line.bank.account || !line.bank.ifsc)) issues.push("No bank account / IFSC on the record - they'll be left out of the bank file");
  if (line.auto.attendanceLop > 0 && !line.lopOverride) issues.push(`Absent ${line.auto.absentDates.length} day(s) per attendance with no approved leave`);
  return { ...line, payDays, result, issues };
}

const emptySection = () => ({ count: 0, gross: 0, totalDeductions: 0, net: 0 });

export function runTotals(lines: PayrollLine[]): PayrollTotals {
  const t: PayrollTotals = {
    count: 0, grossActual: 0, earned: {}, oneOffs: 0, gross: 0, deductions: {}, totalDeductions: 0, net: 0,
    held: 0, heldNet: 0, notCredited: 0, shortfalls: 0, sections: { TEACHING: emptySection(), NON_TEACHING: emptySection() },
  };
  for (const l of lines) {
    const r = l.result;
    t.count++; t.grossActual += r.grossActual; t.oneOffs += r.oneOffTotal; t.gross += r.gross; t.totalDeductions += r.totalDeductions; t.net += r.net;
    for (const [k, v] of Object.entries(r.earned)) t.earned[k] = (t.earned[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.deductions)) t.deductions[k] = (t.deductions[k] ?? 0) + v;
    if (l.hold) { t.held++; t.heldNet += r.net; }
    if (l.notCredited) t.notCredited++;
    if (r.shortfall > 0) t.shortfalls++;
    const s = t.sections[l.section];
    s.count++; s.gross += r.gross; s.totalDeductions += r.totalDeductions; s.net += r.net;
  }
  return t;
}

// ─── Line edits ─────────────────────────────────────────────────────────────────

export type PayrollActor = "OFFICE" | "ACCOUNTS";

export interface LineEdit {
  lopOverride?: { days: number; reason: string } | null;
  notCredited?: { reason: string } | null;
  hold?: { reason: string } | null;
  oneOffs?: { label: string; amount: number; componentId?: string }[];
  manual?: Record<string, number>;
  tdsOverride?: { amount: number; reason: string } | null;
  advanceOverride?: { amount: number; reason: string } | null;
}

const reasonOf = (v: unknown, what: string) => {
  const r = typeof (v as { reason?: unknown })?.reason === "string" ? (v as { reason: string }).reason.trim().slice(0, 300) : "";
  if (!r) throw new PayrollRuleError(`Give a reason for ${what}`);
  return r;
};
const wholeRupees = (v: unknown, what: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000 || !Number.isInteger(n)) throw new PayrollRuleError(`${what}: give a whole rupee amount`);
  return n;
};

/**
 * Applies an edit to a line. The Office sets pay days (LOP override), not credited, hold, one-off
 * earnings and the month's manual deductions; Accounts may also override this month's IT and advance
 * recovery (each with a reason; the advance never more than the balance). The caller re-prices the line
 * (with its TDS worked out again - lineTax.ts priceWithTax). Returns the changed line (not yet priced) and a
 * one-line description per change for the line's history.
 */
export function applyLineEdit(line: PayrollLine, input: unknown, settings: Settings, actor: PayrollActor, who: { byName: string; at: string }) {
  const edit = (input ?? {}) as Record<string, unknown>;
  const next: PayrollLine = { ...line };
  const changes: string[] = [];
  const mark = (reason: string): PayrollLineMark => ({ reason, byName: who.byName, at: who.at });

  if ("lopOverride" in edit) {
    if (edit.lopOverride === null) {
      if (next.lopOverride) changes.push(`LOP back to automatic (${line.auto.lop})`);
      delete next.lopOverride;
    } else {
      const days = Number((edit.lopOverride as { days?: unknown })?.days);
      const employed = line.auto.monthDays - line.auto.notEmployedDays;
      if (!Number.isFinite(days) || days < 0 || days > employed || toHalf(days) !== days) throw new PayrollRuleError(`LOP days must be 0-${employed}, in half days`);
      const reason = reasonOf(edit.lopOverride, "changing the LOP days");
      next.lopOverride = { ...mark(reason), days };
      changes.push(`LOP set to ${days} (automatic ${line.auto.lop}): ${reason}`);
    }
  }
  for (const key of ["notCredited", "hold"] as const) {
    if (!(key in edit)) continue;
    const label = key === "hold" ? "Salary on hold" : "Salary not credited";
    if (edit[key] === null) {
      if (next[key]) changes.push(`${label} removed`);
      delete next[key];
    } else {
      const reason = reasonOf(edit[key], key === "hold" ? "holding the salary" : "not crediting the salary");
      next[key] = mark(reason);
      changes.push(`${label}: ${reason}`);
    }
  }
  if ("oneOffs" in edit) {
    if (!Array.isArray(edit.oneOffs) || edit.oneOffs.length > 10) throw new PayrollRuleError("Up to 10 one-off earnings");
    const parts = new Set(settings.earnings.map((e) => e.id));
    next.oneOffs = edit.oneOffs.map((o) => {
      const label = String((o as { label?: unknown })?.label ?? "").trim().slice(0, 60);
      if (!label) throw new PayrollRuleError("Each one-off earning needs a name (e.g. Arrears Oct 2026)");
      const componentId = (o as { componentId?: unknown })?.componentId;
      if (componentId !== undefined && componentId !== "" && !parts.has(String(componentId))) throw new PayrollRuleError(`${label}: unknown pay part`);
      const amount = wholeRupees((o as { amount?: unknown })?.amount, label);
      return { label, amount, ...(componentId ? { componentId: String(componentId) } : {}) };
    }).filter((o) => o.amount > 0);
    changes.push(`One-off earnings: ${next.oneOffs.map((o) => `${o.label} ${o.amount}`).join(", ") || "none"}`);
  }
  if ("manual" in edit) {
    const allowed = new Map(settings.deductions.filter((d) => d.kind === "MANUAL" && d.active).map((d) => [d.id, d.label]));
    const manual: Record<string, number> = {};
    for (const [id, v] of Object.entries((edit.manual ?? {}) as Record<string, unknown>)) {
      if (!allowed.has(id)) throw new PayrollRuleError(`${id} isn't a deduction entered each month`);
      const n = wholeRupees(v, allowed.get(id)!);
      if (n > 0) manual[id] = n;
    }
    next.manual = manual;
    changes.push(`Other deductions: ${Object.entries(manual).map(([id, n]) => `${allowed.get(id)} ${n}`).join(", ") || "none"}`);
  }
  if ("tdsOverride" in edit) {
    if (actor !== "ACCOUNTS") throw new PayrollRuleError("Only Accounts change the income tax");
    if (edit.tdsOverride === null) {
      if (next.tdsOverride) changes.push(`IT back to the worked-out amount (${line.tdsAuto ?? 0})`);
      delete next.tdsOverride;
    } else {
      const amount = wholeRupees((edit.tdsOverride as { amount?: unknown })?.amount, "IT");
      const reason = reasonOf(edit.tdsOverride, "changing the income tax");
      next.tdsOverride = { ...mark(reason), amount };
      changes.push(`IT set to ${amount} (worked out ${line.tdsAuto ?? 0}): ${reason}`);
    }
  }
  if ("advanceOverride" in edit) {
    if (actor !== "ACCOUNTS") throw new PayrollRuleError("Only Accounts change the advance recovery");
    if (edit.advanceOverride === null) {
      if (next.advanceOverride) changes.push(`Advance recovery back to the schedule (${line.advanceAuto ?? 0})`);
      delete next.advanceOverride;
      next.advance = line.advanceAuto ?? 0;
    } else {
      const amount = wholeRupees((edit.advanceOverride as { amount?: unknown })?.amount, "Advance recovery");
      if (amount > (line.advanceBalance ?? 0)) throw new PayrollRuleError(`The advance balance is only ₹${(line.advanceBalance ?? 0).toLocaleString("en-IN")}`);
      const reason = reasonOf(edit.advanceOverride, "changing the advance recovery");
      next.advanceOverride = { ...mark(reason), amount };
      next.advance = amount;
      changes.push(`Advance recovery set to ${amount} (schedule ${line.advanceAuto ?? 0}): ${reason}`);
    }
  }
  if (changes.length === 0) throw new PayrollRuleError("Nothing to change");
  return { line: next, changes };
}

// ─── Status moves ───────────────────────────────────────────────────────────────

export type RunAction = "SUBMIT" | "RETURN" | "APPROVE" | "REOPEN" | "RELEASE";

const MOVES: Record<RunAction, { from: PayrollRunStatus[]; to: PayrollRunStatus; by: PayrollActor }> = {
  SUBMIT: { from: ["DRAFT", "RETURNED"], to: "SUBMITTED", by: "OFFICE" },
  RETURN: { from: ["SUBMITTED", "APPROVED"], to: "RETURNED", by: "ACCOUNTS" },
  APPROVE: { from: ["SUBMITTED"], to: "APPROVED", by: "ACCOUNTS" },
  REOPEN: { from: ["APPROVED"], to: "SUBMITTED", by: "ACCOUNTS" },
  RELEASE: { from: ["APPROVED"], to: "RELEASED", by: "ACCOUNTS" },
};

export const isRunAction = (a: unknown): a is RunAction => typeof a === "string" && a in MOVES;

/** Checks a status move; returns the new status. `superAdmin` may act as either side. */
export function moveRun(status: PayrollRunStatus, action: RunAction, actor: PayrollActor, totals: Pick<PayrollTotals, "shortfalls">, superAdmin = false): PayrollRunStatus {
  const m = MOVES[action];
  if (!superAdmin && m.by !== actor) throw new PayrollRuleError(action === "SUBMIT" ? "Only the College Office submits the month" : "Only Accounts can do that");
  if (!m.from.includes(status)) throw new PayrollRuleError(`Can't ${action.toLowerCase()} a month that is ${status.toLowerCase()}`);
  if ((action === "SUBMIT" || action === "APPROVE" || action === "RELEASE") && totals.shortfalls > 0) {
    throw new PayrollRuleError(`${totals.shortfalls} line(s) have deductions above the salary - fix them first`);
  }
  return m.to;
}

/** Who may edit lines in a status. */
export function canEditLines(status: PayrollRunStatus, actor: PayrollActor): boolean {
  return status === "DRAFT" || status === "RETURNED" || (actor === "ACCOUNTS" && status === "SUBMITTED");
}

/** Financial year of a month: "2026-11" -> "2026-27", "2027-02" -> "2026-27". */
export function financialYear(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
