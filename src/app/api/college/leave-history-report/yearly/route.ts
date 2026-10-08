export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { computeYearlyLeaveSummary } from "@/lib/leave/monthlySummary";
import { resolveReportRoster } from "@/lib/leave/reportRoster";
import { resolveCollegeLocationName } from "@/lib/college/locationName";
import { countHolidaysPerMonth } from "@/lib/leave/holidaysCount";
import { YEARLY_RECORDS_COL } from "@/lib/leave/yearlyImport";

interface YearlyReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
  category: string | null;
  dateOfJoining: Date | null;
  months: Awaited<ReturnType<typeof computeYearlyLeaveSummary>>["months"];
  totals: Awaited<ReturnType<typeof computeYearlyLeaveSummary>>["totals"];
}

// Whole-year leave register: same roster as the monthly report, but every
// person's full 12 months (+ a yearly total) instead of one month's snapshot -
// see computeYearlyLeaveSummary for why this doesn't refetch Firestore 12x.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "HOD");
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);

    const db = getAdminDb();
    const roster = await resolveReportRoster(db, session.collegeId, session, searchParams);
    if ("error" in roster) return NextResponse.json({ error: roster.error }, { status: roster.status });
    const { department, people } = roster;

    const [rows, location, holidaysByMonth, importedSnap] = await Promise.all([
      Promise.all(
        people.map(async (p): Promise<YearlyReportRow> => {
          const summary = await computeYearlyLeaveSummary(db, session.collegeId, p.uid, year);
          return {
            ...p,
            category: summary.category,
            dateOfJoining: summary.dateOfJoining,
            months: summary.months,
            totals: summary.totals,
          };
        })
      ),
      resolveCollegeLocationName(db, session.collegeId),
      countHolidaysPerMonth(db, session.collegeId, year),
      // Weekly Offs / Holidays brought in by the year-wise Leave History import, one doc per employee-year.
      db.collection("colleges").doc(session.collegeId).collection(YEARLY_RECORDS_COL).where("year", "==", year).get(),
    ]);
    const wanted = new Set(people.map((p) => p.uid));
    const importedYearly: Record<string, { weeklyOffs?: number; holidays?: number }> = {};
    for (const d of importedSnap.docs) {
      const r = d.data() as { uid?: string; weeklyOffs?: number; holidays?: number };
      if (r.uid && wanted.has(r.uid)) {
        importedYearly[r.uid] = {
          ...(typeof r.weeklyOffs === "number" ? { weeklyOffs: r.weeklyOffs } : {}),
          ...(typeof r.holidays === "number" ? { holidays: r.holidays } : {}),
        };
      }
    }

    return NextResponse.json({ department, year, rows, location, holidaysByMonth, importedYearly });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report/yearly GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
