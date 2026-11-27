export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";
import { requireFeesManager } from "@/lib/fees/http";
import { FeeError, feeRefs } from "@/lib/fees/server";
import { ACADEMIC_YEAR_RE } from "@/lib/fees/rules";
import { buildFeeDashboard, type DashPayment } from "@/lib/fees/dashboard";
import type { FeeConcessionRequest, FeeReceipt, StudentFeeAccount } from "@/types/fees";
import type { Payment } from "@/types/payments";

// Accounts > Fees > Dashboard (?collegeId): GET ?academicYear=&courseKey=&batch= - the year's fee position (raised,
// collected, balance, overdue, by bank account / head / category / class / department / instalment, overdue ageing,
// defaulters), money in by date and mode, and the online payments' outcomes. Read only. lib/fees/dashboard.ts.
export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireFeesManager(db, request);
    const sp = new URL(request.url).searchParams;
    const academicYear = sp.get("academicYear") ?? "";
    if (!ACADEMIC_YEAR_RE.test(academicYear)) throw new FeeError("Select the academic year.");
    const courseKey = sp.get("courseKey") ?? "", batch = sp.get("batch") ?? "";
    const refs = feeRefs(db, session.collegeId);
    let q = refs.accounts.where("academicYear", "==", academicYear);
    if (courseKey) q = q.where("courseKey", "==", courseKey);
    if (batch) q = q.where("batch", "==", batch);
    const [acc, rec, pay, conc] = await Promise.all([
      q.get(),
      refs.receipts.where("academicYear", "==", academicYear).get(),
      refs.college.collection("payments").where("purpose.kind", "==", "FEE").get(),
      refs.concessionRequests.where("status", "==", "PENDING").get(),
    ]);
    const accounts = acc.docs.map((d) => d.data() as StudentFeeAccount);
    const ids = new Set(accounts.map((a) => a.id));
    const filtered = !!(courseKey || batch);
    const receipts = rec.docs.map((d) => d.data() as FeeReceipt).filter((r) => !filtered || ids.has(r.accountId));
    const payments: DashPayment[] = pay.docs.map((d) => d.data() as Payment)
      .filter((p) => p.purpose.kind === "FEE" && p.purpose.academicYear === academicYear && (!filtered || ids.has(p.purpose.accountId)))
      .map((p) => ({ status: p.status, amount: p.amount, needsRefund: p.needsRefund, createdAt: p.createdAt }));
    const pendingConcessions = conc.docs.map((d) => d.data() as FeeConcessionRequest)
      .filter((r) => r.academicYear === academicYear && (!filtered || ids.has(r.accountId))).length;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    return NextResponse.json(buildFeeDashboard({ accounts, receipts, payments, pendingConcessions, today }));
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/dashboard GET]");
  }
}
