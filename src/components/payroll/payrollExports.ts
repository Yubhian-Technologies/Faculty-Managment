import type { PayrollLine, PayrollRun } from "@/types/payroll";
import { downloadCSV, toCSV } from "@/lib/utils/csv";
import { monthLabel } from "./payrollClient";

// Exports of a month, built in the browser from the run + lines:
//  - the salary register in the College Office sheet's layout (Teaching, then Non-Teaching, each with a
//    subtotal, then the Report Total; footnotes: joiners, relieved, not credited, held, advance
//    recoveries; signature line);
//  - the bank transfer file (held, not credited and zero-net lines left out).

const SECTIONS = [["TEACHING", "Teaching Staff"], ["NON_TEACHING", "Non Teaching Staff"]] as const;

export async function downloadRegister(run: PayrollRun, lines: PayrollLine[], collegeName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(run.month);
  const earnings = run.settings.earnings.filter((e) => e.active || lines.some((l) => l.result.earned[e.id]));
  const deductions = run.settings.deductions.filter((d) => d.active || lines.some((l) => l.result.deductions[d.id]));
  const hasOneOffs = lines.some((l) => l.result.oneOffTotal > 0);
  const headers = ["S.No", "Emp Code", "EmpName", "Pay Days", "DEPT", "Gross_Actual", ...earnings.map((e) => e.label), ...(hasOneOffs ? ["Arrears / Other"] : []),
    "G. SAL", ...deductions.map((d) => d.label), "Total Ded", "Net Salary"];
  const [y, m] = run.month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const title = ws.addRow([`${collegeName.toUpperCase()} PAY SHEET`]); title.font = { bold: true, size: 13 };
  ws.addRow([`From : 01/${String(m).padStart(2, "0")}/${y} To : ${lastDay}/${String(m).padStart(2, "0")}/${y}`]);
  const money = (l: PayrollLine) => [l.result.grossActual, ...earnings.map((e) => l.result.earned[e.id] ?? 0), ...(hasOneOffs ? [l.result.oneOffTotal] : []),
    l.result.gross, ...deductions.map((d) => l.result.deductions[d.id] ?? 0), l.result.totalDeductions, l.result.net];
  const sum = (rows: PayrollLine[]) => rows.reduce<number[]>((acc, l) => money(l).map((v, i) => (acc[i] ?? 0) + v), []);

  for (const [key, label] of SECTIONS) {
    const rows = lines.filter((l) => l.section === key);
    if (rows.length === 0) continue;
    ws.addRow([]);
    ws.addRow([label]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    rows.forEach((l, i) => ws.addRow([i + 1, l.employeeCode, l.name, l.payDays, l.department, ...money(l)]));
    const sub = ws.addRow(["", "", `Sub Total :: ${label}`, "", "", ...sum(rows)]); sub.font = { bold: true };
  }
  ws.addRow([]);
  const total = ws.addRow(["", "", "REPORT TOTAL", "", "", ...sum(lines)]); total.font = { bold: true };

  const note = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    ws.addRow([]);
    ws.addRow([heading]).font = { bold: true };
    items.forEach((t, i) => ws.addRow([i + 1, t]));
  };
  note("Joined this month (DOJ)", lines.filter((l) => l.joiningDate?.startsWith(run.month)).map((l) => `${l.name} (${l.department}) - ${l.joiningDate}`));
  note("Relieved / retired this month (DOR)", lines.filter((l) => l.lastWorkingDate?.startsWith(run.month)).map((l) => `${l.name} (${l.department}) - ${l.lastWorkingDate}`));
  note("Salary is not credited", lines.filter((l) => l.notCredited).map((l) => `${l.name} (${l.department}) - ${l.notCredited!.reason}`));
  note("Salary on hold (not in the bank file)", lines.filter((l) => l.hold).map((l) => `${l.name} (${l.department}) - ${l.hold!.reason}`));
  const adv = run.settings.deductions.find((d) => d.kind === "ADVANCE");
  if (adv) {
    const list = lines.filter((l) => (l.result.deductions[adv.id] ?? 0) > 0);
    if (list.length) {
      ws.addRow([]);
      ws.addRow(["Salary advance recovered"]).font = { bold: true };
      ws.addRow(["S.No", "Name", "Amount"]).font = { bold: true };
      list.forEach((l, i) => ws.addRow([i + 1, l.name, l.result.deductions[adv.id]]));
      ws.addRow(["", "TOTAL", list.reduce((a, l) => a + l.result.deductions[adv.id], 0)]).font = { bold: true };
    }
  }
  ws.addRow([]); ws.addRow([]);
  ws.addRow(run.settings.signatureLabels.flatMap((s) => [s, "", "", ""])).font = { bold: true };

  ws.columns = headers.map((h, i) => ({ width: i === 2 ? 30 : Math.max(String(h).length + 2, 9) }));
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Salaries_${monthLabel(run.month).replace(" ", "_")}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
}

/** Bank transfer file. Returns the people left out because their bank details are missing. */
export function downloadBankFile(run: PayrollRun, lines: PayrollLine[]): string[] {
  const payable = lines.filter((l) => !l.hold && !l.notCredited && l.result.net > 0);
  const missing = payable.filter((l) => !l.bank.account || !l.bank.ifsc);
  const rows = payable.filter((l) => l.bank.account && l.bank.ifsc)
    .map((l, i) => [String(i + 1), l.employeeCode, l.name, l.bank.account, l.bank.ifsc, l.bank.bankName, String(l.result.net)]);
  const total = rows.reduce((a, r) => a + Number(r[6]), 0);
  downloadCSV(toCSV([["S.No", "Emp Code", "Name", "Account No", "IFSC", "Bank", "Amount"], ...rows, ["", "", "TOTAL", "", "", "", String(total)]]), `Bank_${run.month}.csv`);
  return missing.map((l) => `${l.employeeCode} ${l.name}`);
}

// ─── Statutory (PF / ESI / PT / TDS) ────────────────────────────────────────────

const ofKind = (run: PayrollRun, l: PayrollLine, kind: string) =>
  run.settings.deductions.filter((d) => d.kind === kind).reduce((s, d) => s + (l.result.deductions[d.id] ?? 0), 0);

/** EPF figures of a line for the ECR: wages capped as the deduction was (a capped 3,000 = 25,000 wages). */
export function epfRow(run: PayrollRun, l: PayrollLine) {
  const pf = ofKind(run, l, "PF");
  const rule = run.settings.deductions.find((d) => d.kind === "PF");
  const pct = rule && rule.kind === "PF" ? rule.percent : 12;
  const capped = rule && rule.kind === "PF" && pf === rule.cap && Math.round((l.result.pfWage * pct) / 100) > rule.cap;
  const epfWages = capped ? Math.round((pf * 100) / pct) : l.result.pfWage;
  const epsWages = Math.min(epfWages, 15000);
  const eps = Math.round(epsWages * 0.0833);
  return { pf, epfWages, epsWages, edliWages: epsWages, eps, diff: Math.max(0, pf - eps), ncp: Math.ceil(Math.max(0, l.auto.monthDays - l.payDays)) };
}

/** One workbook: PF, ESI, PT and TDS sheets; plus the EPFO ECR text file. Returns problems to show (e.g. no UAN). */
export async function downloadStatutory(run: PayrollRun, lines: PayrollLine[], collegeName: string): Promise<string[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const paid = lines.filter((l) => !l.hold && !l.notCredited && l.result.gross > 0);
  const problems: string[] = [];
  const sheet = (name: string, title: string, headers: string[], rows: (string | number)[][], totals?: (string | number)[]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow([`${collegeName} - ${title} - ${monthLabel(run.month)}`]).font = { bold: true };
    ws.addRow(headers).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    if (totals) ws.addRow(totals).font = { bold: true };
    ws.columns = headers.map((h, i) => ({ width: i === 2 ? 30 : Math.max(h.length + 2, 12) }));
  };
  const sum = (rows: (string | number)[][], i: number) => rows.reduce((s, r) => s + (Number(r[i]) || 0), 0);

  // PF
  const pfLines = paid.filter((l) => ofKind(run, l, "PF") > 0);
  const pfRows = pfLines.map((l, i) => { const e = epfRow(run, l); return [i + 1, l.employeeCode, l.name, l.uan ?? "", l.result.gross, e.epfWages, e.epsWages, e.edliWages, e.pf, e.eps, e.diff, e.ncp]; });
  sheet("PF", "Provident Fund", ["S.No", "Emp Code", "Name", "UAN", "Gross", "EPF wages", "EPS wages", "EDLI wages", "EE share (12%)", "ER EPS (8.33%)", "ER EPF (diff)", "NCP days"], pfRows,
    ["", "", "TOTAL", "", sum(pfRows, 4), sum(pfRows, 5), sum(pfRows, 6), sum(pfRows, 7), sum(pfRows, 8), sum(pfRows, 9), sum(pfRows, 10), ""]);
  const noUan = pfLines.filter((l) => !l.uan);
  if (noUan.length) problems.push(`${noUan.length} with PF but no UAN (left out of the ECR): ${noUan.slice(0, 5).map((l) => l.name).join(", ")}`);

  // ESI
  const esiLines = paid.filter((l) => ofKind(run, l, "ESI") > 0);
  const esiRows = esiLines.map((l, i) => [i + 1, l.employeeCode, l.name, "", l.payDays, l.result.esiWage, ofKind(run, l, "ESI"), Math.ceil(l.result.esiWage * 0.0325)]);
  sheet("ESI", "ESI", ["S.No", "Emp Code", "Name", "IP number", "Days paid", "ESI wages", "Employee (0.75%)", "Employer (3.25%)"], esiRows,
    ["", "", "TOTAL", "", "", sum(esiRows, 5), sum(esiRows, 6), sum(esiRows, 7)]);

  // PT - by slab amount
  const pt = new Map<number, number>();
  for (const l of paid) { const v = ofKind(run, l, "SLAB"); pt.set(v, (pt.get(v) ?? 0) + 1); }
  const ptRows = [...pt].sort((a, b) => a[0] - b[0]).map(([amt, n]) => [amt, n, amt * n]);
  sheet("PT", "Professional Tax", ["PT per person", "People", "Amount"], ptRows, ["TOTAL", sum(ptRows, 1), sum(ptRows, 2)]);

  // TDS
  const tdsLines = paid.filter((l) => ofKind(run, l, "INCOME_TAX") > 0);
  const tdsRows = tdsLines.map((l, i) => [i + 1, l.employeeCode, l.name, l.pan ?? "", l.taxCalc?.regime ?? "", l.result.gross, ofKind(run, l, "INCOME_TAX")]);
  sheet("TDS", "TDS on salary (24Q)", ["S.No", "Emp Code", "Name", "PAN", "Regime", "Gross", "TDS"], tdsRows, ["", "", "TOTAL", "", "", sum(tdsRows, 5), sum(tdsRows, 6)]);
  const noPan = tdsLines.filter((l) => !l.pan);
  if (noPan.length) problems.push(`${noPan.length} with TDS but no PAN: ${noPan.slice(0, 5).map((l) => l.name).join(", ")}`);

  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Statutory_${run.month}.xlsx`; a.click(); URL.revokeObjectURL(a.href);

  // EPFO ECR 2.0 text: UAN#~#Name#~#Gross#~#EPF#~#EPS#~#EDLI#~#EE#~#EPS contr#~#ER diff#~#NCP#~#Refund
  const ecr = pfLines.filter((l) => l.uan).map((l) => {
    const e = epfRow(run, l);
    return [l.uan, l.name.toUpperCase(), l.result.gross, e.epfWages, e.epsWages, e.edliWages, e.pf, e.eps, e.diff, e.ncp, 0].join("#~#");
  }).join("\n");
  if (ecr) {
    const b = new Blob([ecr + "\n"], { type: "text/plain" });
    const x = document.createElement("a");
    x.href = URL.createObjectURL(b); x.download = `ECR_${run.month}.txt`; x.click(); URL.revokeObjectURL(x.href);
  }
  return problems;
}

/** Annual salary register of a financial year from the ledger rows (released months). */
export async function downloadAnnualRegister(fy: string, rows: { employeeCode: string; name: string; department: string; pan: string; month: string; gross: number; pf: number; pt: number; tds: number; advance: number; net: number; deductions: Record<string, number> }[], collegeName: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`FY ${fy}`);
  const months = [...new Set(rows.map((r) => r.month))].sort();
  ws.addRow([`${collegeName} - salaries paid in FY ${fy} (released months)`]).font = { bold: true };
  const headers = ["Emp Code", "Name", "Dept", "PAN", ...months.map((m) => `Net ${monthLabel(m)}`), "Gross", "PF", "PT", "TDS", "Advance", "Other ded.", "Net"];
  ws.addRow(headers).font = { bold: true };
  const byPerson = new Map<string, typeof rows>();
  for (const r of rows) byPerson.set(r.employeeCode + "|" + r.name, [...(byPerson.get(r.employeeCode + "|" + r.name) ?? []), r]);
  const all: number[][] = [];
  for (const list of [...byPerson.values()].sort((a, b) => a[0].employeeCode.localeCompare(b[0].employeeCode, undefined, { numeric: true }))) {
    const p = list[0];
    const t = (k: "gross" | "pf" | "pt" | "tds" | "advance" | "net") => list.reduce((s, r) => s + (r[k] ?? 0), 0);
    const ded = list.reduce((s, r) => s + Object.values(r.deductions ?? {}).reduce((a, v) => a + v, 0), 0);
    const nums = [...months.map((m) => list.find((r) => r.month === m)?.net ?? 0), t("gross"), t("pf"), t("pt"), t("tds"), t("advance"), ded - t("pf") - t("pt") - t("tds") - t("advance"), t("net")];
    all.push(nums);
    ws.addRow([p.employeeCode, p.name, p.department, p.pan, ...nums]);
  }
  ws.addRow(["", "TOTAL", "", "", ...headers.slice(4).map((_, i) => all.reduce((s, r) => s + r[i], 0))]).font = { bold: true };
  ws.columns = headers.map((h, i) => ({ width: i === 1 ? 30 : Math.max(h.length + 2, 11) }));
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `Annual_Salary_Register_${fy}.xlsx`; a.click(); URL.revokeObjectURL(a.href);
}
