export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { computeYearlyLeaveSummary } from "@/lib/leave/monthlySummary";
import { resolveReportRoster } from "@/lib/leave/reportRoster";

interface YearlyReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
  category: string | null;
  months: Awaited<ReturnType<typeof computeYearlyLeaveSummary>>["months"];
  totals: Awaited<ReturnType<typeof computeYearlyLeaveSummary>>["totals"];
}

// Whole-year leave register: same roster as the monthly report, but every
// person's full 12 months (+ a yearly total) instead of one month's snapshot -
// see computeYearlyLeaveSummary for why this doesn't refetch Firestore 12x.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "HOD");
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    const db = getAdminDb();
    const roster = await resolveReportRoster(db, session.collegeId, session, searchParams);
    if ("error" in roster) return NextResponse.json({ error: roster.error }, { status: roster.status });
    const { department, people } = roster;

    const rows: YearlyReportRow[] = await Promise.all(
      people.map(async (p) => {
        const summary = await computeYearlyLeaveSummary(db, session.collegeId, p.uid, year);
        return { ...p, category: summary.category, months: summary.months, totals: summary.totals };
      })
    );

    return NextResponse.json({ department, year, rows });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report/yearly GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
