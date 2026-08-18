export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireManagement } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveDepartmentRoster, resolveCollegeRoster, resolveCollegeStaffUnitRoster, buildRosterMonthlySummary } from "@/lib/attendance/rosterMonthlyExport";
import { unitLabelForHeadRole, isCollegeStaffUnitHead, COLLEGE_STAFF_UNIT_HEAD_ROLES } from "@/lib/attendance/collegeStaffUnits";

// MANAGEMENT is read-only - this route only implements GET.
// Department-wide or college-wide monthly CSV data for any college, mirroring
// /api/college/attendance/monthly-export (session-scoped, unreachable by
// Management) but resolved by an explicit collegeId URL param, same pairing
// as /api/management/colleges/[collegeId]/department-attendance vs.
// /api/college/attendance/report.
export async function GET(request: Request, { params }: { params: Promise<{ collegeId: string }> }) {
  try {
    await requireManagement();
    const { collegeId } = await params;
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const scope = searchParams.get("scope");
    const department = searchParams.get("department")?.trim();

    const db = getAdminDb();

    if (scope === "college") {
      const roster = await resolveCollegeRoster(db, collegeId);
      const rows = await buildRosterMonthlySummary(db, collegeId, roster, year, month);
      return NextResponse.json({ scope: "college", rows });
    }

    if (scope === "department") {
      if (!department) {
        return NextResponse.json({ error: "department is required" }, { status: 400 });
      }
      const roster = await resolveDepartmentRoster(db, collegeId, [department]);
      const rows = await buildRosterMonthlySummary(db, collegeId, roster, year, month);
      return NextResponse.json({ scope: "department", department, rows });
    }

    if (scope === "unit") {
      const unit = searchParams.get("unit") ?? "";
      if (!isCollegeStaffUnitHead(unit)) {
        return NextResponse.json({ error: `unit must be one of: ${COLLEGE_STAFF_UNIT_HEAD_ROLES.join(", ")}` }, { status: 400 });
      }
      const roster = await resolveCollegeStaffUnitRoster(db, collegeId, unit);
      const rows = await buildRosterMonthlySummary(db, collegeId, roster, year, month);
      return NextResponse.json({ scope: "unit", department: unitLabelForHeadRole(unit), rows });
    }

    return NextResponse.json({ error: "scope must be 'department', 'unit', or 'college'" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[management/colleges/monthly-export GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
