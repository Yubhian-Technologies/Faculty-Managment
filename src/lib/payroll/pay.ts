import type { PayDeduction, PayRevision, PayrollSettings } from "@/types/payroll";
import { PayrollRuleError, grossActual, isMonthKey } from "./rules";

// Employee pay structures: a person's fixed monthly amount per earning, plus the deductions that
// don't apply to them (e.g. no PF), kept as revisions effective from the 1st of a month. Pure.

/** Deductions a person can be excused from (the computed ones; IT / advance / manual follow their own data). */
export const exemptableDeductions = (settings: Pick<PayrollSettings, "deductions">): PayDeduction[] =>
  settings.deductions.filter((d) => d.kind === "PF" || d.kind === "ESI" || d.kind === "SLAB" || d.kind === "FLAT");

const MAX_AMOUNT = 10_000_000;

export interface RevisionInput { effectiveFrom: string; amounts: Record<string, number>; exempt: string[]; note?: string }

/** Checks a revision against the college's parts: known earning ids, whole rupees, known exempt ids. */
export function cleanRevision(input: unknown, settings: Pick<PayrollSettings, "earnings" | "deductions">): RevisionInput {
  const b = (input ?? {}) as Partial<RevisionInput>;
  if (!isMonthKey(b.effectiveFrom)) throw new PayrollRuleError("Pick the month this pay starts from");
  const known = new Map(settings.earnings.map((e) => [e.id, e]));
  const amounts: Record<string, number> = {};
  for (const [id, raw] of Object.entries(b.amounts ?? {})) {
    const e = known.get(id);
    if (!e) throw new PayrollRuleError(`Unknown pay part ${id}`);
    if (raw === null || raw === undefined || (raw as unknown) === "") continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNT || !Number.isInteger(v)) throw new PayrollRuleError(`${e.label}: give a whole rupee amount`);
    if (v > 0) {
      if (!e.active) throw new PayrollRuleError(`${e.label} is retired - it can't be given an amount`);
      amounts[id] = v;
    }
  }
  if (grossActual(amounts) <= 0) throw new PayrollRuleError("Enter at least one pay amount");
  const allowed = new Set(exemptableDeductions(settings).map((d) => d.id));
  const exempt = [...new Set(Array.isArray(b.exempt) ? b.exempt : [])].map(String);
  for (const id of exempt) if (!allowed.has(id)) throw new PayrollRuleError(`${id} can't be switched off per person`);
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
  return { effectiveFrom: b.effectiveFrom, amounts, exempt: exempt.sort(), ...(note ? { note } : {}) };
}

/** Adds the revision; one for the same month replaces the earlier one. Kept oldest first. */
export function withRevision(revisions: PayRevision[], rev: PayRevision): PayRevision[] {
  return [...revisions.filter((r) => r.effectiveFrom !== rev.effectiveFrom), rev].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export const sameRevision = (a: Pick<PayRevision, "amounts" | "exempt">, b: Pick<PayRevision, "amounts" | "exempt">) =>
  JSON.stringify(Object.entries(a.amounts).sort()) === JSON.stringify(Object.entries(b.amounts).sort()) &&
  JSON.stringify([...a.exempt].sort()) === JSON.stringify([...b.exempt].sort());

// ─── Import (Accounts' salary sheet: Emp Code + one column per part + Y/N per deduction) ─────────

export interface ImportRow { row: number; code: string; values: Record<string, string> }  // values keyed by header as typed
export interface ImportEmployee { employeeKey: string; employeeCode: string; name: string }

export interface ImportPlanRow {
  row: number;
  code: string;
  employeeKey?: string;
  name?: string;
  amounts?: Record<string, number>;
  exempt?: string[];
  grossActual?: number;
  status: "NEW" | "CHANGED" | "SAME" | "ERROR";
  error?: string;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Columns of the monthly salary sheet that are worked out each month (or read elsewhere) - skipped when the sheet itself is uploaded.
const SHEET_ONLY = new Set(["PAYDAYS", "GSAL", "GROSSSALARY", "TOTALDED", "TOTALDEDUCTIONS", "NETSALARY", "NETPAY", "NET", "IT", "TDS", "INCOMETAX", "SALARYADV", "SALARYADVANCE", "ADVANCE"]);

/** Maps the file's headers to earning ids and exemptable deduction ids. Unknown headers are refused. */
export function importColumns(headers: string[], settings: Pick<PayrollSettings, "earnings" | "deductions">) {
  const earnings = new Map<string, string>();
  const deductions = new Map<string, string>();
  const ignored = new Set(["EMPCODE", "EMPLOYEECODE", "EMPLOYEEID", "NAME", "EMPNAME", "EMPLOYEENAME", "SNO", "SLNO", "DEPT", "DEPARTMENT", "DESIGNATION", "GROSSACTUAL", "GROSS"]);
  const unknown: string[] = [];
  let payDays: string | null = null;
  let grossActualCol: string | null = null;
  for (const h of headers) {
    const n = norm(h);
    if (n === "PAYDAYS") payDays = h;
    if (n === "GROSSACTUAL") grossActualCol = h;
    if (!n || ignored.has(n)) continue;
    const e = settings.earnings.find((x) => norm(x.label) === n || x.id === n);
    if (e) { earnings.set(h, e.id); continue; }
    const d = exemptableDeductions(settings).find((x) => norm(x.label) === n || x.id === n);
    if (d) { deductions.set(h, d.id); continue; }
    if (SHEET_ONLY.has(n)) continue;
    unknown.push(h);
  }
  // A "Pay Days" column = the monthly salary sheet itself: deduction columns hold amounts, not Y / N.
  return { earnings, deductions, unknown, sheet: payDays ? { payDays, grossActual: grossActualCol } : null };
}

/**
 * Plans an import: each row is matched to a person by Emp Code (case-insensitive, within the college).
 * A blank amount is 0; a deduction column takes Y / N (blank = Y). Any error stops the whole import.
 * The monthly salary sheet itself (a "Pay Days" column) is read too: its worked-out columns are skipped, a
 * deduction amount > 0 = applies (PF / SWF 0 = not for this person), rows without an Emp Code are skipped, and a
 * row paid for part of the month (parts != Gross_Actual) is refused - its fixed pay can't be read from it.
 */
export function planPayImport(
  headers: string[], rows: ImportRow[], employees: ImportEmployee[],
  settings: Pick<PayrollSettings, "earnings" | "deductions">,
  current: Map<string, { amounts: Record<string, number>; exempt: string[] } | null>,
): { rows: ImportPlanRow[]; unknownColumns: string[]; errors: number; skipped: number } {
  const cols = importColumns(headers, settings);
  const byCode = new Map<string, ImportEmployee[]>();
  for (const e of employees) {
    const c = e.employeeCode.trim().toUpperCase();
    if (c) byCode.set(c, [...(byCode.get(c) ?? []), e]);
  }
  const seen = new Map<string, number>();
  const kindOf = new Map(settings.deductions.map((d) => [d.id, d.kind]));
  // The monthly sheet carries totals, section headings and footnotes with no Emp Code - those rows are skipped.
  const used = cols.sheet ? rows.filter((r) => r.code.trim()) : rows;
  const out = used.map((r): ImportPlanRow => {
    const code = r.code.trim().toUpperCase();
    const fail = (error: string): ImportPlanRow => ({ row: r.row, code: r.code, status: "ERROR", error });
    if (!code) return fail("Emp Code is blank");
    if (seen.has(code)) return fail(`Emp Code repeated (row ${seen.get(code)})`);
    seen.set(code, r.row);
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) return fail("No faculty or staff member has this Emp Code");
    if (matches.length > 1) return fail("Two people share this Emp Code - fix their records first");
    const emp = matches[0];
    const amounts: Record<string, number> = {};
    for (const [h, id] of cols.earnings) {
      const raw = String(r.values[h] ?? "").replace(/,/g, "").trim();
      if (!raw) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return fail(`${h}: "${r.values[h]}" isn't a whole rupee amount`);
      if (v > 0 && !settings.earnings.find((e) => e.id === id)?.active) return fail(`${h} is retired - leave it blank`);
      if (v > 0) amounts[id] = v;
    }
    if (cols.sheet) {
      // The sheet's parts are what was EARNED this month; only a full month gives the fixed pay.
      const days = String(r.values[cols.sheet.payDays] ?? "").trim();
      const full = cols.sheet.grossActual ? Number(String(r.values[cols.sheet.grossActual] ?? "").replace(/,/g, "").trim()) : NaN;
      if (Number.isFinite(full) && full > 0 && grossActual(amounts) !== full) {
        return fail(`Paid for part of the month (Pay Days ${days || "?"}): the parts add up to ${grossActual(amounts)}, not the Gross_Actual ${full} - type this person's full-month pay`);
      }
      if (grossActual(amounts) <= 0) return fail(`Not paid this month (Pay Days ${days || "0"}) - type this person's full-month pay`);
    }
    if (grossActual(amounts) <= 0) return fail("No pay amounts");
    const exempt: string[] = [];
    for (const [h, id] of cols.deductions) {
      const raw = String(r.values[h] ?? "").replace(/,/g, "").trim().toUpperCase();
      if (!raw || raw === "Y" || raw === "YES") continue;
      if (raw === "N" || raw === "NO") { exempt.push(id); continue; }
      const amt = Number(raw);
      if (cols.sheet && Number.isFinite(amt) && amt >= 0) {
        // An amount: PF / flat ones (SWF) apply when charged, 0 = not for this person. ESI and the PT slab are
        // decided by their own rules each month (wage limit, slab), so a 0 there never turns them off.
        const kind = kindOf.get(id);
        if (amt === 0 && (kind === "PF" || kind === "FLAT")) exempt.push(id);
        continue;
      }
      return fail(`${h}: write Y or N`);
    }
    exempt.sort();
    const cur = current.get(emp.employeeKey);
    const status = !cur ? "NEW" : sameRevision(cur, { amounts, exempt }) ? "SAME" : "CHANGED";
    return { row: r.row, code: r.code, employeeKey: emp.employeeKey, name: emp.name, amounts, exempt, grossActual: grossActual(amounts), status };
  });
  return { rows: out, unknownColumns: cols.unknown, errors: out.filter((r) => r.status === "ERROR").length + (cols.unknown.length ? 1 : 0), skipped: rows.length - used.length };
}
