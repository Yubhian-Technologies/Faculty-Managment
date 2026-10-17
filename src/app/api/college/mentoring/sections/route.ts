export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames } from "@/lib/departments/scope";
import { getInChunks } from "@/lib/firestore/inQuery";
import { loadHodStudentScope } from "@/lib/mentoring/access";
import { mentoringErrorResponse } from "@/lib/mentoring/http";
import type { Section } from "@/types";

// The sections whose students this HOD may give a mentor: only a year the HOD runs themselves. A
// section whose year another department runs (the shared first year under Basic Science, say) is
// not offered to the students' permanent HOD - it is the other HOD's to assign.
// ?for=view lists every section whose students the HOD may look at (the shared year included).
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const collegeRef = db.collection("colleges").doc(session.collegeId);
    const view = new URL(request.url).searchParams.get("for") === "view";
    const { scope, canViewSection, canAssign } = await loadHodStudentScope(db, session.collegeId, session.uid);
    const docs = await getInChunks([...new Set(editableDepartmentNames(scope))], (chunk) =>
      collegeRef.collection("sections").where("department", "in", chunk)
    );
    if (view) {
      // Sections cross-listed to this HOD's branches (secondaryDepartments) are theirs to look at too.
      const targets = [...new Set([...scope.ownDepartmentNames, ...scope.childDepartmentNames])].slice(0, 10);
      if (targets.length > 0) {
        const cross = await collegeRef.collection("sections").where("secondaryDepartments", "array-contains-any", targets).get();
        const seen = new Set(docs.map((d) => d.id));
        for (const d of cross.docs) if (!seen.has(d.id)) docs.push(d as (typeof docs)[number]);
      }
    }
    const all = docs.map((d) => ({ ...(d.data() as Section), id: d.id }));
    const allowed = await Promise.all(all.map((s) => (view ? canViewSection(s) : canAssign(s))));
    const sections = all
      .filter((_, i) => allowed[i])
      .map((s) => ({ id: s.id, name: s.name, year: s.year, department: s.department, courseId: s.courseId, courseName: s.courseName ?? "" }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName) || a.year - b.year || a.name.localeCompare(b.name));
    return NextResponse.json({ sections });
  } catch (err) {
    return mentoringErrorResponse(err, "[college/mentoring/sections GET]");
  }
}
