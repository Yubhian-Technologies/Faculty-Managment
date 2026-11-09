export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { cachedHodScope } from "@/lib/departments/cachedHodScope";
import { subjectDepartmentBranches } from "@/lib/subjects/subjectDepartmentBranches";
import { departmentNamesById, ownerDepartmentNames } from "@/lib/subjects/ownerDepartment";
import { subjectErrorResponse } from "@/lib/subjects/http";
import type { Subject } from "@/types";

// HOD: the subjects their department looks after (Subject Department set by Academics), whichever
// branches they are taught in - for the syllabus - and those branches (HOD > Subjects lists them). Reads only.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const [scope, names] = await Promise.all([
      cachedHodScope(db, session.collegeId, session.uid),
      departmentNamesById(db, session.collegeId),
    ]);
    // Own department(s) + sub-departments only: a managed branch's subjects belong to that branch's own HOD.
    const { subjects: docs, branches, placements } = await subjectDepartmentBranches(db, session.collegeId, session.uid, scope);
    const subjects = docs.map((d) => {
      const s = d.data() as Subject;
      return {
        id: d.id, name: s.name, code: s.code, courseName: s.courseName ?? "", regulation: s.regulation ?? "", type: s.type,
        department: ownerDepartmentNames(s, names).join(", "),
        syllabusUrl: s.syllabusUrl ?? null, syllabusFileName: s.syllabusFileName ?? null, syllabusUpdatedByName: s.syllabusUpdatedByName ?? null,
        isActive: s.isActive !== false,
      };
    }).sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation) || a.code.localeCompare(b.code));
    return NextResponse.json({ subjects, branches, placements });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/owned GET]");
  }
}
