export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildTaxStatement, fyFrom } from "@/lib/payroll/taxServer";
import { PayrollError, listPayEmployees, loadPayrollSettings, payrollErrorResponse, requirePayrollAccounts } from "@/lib/payroll/server";

// A person's tax statement for a financial year (Accounts): the full computation as of this month and
// month by month - opening figures, released months (TDS deducted) and the months still projected.

export async function GET(request: Request, { params }: { params: Promise<{ employeeKey: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const fy = fyFrom(request);
    const { employeeKey } = await params;
    const employee = (await listPayEmployees(db, session.collegeId)).find((e) => e.employeeKey === employeeKey);
    if (!employee) throw new PayrollError("Not found", 404);
    const { settings } = await loadPayrollSettings(db, session.collegeId);
    return NextResponse.json(await buildTaxStatement(db, session.collegeId, employee, fy, settings));
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Enter the financial year as YYYY-YY, for example 2026-27." }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/tax/statement/[employeeKey] GET]");
  }
}
