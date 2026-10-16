export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeContext } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  getHodDepartmentScope, canHodManageFacultyDepartment, facultyManageableDepartmentNames, getDepartmentTreeNames,
} from "@/lib/departments/scope";
import { whereIn, type QueryLike } from "@/lib/firestore/inQuery";
import { migrateFacultyDoc } from "@/lib/faculty/fieldRenames";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { LEGACY_TECHNICAL_DESIGNATIONS } from "@/lib/designations/config";
import { computeFacultyProfileCompletion, COMPLETION_MODULE_ORDER } from "@/lib/faculty/profileCompletion";
import { EXPORT_MODULE_LABELS } from "@/lib/faculty/csvColumns";
import type { FacultyMember } from "@/types";

// Faculty Profile Completion Rate report - how much of each faculty member's
// own profile is filled in, section by section (see profileCompletion.ts).
// HOD sees only their own department tree's faculty (never a managed/"core"
// branch's roster - same rule as GET /api/college/faculty); Principal/VP/
// Super Admin see the whole college, optionally narrowed to one department's
// tree via `?department=`. Super Admin (a global role, no ambient collegeId)
// must pass `?collegeId=`.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeContext(request, "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN");
    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get("department");

    const db = getAdminDb();
    const facultyColl = db.collection("colleges").doc(session.collegeId).collection("facultyMembers");
    let query: QueryLike = facultyColl;

    if (session.role === "HOD") {
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: !deptFilter });
      if (deptFilter) {
        if (!canHodManageFacultyDepartment(scope, deptFilter)) {
          return NextResponse.json({ error: "That department is not yours or one of your sub-departments" }, { status: 403 });
        }
        const treeNames = (await getDepartmentTreeNames(db, session.collegeId, deptFilter))
          .filter((n) => canHodManageFacultyDepartment(scope, n));
        query = whereIn(query, "department", treeNames);
      } else {
        const names = facultyManageableDepartmentNames(scope);
        if (names.length === 0) return NextResponse.json({ sections: sectionMeta(), faculty: [] });
        query = whereIn(query, "department", names);
      }
    } else if (deptFilter) {
      const treeNames = await getDepartmentTreeNames(db, session.collegeId, deptFilter);
      query = whereIn(query, "department", treeNames);
    }
    // Principal/VP/Super Admin with no `department` param: whole college, unfiltered.

    const snap = await query.get();
    const faculty = snap.docs
      .map((d) => ({ id: d.id, ...migrateFacultyDoc(d.data()) } as FacultyMember & { id: string }))
      // Faculty roster only - Supporting Staff (technical designations) have no "profile" in this sense.
      .filter((f) => !LEGACY_TECHNICAL_DESIGNATIONS.includes(f.designation as string))
      .map((f) => {
        const completion = computeFacultyProfileCompletion(f);
        return {
          id: f.id,
          employeeId: f.employeeId,
          name: facultyDisplayName(f),
          department: f.department,
          designation: f.designation,
          status: f.status,
          ...completion,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ sections: sectionMeta(), faculty });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[college/faculty/profile-completion GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function sectionMeta() {
  return COMPLETION_MODULE_ORDER.map((key) => ({ key, label: EXPORT_MODULE_LABELS[key] }));
}
