import type { PayrollTaxProfile } from "@/types/payroll";
import { monthFromCell } from "./advance";

// Go-live import (Accounts): for each person, the regime and what was already paid / deducted this
// financial year before payroll moved into the app - read in the browser, matched by Employee ID. Pure.

export interface TaxImportRow { row: number; code: string; values: Record<string, string> }
export interface TaxImportPlanRow {
  row: number; code: string; employeeKey?: string; name?: string; status: "OK" | "ERROR"; error?: string;
  regime?: "NEW" | "OLD"; opening?: NonNullable<PayrollTaxProfile["opening"]>;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
type Key = "code" | "ignore" | "regime" | "upToMonth" | "gross" | "basic" | "hra" | "tds" | "pf" | "pt";
const COLS: Record<string, Key> = {
  EMPCODE: "code", EMPLOYEECODE: "code", EMPLOYEEID: "code", NAME: "ignore", EMPNAME: "ignore", DEPT: "ignore", DEPARTMENT: "ignore",
  REGIME: "regime", TAXREGIME: "regime",
  PAIDUPTO: "upToMonth", UPTOMONTH: "upToMonth", LASTMONTHPAID: "upToMonth",
  GROSSPAID: "gross", GROSS: "gross", GROSSSALARY: "gross", BASICPAID: "basic", BASIC: "basic", HRAPAID: "hra", HRA: "hra",
  TDSDEDUCTED: "tds", TDS: "tds", IT: "tds", PFDEDUCTED: "pf", PF: "pf", PTDEDUCTED: "pt", PT: "pt",
};

export const TAX_IMPORT_HEADERS = ["Employee ID", "Name", "Regime", "Paid up to", "Gross paid", "Basic paid", "HRA paid", "TDS deducted", "PF deducted", "PT deducted"];

export function planTaxImport(headers: string[], rows: TaxImportRow[], employees: { employeeKey: string; employeeCode: string; name: string }[], fy: string) {
  const map = new Map<string, Key>();
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
  const start = `${fy.slice(0, 4)}-04`, end = `${Number(fy.slice(0, 4)) + 1}-03`;
  const seen = new Map<string, number>();
  const out = rows.map((r): TaxImportPlanRow => {
    const fail = (error: string): TaxImportPlanRow => ({ row: r.row, code: r.code, status: "ERROR", error });
    const code = r.code.trim().toUpperCase();
    if (!code) return fail("Employee ID is required.");
    if (seen.has(code)) return fail(`Employee ID repeated (also in row ${seen.get(code)}).`);
    seen.set(code, r.row);
    const m = byCode.get(code) ?? [];
    if (m.length !== 1) return fail(m.length ? "Two people share this Employee ID" : "No faculty or staff member has this Employee ID");
    const v: Partial<Record<Key, string>> = {};
    for (const [h, k] of map) v[k] = String(r.values[h] ?? "").trim();
    const regimeRaw = (v.regime ?? "").toUpperCase();
    const regime = !regimeRaw ? "NEW" : regimeRaw.startsWith("N") ? "NEW" : regimeRaw.startsWith("O") ? "OLD" : null;
    if (!regime) return fail('Regime: write New or Old');
    const upTo = v.upToMonth ? monthFromCell(v.upToMonth) : null;
    if (!upTo || upTo < start || upTo > end) return fail(`Paid up to: a month from Apr ${fy.slice(0, 4)} to Mar ${Number(fy.slice(0, 4)) + 1}, like Oct 2026`);
    const nums: Partial<Record<"gross" | "basic" | "hra" | "tds" | "pf" | "pt", number>> = {};
    for (const k of ["gross", "basic", "hra", "tds", "pf", "pt"] as const) {
      const raw = (v[k] ?? "").replace(/,/g, "");
      const n = raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) return fail(`${k.toUpperCase()}: "${v[k]}" isn't an amount`);
      nums[k] = Math.round(n);
    }
    return { row: r.row, code: r.code, employeeKey: m[0].employeeKey, name: m[0].name, status: "OK", regime, opening: { upToMonth: upTo, gross: nums.gross!, basic: nums.basic!, hra: nums.hra!, tds: nums.tds!, pf: nums.pf!, pt: nums.pt! } };
  });
  return { rows: out, unknownColumns, errors: out.filter((r) => r.status === "ERROR").length + (unknownColumns.length ? 1 : 0) };
}
