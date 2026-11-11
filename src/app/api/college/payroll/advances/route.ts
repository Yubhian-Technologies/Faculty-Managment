export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { advanceView, cleanAdvance } from "@/lib/payroll/advance";
import { PayrollError, listPayEmployees, payrollErrorResponse, payrollRefs, releasedOnOrAfter, requirePayrollAccounts, requirePayrollReader } from "@/lib/payroll/server";
import type { SalaryAdvance } from "@/types/payroll";

// Salary advances of a college. GET: Accounts + College Office (read). POST: Accounts give / record an
// advance - { employeeKey, amount, recoveredBefore?, instalment | recoveryPercent, startMonth, givenOn?, note? }.

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollReader(db, request);
    const [snap, employees] = await Promise.all([
      payrollRefs(db, session.collegeId).college.collection("salaryAdvances").get(),
      listPayEmployees(db, session.collegeId),
    ]);
    const advances = snap.docs.map((d) => advanceView({ ...(d.data() as SalaryAdvance), id: d.id }))
      .sort((a, b) => Number(a.status === "CLOSED") - Number(b.status === "CLOSED") || b.createdAt.localeCompare(a.createdAt));
    const canEdit = session.role !== "COLLEGE_OFFICE";
    return NextResponse.json({
      advances, canEdit,
      employees: canEdit ? employees.filter((e) => e.status !== "RESIGNED" && e.status !== "RETIRED").map((e) => ({ employeeKey: e.employeeKey, employeeCode: e.employeeCode, name: e.name, department: e.department })) : [],
    });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/advances GET]");
  }
}

export async function POST(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const employee = (await listPayEmployees(db, session.collegeId)).find((e) => e.employeeKey === body.employeeKey);
    if (!employee) throw new PayrollError("Pick the person");
    const input = cleanAdvance(body);
    const released = await releasedOnOrAfter(db, session.collegeId, input.startMonth);
    if (released) throw new PayrollError(`${released} is already released - recovery can start from a later month`, 409);
    const at = new Date().toISOString();
    const ref = payrollRefs(db, session.collegeId).college.collection("salaryAdvances").doc();
    const adv: Omit<SalaryAdvance, "id"> = {
      employeeKey: employee.employeeKey, employeeCode: employee.employeeCode, name: employee.name, ...input,
      status: "ACTIVE", recoveries: {}, rev: 1, createdAt: at, createdByName: session.email,
      history: [{ at, byName: session.email, change: `Advance Rs. ${input.amount}${input.recoveredBefore ? ` (Rs. ${input.recoveredBefore} already recovered)` : ""}, Rs. ${input.instalment} a month from ${input.startMonth}` }],
    };
    await ref.set(adv);
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_ADVANCE_CREATED", performedBy: session.uid, performedByName: session.email, targetId: ref.id,
      details: { employeeKey: employee.employeeKey, amount: input.amount, instalment: input.instalment, startMonth: input.startMonth },
    });
    return NextResponse.json({ advance: advanceView({ ...adv, id: ref.id }) });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/advances POST]");
  }
}
