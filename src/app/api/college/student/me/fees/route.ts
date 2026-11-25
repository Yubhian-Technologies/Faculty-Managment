export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { activeCcavenue, receiptCollege } from "@/lib/payments/server";
import { minimumOnline } from "@/lib/fees/online";
import { feeRefs } from "@/lib/fees/server";
import { instalmentStates } from "@/lib/fees/rules";
import type { FeeReceipt, StudentFeeAccount } from "@/types/fees";

// The signed-in student's own fees (always resolved from the session): each academic year's account - fee by head
// (the government's FR part, concessions, what the student pays), instalments with what is paid / due / overdue - and their receipts (with the college
// letterhead, to print).
export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) return NextResponse.json({ error: "Your login is not linked to a student record yet. Contact your College Office." }, { status: 404 });
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();
    const refs = feeRefs(db, session.collegeId);
    const [acc, rec, college, ccav] = await Promise.all([
      refs.accounts.where("studentId", "==", own.student.id).get(),
      refs.receipts.where("studentId", "==", own.student.id).get(),
      receiptCollege(db, session.collegeId),
      activeCcavenue(db, session.collegeId).catch(() => null),
    ]);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const accounts = acc.docs.map((d) => d.data() as StudentFeeAccount).sort((a, b) => b.academicYear.localeCompare(a.academicYear)).map((a) => ({
      id: a.id, academicYear: a.academicYear, courseName: a.courseName, batch: a.batch, category: a.category, funding: a.funding,
      heads: a.heads.map((h) => ({ headId: h.headId, name: h.name, amount: h.amount, govt: h.govt, concession: h.concession, student: h.student })), gross: a.gross,
      concessions: a.concessions.map((c) => ({ amount: c.amount, reason: c.reason, headName: c.headName ?? null })), concessionTotal: a.concessionTotal,
      govtShare: a.govtShare, studentShare: a.studentShare, paid: a.paid, balance: a.balance, status: a.status,
      instalments: instalmentStates(a, today),
      minOnline: minimumOnline(a),
    }));
    const receipts = rec.docs.map((d) => d.data() as FeeReceipt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ id: r.id, receiptNo: r.receiptNo, academicYear: r.academicYear, amount: r.amount, mode: r.mode, reference: r.reference, paidOn: r.paidOn, allocation: r.allocation, cancelled: !!r.cancelled, source: r.source, rollNumber: r.rollNumber, name: r.name, department: r.department, section: r.section, courseName: r.courseName, bank: r.bank ?? "" }));
    // Online payment (CCAvenue) shows only while the college's account is on.
    return NextResponse.json({ accounts, receipts, college, today, onlinePay: !!ccav });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) return NextResponse.json({ error: "You do not have access, or your session has expired. Sign in again to continue." }, { status: 401 });
    console.error("[student/me/fees GET]", err);
    return NextResponse.json({ error: "Unable to complete the request. Try again; if it continues, contact the administrator." }, { status: 500 });
  }
}
