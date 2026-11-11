export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { runRefs } from "@/lib/payroll/runServer";
import { PAYSLIP_ROLES, myPayEmployee, payrollErrorResponse, payrollRefs } from "@/lib/payroll/server";
import type { PayrollLine, PayrollRun } from "@/types/payroll";

// The signed-in faculty / staff member's own payslips: every RELEASED month they have a line in (latest
// first, up to 36). Nobody else's data is ever read here - the record is found from the session's uid.

export async function GET() {
  try {
    const session = await requireCollegeMember(...PAYSLIP_ROLES);
    const db = getAdminDb();
    const me = await myPayEmployee(db, session.collegeId, session.uid);
    if (!me) return NextResponse.json({ employee: null, payslips: [] });
    const runs = (await payrollRefs(db, session.collegeId).runs.where("status", "==", "RELEASED").get()).docs
      .map((d) => d.data() as PayrollRun).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 36);
    const lines = await Promise.all(runs.map((r) => runRefs(db, session.collegeId, r.month).lines.doc(me.employeeKey).get()));
    const payslips = runs.flatMap((r, i) => {
      if (!lines[i].exists) return [];
      const l = lines[i].data() as PayrollLine;
      return [{ month: r.month, gross: l.result.gross, totalDeductions: l.result.totalDeductions, net: l.result.net, paidOn: r.release?.paidOn ?? null, notCredited: !!l.notCredited, onHold: !!l.hold }];
    });
    return NextResponse.json({ employee: { name: me.name, employeeCode: me.employeeCode, department: me.department, designation: me.designation }, payslips });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/my GET]");
  }
}
