export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE, instalmentStates } from "@/lib/fees/rules";
import type { StudentFeeAccount } from "@/types/fees";

// Accounts > Fees > Dues / Collect (?collegeId): the fee accounts of an academic year.
// GET ?academicYear=&courseKey=&batch=&q=   q = Regd. No / name / mobile (Regd. No and name match the start)
// Each row: the account's totals + what is due now (overdue instalments and late fines as of today, IST).
export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const sp = new URL(request.url).searchParams;
    const academicYear = sp.get("academicYear") ?? "";
    if (!ACADEMIC_YEAR_RE.test(academicYear)) throw new FeeError("Select the academic year.");
    const courseKey = sp.get("courseKey") ?? "", batch = sp.get("batch") ?? "", q = (sp.get("q") ?? "").trim().toUpperCase();
    let query = feeRefs(db, session.collegeId).accounts.where("academicYear", "==", academicYear);
    if (courseKey) query = query.where("courseKey", "==", courseKey);
    if (batch) query = query.where("batch", "==", batch);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const rows = (await query.get()).docs.map((d) => d.data() as StudentFeeAccount)
      .filter((a) => !q || a.rollNumber.toUpperCase().startsWith(q) || a.name.toUpperCase().includes(q))
      .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber))
      .map((a) => {
        const st = instalmentStates(a, today);
        const overdue = st.filter((x) => x.overdue);
        return {
          id: a.id, rollNumber: a.rollNumber, name: a.name, department: a.department, section: a.section, courseName: a.courseName, batch: a.batch,
          admissionType: a.admissionType, category: a.category, funding: a.funding, gross: a.gross, concessionTotal: a.concessionTotal,
          govtShare: a.govtShare, govtReceived: a.govtReceived, studentShare: a.studentShare, paid: a.paid, balance: a.balance, status: a.status,
          overdue: overdue.reduce((n, x) => n + x.due, 0), fine: overdue.reduce((n, x) => n + x.fine, 0),
          nextDue: st.find((x) => x.due > 0)?.dueDate ?? null,
        };
      });
    return NextResponse.json({ rows, today });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/accounts GET]");
  }
}
