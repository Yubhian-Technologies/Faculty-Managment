import type { PayrollLine, PayrollRun } from "@/types/payroll";

// A payslip from a month's line - pure, shared by the employee's own payslips and the Office /
// Accounts download. Bank account is masked to its last 4 digits.

export interface PayslipData {
  month: string;
  final: boolean;                      // false = the month isn't released yet (a preview)
  college: { name: string; logoUrl?: string };
  person: { name: string; employeeCode: string; designation: string; department: string; bank: string; pan?: string; uan?: string };
  monthDays: number;
  payDays: number;
  lop: number;
  notCredited?: string;
  onHold?: string;
  earnings: { label: string; fixed: number; earned: number }[];
  oneOffs: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
  paidOn?: string;
}

export const maskAccount = (a: string) => (a ? `XXXX${a.replace(/\s/g, "").slice(-4)}` : "-");

export function payslipFromLine(run: Pick<PayrollRun, "month" | "status" | "settings" | "release">, line: PayrollLine, college: PayslipData["college"]): PayslipData {
  const employed = line.auto.monthDays - line.auto.notEmployedDays;
  return {
    month: run.month, final: run.status === "RELEASED", college,
    person: {
      name: line.name, employeeCode: line.employeeCode, designation: line.designation, department: line.department,
      bank: [line.bank.bankName, maskAccount(line.bank.account)].filter(Boolean).join(" "), ...(line.pan ? { pan: line.pan } : {}), ...(line.uan ? { uan: line.uan } : {}),
    },
    monthDays: line.auto.monthDays, payDays: line.payDays, lop: Math.max(0, employed - line.payDays),
    ...(line.notCredited ? { notCredited: line.notCredited.reason } : {}),
    ...(line.hold ? { onHold: line.hold.reason } : {}),
    earnings: run.settings.earnings.filter((e) => line.amounts[e.id] || line.result.earned[e.id]).map((e) => ({ label: e.label, fixed: line.amounts[e.id] ?? 0, earned: line.result.earned[e.id] ?? 0 })),
    oneOffs: line.oneOffs.map((o) => ({ label: o.label, amount: o.amount })),
    deductions: run.settings.deductions.filter((d) => (line.result.deductions[d.id] ?? 0) > 0).map((d) => ({ label: d.label, amount: line.result.deductions[d.id] })),
    gross: line.result.gross, totalDeductions: line.result.totalDeductions, net: line.result.net,
    ...(run.release?.paidOn && run.status === "RELEASED" ? { paidOn: run.release.paidOn } : {}),
  };
}
