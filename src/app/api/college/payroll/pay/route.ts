export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { istDateKey } from "@/lib/attendance/istTime";
import { isMonthKey } from "@/lib/payroll/rules";
import { listPayEmployees, loadPayrollSettings, payRowView, payrollErrorResponse, payrollRefs, requirePayrollReader } from "@/lib/payroll/server";
import type { EmployeePay } from "@/types/payroll";

// Every faculty / staff member of the college with the pay in force for ?month (default: this month).
// Accounts edit; the College Office reads.
export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollReader(db, request);
    const asked = new URL(request.url).searchParams.get("month");
    const month = isMonthKey(asked) ? asked : istDateKey().slice(0, 7);
    const [{ settings }, employees, paySnap] = await Promise.all([
      loadPayrollSettings(db, session.collegeId),
      listPayEmployees(db, session.collegeId),
      payrollRefs(db, session.collegeId).pay.get(),
    ]);
    const pay = new Map(paySnap.docs.map((d) => [d.id, d.data() as EmployeePay]));
    const rows = employees.map((e) => payRowView(e, pay.get(e.employeeKey), month));
    return NextResponse.json({ month, settings, rows, canEdit: session.role !== "COLLEGE_OFFICE" });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/pay GET]");
  }
}
