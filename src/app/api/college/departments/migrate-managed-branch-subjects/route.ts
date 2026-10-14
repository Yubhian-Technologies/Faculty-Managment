export const dynamic = "force-dynamic";

import { badBodyResponse, readJsonBody } from "@/lib/http/readJsonBody";
import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { previewMigrateManagedBranchSubjects, migrateManagedBranchSubjects } from "@/lib/departments/migrateManagedBranchSubjects";

// Moves a shared-year manager's (e.g. "BS-E") subjects/teaching-assignments/
// timetable rows over to one of its own managed core departments (e.g.
// "EEE") directly - see migrateManagedBranchSubjects.ts for the full write
// plan. Academics/Principal only, same roles as subject-semester-assignments
// writes - this is a bulk curriculum-ownership operation, not something an
// HOD (even the managing sub-department's own) triggers themselves.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember("PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN", "ACADEMICS");
    const body = (await readJsonBody(request)) as {
      subDepartmentId?: string;
      branchDepartmentId?: string;
      years?: number[];
      dryRun?: boolean;
    };

    if (!body.subDepartmentId || !body.branchDepartmentId) {
      return NextResponse.json({ error: "subDepartmentId and branchDepartmentId are required" }, { status: 400 });
    }
    if (body.years !== undefined && (!Array.isArray(body.years) || body.years.some((y) => !Number.isInteger(y) || y < 1))) {
      return NextResponse.json({ error: "years must be a list of whole numbers" }, { status: 400 });
    }

    const db = getAdminDb();
    const run = body.dryRun === false ? migrateManagedBranchSubjects : previewMigrateManagedBranchSubjects;
    const result = await run(db, session.collegeId, body.subDepartmentId, body.branchDepartmentId, body.years);

    return NextResponse.json({ dryRun: body.dryRun !== false, ...result });
  } catch (err) {
    const badBody = badBodyResponse(err);
    if (badBody) return badBody;
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof Error && (err.message.includes("not found") || err.message.includes("managed core departments"))) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[departments/migrate-managed-branch-subjects]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
