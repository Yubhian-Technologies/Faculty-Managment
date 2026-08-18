export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { resolveDepartmentRoster, resolveCollegeRoster, buildRosterMonthlyRows } from "@/lib/attendance/rosterMonthlyExport";

// Department-wide or college-wide monthly CSV data, self-serve (session-
// scoped collegeId) - the multi-person counterpart to /api/college/attendance
// (which fills one person's whole month). HOD is always pinned to their own
// department (their department scope, same as /api/college/attendance/report's
// daily roster - own department + sub-departments); Principal/Vice Principal
// may name any department in their own college, or ask for the whole college.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "PRINCIPAL", "VICE_PRINCIPAL");
    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()), 10);
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10);
    const requestedScope = searchParams.get("scope");
    const requestedDepartment = searchParams.get("department")?.trim();

    const db = getAdminDb();

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid);
      const departmentNames = [scope.departmentName, ...scope.childDepartmentNames].filter(Boolean);
      const roster = await resolveDepartmentRoster(db, session.collegeId, departmentNames);
      const rows = await buildRosterMonthlyRows(db, session.collegeId, roster, year, month);
      return NextResponse.json({ scope: "department", department: scope.departmentName, rows });
    }

    // PRINCIPAL / VICE_PRINCIPAL
    if (requestedScope === "college") {
      const roster = await resolveCollegeRoster(db, session.collegeId);
      const rows = await buildRosterMonthlyRows(db, session.collegeId, roster, year, month);
      return NextResponse.json({ scope: "college", rows });
    }

    if (requestedScope === "department") {
      if (!requestedDepartment) {
        return NextResponse.json({ error: "department is required" }, { status: 400 });
      }
      const roster = await resolveDepartmentRoster(db, session.collegeId, [requestedDepartment]);
      const rows = await buildRosterMonthlyRows(db, session.collegeId, roster, year, month);
      return NextResponse.json({ scope: "department", department: requestedDepartment, rows });
    }

    return NextResponse.json({ error: "scope must be 'department' or 'college'" }, { status: 400 });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/attendance/monthly-export GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
