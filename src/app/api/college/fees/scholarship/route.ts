export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { paymentErrorResponse } from "@/lib/payments/server";
import { FeeError, feeRefs, todayIst } from "@/lib/fees/server";
import { requireScholarshipManager } from "@/lib/fees/http";
import { academicYearOf, ACADEMIC_YEAR_RE } from "@/lib/fees/rules";
import type { StudentFeeAccount } from "@/types/fees";

// Scholarship Cell (location; ?collegeId of a college in its location): the Category A students' fee accounts of an academic year - FR / NFR, what the
// government pays (FR-covered heads), what arrived, what the student pays. Spot and Category B students always pay
// themselves and are not listed.
// GET ?academicYear=   (default: the current academic year)

export async function GET(request: Request) {
  try {
    const db = getAdminDb();
    const session = await requireScholarshipManager(db, request);
    const year = new URL(request.url).searchParams.get("academicYear") || academicYearOf(todayIst());
    if (!ACADEMIC_YEAR_RE.test(year)) throw new FeeError("Select the academic year.");
    const snap = await feeRefs(db, session.collegeId).accounts.where("academicYear", "==", year).where("category", "==", "A").get();
    const rows = snap.docs.map((d) => d.data() as StudentFeeAccount).sort((a, b) => a.rollNumber.localeCompare(b.rollNumber)).map((a) => ({
      id: a.id, rollNumber: a.rollNumber, name: a.name, department: a.department, section: a.section, courseName: a.courseName, batch: a.batch,
      funding: a.funding, fundingNote: a.fundingNote ?? "", gross: a.gross, frCoveredFee: a.heads.filter((h) => h.frCovered).reduce((n, h) => n + h.amount, 0),
      govtShare: a.govtShare, govtReceived: a.govtReceived ?? 0, studentShare: a.studentShare, paid: a.paid, balance: a.balance,
    }));
    return NextResponse.json({ academicYear: year, rows });
  } catch (err) {
    return paymentErrorResponse(err, "[college/fees/scholarship GET]");
  }
}
