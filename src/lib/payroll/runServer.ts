import type { Firestore } from "firebase-admin/firestore";
import { istDateKey } from "@/lib/attendance/istTime";
import { getHolidayDateKeys } from "@/lib/leave/holidaysCount";
import { leaveLopDaysInMonth } from "@/lib/leave/monthlySummary";
import type { LeaveRequest } from "@/types/leave";
import type { EmployeePay, PayrollLine, PayrollRun, PayrollSettings, PayrollTotals, SalaryAdvance } from "@/types/payroll";
import { advanceDues, allocateRecovery, balanceBefore } from "./advance";
import { employedInMonth, monthBounds, payDaysFor } from "./lop";
import { revisionFor, settingsForMonth } from "./rules";
import { financialYear, runTotals } from "./run";
import { priceWithTax } from "./lineTax";
import { loadTaxContexts } from "./taxServer";
import { listPayEmployees, loadPayrollSettings, payrollRefs, type PayEmployee } from "./server";

// Loads what a month's run needs and builds its lines. Inputs per person: the pay revision in force on
// the 1st, joining / last working day, the leave register's LOP for the month, and attendance marked
// ABSENT / HALF_DAY with no approved leave. What the Office / Accounts set on a line (LOP override,
// not credited, hold, one-offs, manual deductions, IT, advance) is kept across a recalculation.

export const runRefs = (db: Firestore, collegeId: string, month: string) => {
  const { college, runs } = payrollRefs(db, collegeId);
  const run = runs.doc(month);
  return { run, lines: run.collection("lines"), ledger: college.collection("payrollLedger") };
};

const toDate = (v: unknown): Date | null => {
  const t = v as { toDate?: () => Date } | undefined;
  const d = typeof t?.toDate === "function" ? t.toDate() : typeof v === "string" || v instanceof Date ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/** "Y-M-D" (0-based month, leave register's key) -> "YYYY-MM-DD". */
const isoFromLeaveKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

interface MonthInputs {
  settings: PayrollSettings;
  employees: PayEmployee[];
  pays: Map<string, EmployeePay>;
  leaveByUid: Map<string, LeaveRequest[]>;
  holidayLeaveKeys: Set<string>;
  holidayIso: Set<string>;
  absencesByUid: Map<string, { date: string; half: boolean }[]>;
  advancesByKey: Map<string, SalaryAdvance[]>;
}

async function loadMonthInputs(db: Firestore, collegeId: string, month: string): Promise<MonthInputs> {
  const { first, last } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const college = payrollRefs(db, collegeId).college;
  const monthStart = new Date(y, m - 1, 1);
  const [{ settings }, employees, paySnap, leaveSnap, attSnap, holidayLeaveKeys, advSnap] = await Promise.all([
    loadPayrollSettings(db, collegeId),
    listPayEmployees(db, collegeId),
    payrollRefs(db, collegeId).pay.get(),
    // Range on one field only (no composite index): leave that ends on / after the 1st, approved ones kept below.
    college.collection("leaveRequests").where("toDate", ">=", new Date(monthStart.getTime() - 86400000)).get(),
    college.collection("attendanceRecords").where("dateKey", ">=", first).where("dateKey", "<=", last).get(),
    getHolidayDateKeys(db, collegeId, monthStart, new Date(y, m, 0)),
    college.collection("salaryAdvances").where("status", "in", ["ACTIVE", "PAUSED"]).get(),
  ]);
  const advancesByKey = new Map<string, SalaryAdvance[]>();
  for (const d of advSnap.docs) {
    const a = { ...(d.data() as SalaryAdvance), id: d.id };
    advancesByKey.set(a.employeeKey, [...(advancesByKey.get(a.employeeKey) ?? []), a]);
  }
  const leaveByUid = new Map<string, LeaveRequest[]>();
  for (const d of leaveSnap.docs) {
    const r = { id: d.id, ...d.data() } as LeaveRequest;
    if (r.status !== "APPROVED" || !r.uid) continue;
    leaveByUid.set(r.uid, [...(leaveByUid.get(r.uid) ?? []), r]);
  }
  const absencesByUid = new Map<string, { date: string; half: boolean }[]>();
  for (const d of attSnap.docs) {
    const a = d.data() as { facultyId?: string; status?: string; dateKey?: string };
    if (!a.facultyId || !a.dateKey || (a.status !== "ABSENT" && a.status !== "HALF_DAY")) continue;
    absencesByUid.set(a.facultyId, [...(absencesByUid.get(a.facultyId) ?? []), { date: a.dateKey, half: a.status === "HALF_DAY" }]);
  }
  return {
    // The month's own PF rule (a change from a month on applies to that month and later).
    settings: settingsForMonth(settings, month), employees,
    pays: new Map(paySnap.docs.map((d) => [d.id, d.data() as EmployeePay])),
    leaveByUid, holidayLeaveKeys, holidayIso: new Set([...holidayLeaveKeys].map(isoFromLeaveKey)), absencesByUid, advancesByKey,
  };
}

/** Every calendar date an approved leave / On Duty covers inside the month (IST dates). */
function coveredDates(requests: LeaveRequest[], first: string, last: string): Set<string> {
  const out = new Set<string>();
  for (const r of requests) {
    const from = toDate(r.fromDate), to = toDate(r.toDate ?? r.fromDate);
    if (!from || !to) continue;
    for (let t = from.getTime(); t <= to.getTime() + 1000; t += 86400000) {
      const k = istDateKey(new Date(t));
      if (k >= first && k <= last) out.add(k);
    }
  }
  return out;
}

export interface BuiltRun {
  settings: PayrollSettings;
  lines: PayrollLine[];
  excluded: PayrollRun["excluded"];
  taxRulesConfirmed: boolean;
}

/** Builds every line of a month. `previous` lines keep what people set on them. */
export async function buildRun(db: Firestore, collegeId: string, month: string, previous = new Map<string, PayrollLine>(), asOf = new Date()): Promise<BuiltRun> {
  const inp = await loadMonthInputs(db, collegeId, month);
  const tax = await loadTaxContexts(db, collegeId, month, inp.settings);
  const { first, last } = monthBounds(month);
  const [y, m] = month.split("-").map(Number);
  const lines: PayrollLine[] = [];
  const excluded: PayrollRun["excluded"] = [];
  for (const e of inp.employees) {
    const exited = e.status === "RESIGNED" || e.status === "RETIRED";
    if (exited && !e.extra.lastWorkingDate) {
      if (inp.pays.has(e.employeeKey)) excluded.push({ employeeKey: e.employeeKey, employeeCode: e.employeeCode, name: e.name, reason: `${e.status === "RESIGNED" ? "Resigned" : "Retired"} with no last working date on the record` });
      continue;
    }
    if (!employedInMonth(month, e.joiningDate, e.extra.lastWorkingDate)) continue;
    const rev = revisionFor(inp.pays.get(e.employeeKey)?.revisions ?? [], month);
    if (!rev) {
      if (!exited) excluded.push({ employeeKey: e.employeeKey, employeeCode: e.employeeCode, name: e.name, reason: "No pay set for this month" });
      continue;
    }
    const uid = e.extra.userUid;
    const leave = uid ? inp.leaveByUid.get(uid) ?? [] : [];
    const auto = payDaysFor({
      month, basis: inp.settings.payDayBasis, joiningDate: e.joiningDate, lastWorkingDate: e.extra.lastWorkingDate,
      leaveLop: uid ? leaveLopDaysInMonth(leave, inp.holidayLeaveKeys, y, m, asOf).total : 0,
      absences: uid ? inp.absencesByUid.get(uid) ?? [] : [],
      coveredDates: coveredDates(leave, first, last), holidayDates: inp.holidayIso,
    });
    const prev = previous.get(e.employeeKey);
    const dues = advanceDues(inp.advancesByKey.get(e.employeeKey) ?? [], month);
    const override = prev?.advanceOverride && prev.advanceOverride.amount <= dues.balance ? prev.advanceOverride : undefined;
    lines.push(priceWithTax({
      employeeKey: e.employeeKey, kind: e.kind, recordId: e.recordId, employeeCode: e.employeeCode, name: e.name,
      department: e.department, designation: e.designation, section: e.section,
      ...(uid ? { userUid: uid } : {}), ...(e.joiningDate ? { joiningDate: e.joiningDate } : {}),
      ...(e.extra.lastWorkingDate ? { lastWorkingDate: e.extra.lastWorkingDate } : {}),
      bank: e.extra.bank, ...(e.extra.pan ? { pan: e.extra.pan } : {}), ...(e.extra.uan ? { uan: e.extra.uan } : {}),
      revisionFrom: rev.effectiveFrom, amounts: rev.amounts, exempt: rev.exempt, auto,
      ...(prev?.lopOverride ? { lopOverride: prev.lopOverride } : {}),
      ...(prev?.notCredited ? { notCredited: prev.notCredited } : {}),
      ...(prev?.hold ? { hold: prev.hold } : {}),
      oneOffs: prev?.oneOffs ?? [], manual: prev?.manual ?? {}, tds: 0,
      ...(prev?.tdsOverride ? { tdsOverride: prev.tdsOverride } : {}),
      advance: override ? override.amount : dues.total, advanceAuto: dues.total, advanceParts: dues.parts, advanceBalance: dues.balance,
      ...(override ? { advanceOverride: override } : {}),
      history: prev?.history ?? [],
    }, inp.settings, month, tax.contextFor(e.employeeKey)));
  }
  lines.sort((a, b) => a.section.localeCompare(b.section) || a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }));
  return { settings: inp.settings, lines, excluded, taxRulesConfirmed: !!tax.rules };
}

export const runSettingsSnapshot = (s: PayrollSettings): PayrollRun["settings"] =>
  ({ earnings: s.earnings, deductions: s.deductions, payDayBasis: s.payDayBasis, signatureLabels: s.signatureLabels, version: s.version, tdsRoundTo: s.tdsRoundTo });

/** Totals after one line changed (old -> new) without re-reading every line. */
export function swapLineInTotals(t: PayrollTotals, oldLine: PayrollLine, newLine: PayrollLine): PayrollTotals {
  const a = runTotals([newLine]), b = runTotals([oldLine]);
  const num = (x: number, p: number, q: number) => x + p - q;
  const map = (x: Record<string, number>, p: Record<string, number>, q: Record<string, number>) => {
    const out = { ...x };
    for (const k of new Set([...Object.keys(p), ...Object.keys(q)])) out[k] = (out[k] ?? 0) + (p[k] ?? 0) - (q[k] ?? 0);
    return out;
  };
  const sec = (k: "TEACHING" | "NON_TEACHING") => ({
    count: num(t.sections[k].count, a.sections[k].count, b.sections[k].count),
    gross: num(t.sections[k].gross, a.sections[k].gross, b.sections[k].gross),
    totalDeductions: num(t.sections[k].totalDeductions, a.sections[k].totalDeductions, b.sections[k].totalDeductions),
    net: num(t.sections[k].net, a.sections[k].net, b.sections[k].net),
  });
  return {
    count: t.count, grossActual: num(t.grossActual, a.grossActual, b.grossActual), earned: map(t.earned, a.earned, b.earned),
    oneOffs: num(t.oneOffs, a.oneOffs, b.oneOffs), gross: num(t.gross, a.gross, b.gross), deductions: map(t.deductions, a.deductions, b.deductions),
    totalDeductions: num(t.totalDeductions, a.totalDeductions, b.totalDeductions), net: num(t.net, a.net, b.net),
    held: num(t.held, a.held, b.held), heldNet: num(t.heldNet, a.heldNet, b.heldNet), notCredited: num(t.notCredited, a.notCredited, b.notCredited),
    shortfalls: num(t.shortfalls, a.shortfalls, b.shortfalls), sections: { TEACHING: sec("TEACHING"), NON_TEACHING: sec("NON_TEACHING") },
  };
}

/** One month's entry in a person's yearly ledger - written only when the month is released. */
export function ledgerEntry(l: PayrollLine, settings: Pick<PayrollSettings, "deductions">) {
  const ofKind = (kind: string) => settings.deductions.filter((d) => d.kind === kind).reduce((a, d) => a + (l.result.deductions[d.id] ?? 0), 0);
  return {
    payDays: l.payDays, grossActual: l.result.grossActual, gross: l.result.gross, earned: l.result.earned, oneOffs: l.result.oneOffTotal,
    pfWage: l.result.pfWage, deductions: l.result.deductions, tds: ofKind("INCOME_TAX"), advance: ofKind("ADVANCE"),
    pf: ofKind("PF"), pt: ofKind("SLAB"), net: l.result.net,
  };
}

/** payrollLedger/{employeeKey}__{YYYY-MM}: one doc per person per RELEASED month (with `fy` for the year's tax). */
export const ledgerDocId = (employeeKey: string, month: string) => `${employeeKey}__${month}`;
export const ledgerDoc = (l: PayrollLine, month: string, settings: Pick<PayrollSettings, "deductions">) =>
  ({ employeeKey: l.employeeKey, month, fy: financialYear(month), ...ledgerEntry(l, settings) });

/** Best-effort notifications for a run's moves (never fails the action). */
export async function notifyPayroll(db: Firestore, collegeId: string, month: string, event: "SUBMITTED" | "RETURNED" | "APPROVED" | "RELEASED", lines: PayrollLine[] = []) {
  const { notify, notifyRole, batchNotify } = await import("@/lib/notify");
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  try {
    if (event === "SUBMITTED") {
      const college = (await db.collection("colleges").doc(collegeId).get()).data() as { locationId?: string; name?: string } | undefined;
      if (!college?.locationId) return;
      const accounts = await db.collection("locations").doc(college.locationId).collection("locationUsers").where("role", "==", "ACCOUNTS").get();
      await Promise.all(accounts.docs.map((d) => notify(db, collegeId, d.id, "PAYROLL_SUBMITTED", `${label} salaries submitted`, `${college.name ?? "A college"} sent ${label} salaries for approval.`, "/accounts/payroll")));
    } else if (event === "RELEASED") {
      await notifyRole(db, collegeId, "COLLEGE_OFFICE", "PAYROLL_RELEASED", `${label} salaries released`, `Accounts released ${label} salaries.`, "/college-office/payroll");
      const paid = lines.filter((l) => l.userUid && !l.hold && l.result.net > 0).map((l) => l.userUid!);
      await batchNotify(db, collegeId, paid, "PAYROLL_RELEASED", `${label} salary released`, `Your ${label} salary has been released.`);
    } else {
      await notifyRole(db, collegeId, "COLLEGE_OFFICE", `PAYROLL_${event}`, `${label} salaries ${event.toLowerCase()}`, event === "RETURNED" ? `Accounts returned ${label} salaries - see their remarks.` : `Accounts approved ${label} salaries.`, "/college-office/payroll");
    }
  } catch (err) {
    console.error("[payroll notify]", err);
  }
}

/**
 * On release: records what each person's advances actually recovered this month (the advance column,
 * split oldest first; held / not credited lines recover nothing). One transaction per advance,
 * idempotent per month (a re-release writes the same figures); an advance recovered in full is closed.
 */
export async function recordAdvanceRecoveries(db: Firestore, collegeId: string, month: string, lines: PayrollLine[], settings: Pick<PayrollSettings, "deductions">, at: string, byName: string) {
  const advIds = settings.deductions.filter((d) => d.kind === "ADVANCE").map((d) => d.id);
  const col = payrollRefs(db, collegeId).college.collection("salaryAdvances");
  const keys = new Set(lines.map((l) => l.employeeKey));
  const all = (await col.get()).docs.map((d) => ({ ...(d.data() as SalaryAdvance), id: d.id }))
    .filter((a) => keys.has(a.employeeKey) && (a.status !== "CLOSED" || a.recoveries?.[month] !== undefined));
  const plan = new Map<string, number>();
  for (const l of lines) {
    const actual = l.hold || l.notCredited ? 0 : advIds.reduce((s, id) => s + (l.result.deductions[id] ?? 0), 0);
    const order = all.filter((a) => a.employeeKey === l.employeeKey && a.startMonth <= month)
      .sort((a, b) => a.startMonth.localeCompare(b.startMonth) || a.createdAt.localeCompare(b.createdAt))
      .map((a) => ({ advanceId: a.id, balance: balanceBefore(a, month) }));
    const split = allocateRecovery(actual, order);
    for (const o of order) plan.set(o.advanceId, split[o.advanceId] ?? 0);
  }
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  await Promise.all([...plan].map(([id, amount]) => db.runTransaction(async (tx) => {
    const ref = col.doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const a = snap.data() as SalaryAdvance;
    const recoveries = { ...(a.recoveries ?? {}) };
    if (amount > 0) recoveries[month] = amount; else delete recoveries[month];
    if ((a.recoveries?.[month] ?? 0) === amount) return;
    const left = a.amount - a.recoveredBefore - Object.values(recoveries).reduce((s, v) => s + v, 0);
    const done = left <= 0;
    tx.update(ref, {
      recoveries, rev: a.rev + 1,
      ...(done ? { status: "CLOSED", closedNote: `Recovered in full (${label})` } : {}),
      history: [...(a.history ?? []), { at, byName, change: `${label} salary recovered Rs. ${amount}${done ? " - recovered in full" : ""}` }].slice(-100),
    });
  })));
}
