import type { PayrollLine, PayrollSettings } from "@/types/payroll";
import { importColumns, type ImportRow } from "./pay";

// A month's "entered each month" deductions (MediClaim ...) from an Excel / CSV: Emp Code + one column per such
// deduction. Pure - the route loads the month's lines and writes what this plans.
//   blank cell = that deduction is left as it is on the line; a number (0 too) replaces it (0 = none this month)
//   rows without an Emp Code are skipped (totals, headings); an Emp Code not in the month, repeated, or a bad
//   amount = an error, and any error = nothing saved. Other columns of the salary sheet (E.B, PF, Net ...) are ignored.

export interface DeductionPlanRow {
  row: number;
  code: string;
  employeeKey?: string;
  name?: string;
  before?: Record<string, number>;
  after?: Record<string, number>;
  status: "CHANGED" | "SAME" | "ERROR";
  error?: string;
}

export interface DeductionPlan {
  columns: { header: string; id: string; label: string }[];
  unknownColumns: string[];
  rows: DeductionPlanRow[];
  errors: number;
  skipped: number;
  problem: string | null;   // a whole-file problem (no deduction column, a retired one)
}

const sameManual = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
};

export function planMonthlyDeductions(
  headers: string[], rows: ImportRow[],
  lines: Pick<PayrollLine, "employeeKey" | "employeeCode" | "name" | "manual">[],
  settings: Pick<PayrollSettings, "earnings" | "deductions">,
): DeductionPlan {
  const cols = importColumns(headers, settings);
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const columns = cols.monthly.map((header) => {
    const d = settings.deductions.find((x) => x.kind === "MANUAL" && (norm(x.label) === norm(header) || x.id === norm(header)))!;
    return { header, id: d.id, label: d.label, active: d.active };
  });
  const retired = columns.filter((c) => !c.active).map((c) => c.header);
  const problem = columns.length === 0
    ? "The file has no column for a deduction entered each month. Add it in Pay parts & rules (e.g. MediClaim, entered each month); if you added it after this month was prepared, Recalculate the month first"
    : retired.length ? `${retired.join(", ")} is no longer in use - remove the column` : null;

  const byCode = new Map<string, typeof lines>();
  for (const l of lines) {
    const c = l.employeeCode.trim().toUpperCase();
    if (c) byCode.set(c, [...(byCode.get(c) ?? []), l]);
  }
  const seen = new Map<string, number>();
  const used = rows.filter((r) => r.code.trim());
  const out = used.map((r): DeductionPlanRow => {
    const code = r.code.trim().toUpperCase();
    const fail = (error: string): DeductionPlanRow => ({ row: r.row, code: r.code, status: "ERROR", error });
    if (seen.has(code)) return fail(`Emp Code repeated (row ${seen.get(code)})`);
    seen.set(code, r.row);
    const matches = byCode.get(code) ?? [];
    if (matches.length === 0) return fail("Not in this month's salaries");
    if (matches.length > 1) return fail("Two people in the month share this Emp Code");
    const line = matches[0];
    const before = { ...(line.manual ?? {}) };
    const after = { ...before };
    for (const c of columns) {
      const raw = String(r.values[c.header] ?? "").replace(/,/g, "").trim();
      if (!raw) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) return fail(`${c.header}: "${r.values[c.header]}" isn't a whole rupee amount`);
      if (v > 0) after[c.id] = v; else delete after[c.id];
    }
    return { row: r.row, code: r.code, employeeKey: line.employeeKey, name: line.name, before, after, status: sameManual(before, after) ? "SAME" : "CHANGED" };
  });
  const errors = out.filter((r) => r.status === "ERROR").length + (cols.unknown.length ? 1 : 0) + (problem ? 1 : 0);
  return { columns: columns.map(({ header, id, label }) => ({ header, id, label })), unknownColumns: cols.unknown, rows: out, errors, skipped: rows.length - used.length, problem };
}
