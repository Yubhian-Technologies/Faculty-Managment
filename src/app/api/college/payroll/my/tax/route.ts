export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { buildTaxStatement, fyFrom } from "@/lib/payroll/taxServer";
import { PAYSLIP_ROLES, PayrollError, loadPayrollSettings, myPayEmployee, payrollErrorResponse } from "@/lib/payroll/server";

// The signed-in person's own income-tax statement for a financial year (?fy=2026-27).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...PAYSLIP_ROLES);
    const fy = fyFrom(request);
    const db = getAdminDb();
    const me = await myPayEmployee(db, session.collegeId, session.uid);
    if (!me) throw new PayrollError("Not found", 404);
    const { settings } = await loadPayrollSettings(db, session.collegeId);
    const s = await buildTaxStatement(db, session.collegeId, me, fy, settings);
    // The employee sees their computation; the profile's change history stays with Accounts.
    const { history: _h, ...profile } = s.profile;
    void _h;
    return NextResponse.json({ ...s, profile });
  } catch (err) {
    if (err instanceof Error && err.message === "BAD_FY") return NextResponse.json({ error: "Financial year must look like 2026-27" }, { status: 400 });
    return payrollErrorResponse(err, "[college/payroll/my/tax GET]");
  }
}
