export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { estimateMonth, estimatePerson, fyFrom, loadTaxContexts } from "@/lib/payroll/taxServer";
import { listPayEmployees, loadPayrollSettings, payrollErrorResponse, payrollRefs, requirePayrollAccounts } from "@/lib/payroll/server";
import type { EmployeePay } from "@/types/payroll";

// Everyone's tax for a financial year (Accounts): regime, whether declarations / opening figures are in,
// and an estimate as of this month (annual tax, deducted so far, this month's TDS, the other regime's tax).

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const month = estimateMonth(fy);
    const [{ settings }, employees, paySnap] = await Promise.all([
      loadPayrollSettings(db, session.collegeId), listPayEmployees(db, session.collegeId), payrollRefs(db, session.collegeId).pay.get(),
    ]);
    const pays = new Map(paySnap.docs.map((d) => [d.id, d.data() as EmployeePay]));
    const tax = await loadTaxContexts(db, session.collegeId, month, settings);
    const rows = employees.filter((e) => pays.has(e.employeeKey)).map((e) => {
      const ctx = tax.contextFor(e.employeeKey);
      const est = estimatePerson(pays.get(e.employeeKey), month, settings, ctx, e.extra.lastWorkingDate);
      const p = ctx.profile;
      return {
        employeeKey: e.employeeKey, employeeCode: e.employeeCode, name: e.name, department: e.department, status: e.status,
        profile: p, hasProfile: p.rev > 0,
        declared: Object.entries(p.declarations).some(([k, v]) => k !== "metro" && Number(v) > 0) || p.otherIncome > 0 || p.previousEmployer.salary > 0,
        estimate: est ? { annualTax: est.calc.annualTax, deductedBefore: est.calc.deductedBefore, tdsNow: est.tdsNow, otherRegimeTax: est.otherRegimeTax, annualSalary: est.calc.annualSalary } : null,
      };
    });
    return NextResponse.json({ fy, month, rulesConfirmed: !!tax.rules, rows });
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Enter the financial year as YYYY-YY, for example 2026-27." }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/tax/profiles GET]");
  }
}
