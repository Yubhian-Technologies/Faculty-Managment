export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { computeMonthlyLeaveSummary } from "@/lib/leave/monthlySummary";
import { resolveReportRoster } from "@/lib/leave/reportRoster";
import { resolveCollegeLocationName } from "@/lib/college/locationName";

interface ReportRow {
  uid: string;
  employeeId: string;
  name: string;
  role: string;
  category: string | null;
  dateOfJoining: Date | null;
  types: Awaited<ReturnType<typeof computeMonthlyLeaveSummary>>["types"];
  lopDays: number;
  otherDays: number;
}

// Monthly leave register: every faculty member with a login, plus per-type
// days taken this month + opening/closing balance (computeMonthlyLeaveSummary).
// See resolveReportRoster for the PRINCIPAL/VICE_PRINCIPAL/COLLEGE_OFFICE vs
// HOD roster rules.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "HOD");
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);

    const db = getAdminDb();
    const roster = await resolveReportRoster(db, session.collegeId, session, searchParams);
    if ("error" in roster) return NextResponse.json({ error: roster.error }, { status: roster.status });
    const { department, people } = roster;

    const [rows, location] = await Promise.all([
      Promise.all(
        people.map(async (p): Promise<ReportRow> => {
          const summary = await computeMonthlyLeaveSummary(db, session.collegeId, p.uid, year, month);
          return {
            ...p,
            category: summary.category,
            dateOfJoining: summary.dateOfJoining,
            types: summary.types,
            lopDays: summary.lopDays,
            otherDays: summary.otherDays,
          };
        })
      ),
      resolveCollegeLocationName(db, session.collegeId),
    ]);

    return NextResponse.json({ department, rows, location });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/leave-history-report GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
