export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { isMonthKey } from "@/lib/payroll/rules";
import { payslipFromLine } from "@/lib/payroll/payslip";
import { runRefs } from "@/lib/payroll/runServer";
import { PAYSLIP_ROLES, PayrollError, myPayEmployee, payrollErrorResponse, payslipCollege } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// The signed-in person's own payslip for a RELEASED month.
export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  try {
    const session = await requireCollegeMember(...PAYSLIP_ROLES);
    const { month } = await params;
    if (!isMonthKey(month)) throw new PayrollError("Not found", 404);
    const db = getAdminDb();
    const me = await myPayEmployee(db, session.collegeId, session.uid);
    if (!me) throw new PayrollError("Not found", 404);
    const refs = runRefs(db, session.collegeId, month);
    const [runSnap, lineSnap] = await Promise.all([refs.run.get(), refs.lines.doc(me.employeeKey).get()]);
    const run = runSnap.data() as PayrollRun | undefined;
    if (!run || run.status !== "RELEASED" || !lineSnap.exists) throw new PayrollError("Not found", 404);
    return NextResponse.json({ payslip: payslipFromLine(run, lineSnap.data() as PayrollLine, await payslipCollege(db, session.collegeId)) });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/my/[month] GET]");
  }
}
