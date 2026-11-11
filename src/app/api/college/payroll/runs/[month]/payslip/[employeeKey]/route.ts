export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { isMonthKey } from "@/lib/payroll/rules";
import { payslipFromLine } from "@/lib/payroll/payslip";
import { runRefs } from "@/lib/payroll/runServer";
import { PayrollError, payrollErrorResponse, payslipCollege, requirePayrollActor } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// Anyone's payslip from a month, for the College Office / Accounts (e.g. staff without a login).
// Before release it is marked as a preview.
export async function GET(request: Request, { params }: { params: Promise<{ month: string; employeeKey: string }> }) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollActor(db, request);
    const { month, employeeKey } = await params;
    if (!isMonthKey(month) || !/^(FACULTY|STAFF)_[A-Za-z0-9_-]{1,128}$/.test(employeeKey)) throw new PayrollError("Not found", 404);
    const refs = runRefs(db, session.collegeId, month);
    const [runSnap, lineSnap] = await Promise.all([refs.run.get(), refs.lines.doc(employeeKey).get()]);
    if (!runSnap.exists || !lineSnap.exists) throw new PayrollError("Not found", 404);
    return NextResponse.json({ payslip: payslipFromLine(runSnap.data() as PayrollRun, lineSnap.data() as PayrollLine, await payslipCollege(db, session.collegeId)) });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/runs/[month]/payslip GET]");
  }
}
