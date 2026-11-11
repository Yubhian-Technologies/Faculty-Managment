export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanRevision, withRevision } from "@/lib/payroll/pay";
import { PayrollError, listPayEmployees, loadPayrollSettings, payrollErrorResponse, payrollRefs, releasedOnOrAfter, requirePayrollAccounts, requirePayrollReader } from "@/lib/payroll/server";
import type { EmployeePay, PayRevision } from "@/types/payroll";

// One person's pay with every revision (GET: Accounts + College Office), and a new revision (PUT: Accounts).
// A revision is effective from the 1st of a month; it may not start inside a month already released -
// a back-dated rise is paid as arrears in the next run instead.

type Ctx = { params: Promise<{ employeeKey: string }> };
const KEY_RE = /^(FACULTY|STAFF)_[A-Za-z0-9_-]{1,128}$/;

export async function GET(request: Request, { params }: Ctx) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollReader(db, request);
    const { employeeKey } = await params;
    if (!KEY_RE.test(employeeKey)) throw new PayrollError("Not found", 404);
    const employee = (await listPayEmployees(db, session.collegeId)).find((e) => e.employeeKey === employeeKey);
    if (!employee) throw new PayrollError("Not found", 404);
    const snap = await payrollRefs(db, session.collegeId).pay.doc(employeeKey).get();
    const pay = snap.exists ? (snap.data() as EmployeePay) : null;
    const { extra: _extra, ...shown } = employee;
    void _extra;
    return NextResponse.json({ employee: shown, revisions: pay?.revisions ?? [], canEdit: session.role !== "COLLEGE_OFFICE" });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/pay/[employeeKey] GET]");
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  try {
    const db = getAdminDb();
    const session = await requirePayrollAccounts(db, request);
    const { employeeKey } = await params;
    if (!KEY_RE.test(employeeKey)) throw new PayrollError("Not found", 404);
    const body = (await readJsonBody(request)) as { revision?: unknown; revisionCount?: unknown };
    const [{ settings }, employees] = await Promise.all([loadPayrollSettings(db, session.collegeId), listPayEmployees(db, session.collegeId)]);
    const employee = employees.find((e) => e.employeeKey === employeeKey);
    if (!employee) throw new PayrollError("Not found", 404);
    const clean = cleanRevision(body.revision, settings);
    const released = await releasedOnOrAfter(db, session.collegeId, clean.effectiveFrom);
    if (released) throw new PayrollError(`${released} is already released - start this pay from a later month and pay the difference as arrears`, 409);

    const ref = payrollRefs(db, session.collegeId).pay.doc(employeeKey);
    const rev: PayRevision = { ...clean, byName: session.email, byUid: session.uid, at: new Date().toISOString() };
    const saved = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cur = snap.exists ? (snap.data() as EmployeePay) : null;
      if (Number(body.revisionCount ?? -1) !== (cur?.revisions.length ?? 0)) throw new PayrollError("Someone else changed this pay - reload and try again", 409);
      const next: EmployeePay = {
        employeeKey, kind: employee.kind, recordId: employee.recordId, employeeCode: employee.employeeCode, name: employee.name,
        revisions: withRevision(cur?.revisions ?? [], rev), updatedAt: rev.at, updatedByName: session.email,
      };
      tx.set(ref, next);
      return next;
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "PAYROLL_PAY_UPDATED", performedBy: session.uid, performedByName: session.email, targetId: employeeKey,
      details: { employeeCode: employee.employeeCode, effectiveFrom: rev.effectiveFrom, amounts: rev.amounts, exempt: rev.exempt },
    });
    return NextResponse.json({ revisions: saved.revisions });
  } catch (err) {
    return payrollErrorResponse(err, "[college/payroll/pay/[employeeKey] PUT]");
  }
}
