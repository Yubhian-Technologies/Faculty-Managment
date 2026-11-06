export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { editableDepartmentNames, getHodDepartmentScope } from "@/lib/departments/scope";
import { getInChunks } from "@/lib/firestore/inQuery";
import { departmentNamesById, ownerDepartmentNames } from "@/lib/subjects/ownerDepartment";
import { subjectErrorResponse } from "@/lib/subjects/http";
import type { Subject } from "@/types";

// HOD: the subjects their department looks after (Subject Department set by Academics), whichever
// branches they are taught in - for the syllabus. Reads only.
export async function GET() {
  try {
    const session = await requireCollegeMember("HOD");
    const db = getAdminDb();
    const [scope, names] = await Promise.all([
      getHodDepartmentScope(db, session.collegeId, session.uid),
      departmentNamesById(db, session.collegeId),
    ]);
    const mine = new Set(editableDepartmentNames(scope));
    const ids = [...names.entries()].filter(([, n]) => mine.has(n)).map(([id]) => id);
    const col = db.collection("colleges").doc(session.collegeId).collection("subjects");
    // The list (two departments possible), and the single field saved before the list existed.
    const [listed, single] = await Promise.all([
      getInChunks(ids, (chunk) => col.where("ownerDepartmentIds", "array-contains-any", chunk)),
      getInChunks(ids, (chunk) => col.where("ownerDepartmentId", "in", chunk)),
    ]);
    const docs = [...new Map([...listed, ...single].map((d) => [d.id, d])).values()];
    const subjects = docs.map((d) => {
      const s = d.data() as Subject;
      return {
        id: d.id, name: s.name, code: s.code, courseName: s.courseName ?? "", regulation: s.regulation ?? "", type: s.type,
        department: ownerDepartmentNames(s, names).join(", "),
        syllabusUrl: s.syllabusUrl ?? null, syllabusFileName: s.syllabusFileName ?? null, syllabusUpdatedByName: s.syllabusUpdatedByName ?? null,
        isActive: s.isActive !== false,
      };
    }).sort((a, b) => a.courseName.localeCompare(b.courseName) || a.regulation.localeCompare(b.regulation) || a.code.localeCompare(b.code));
    return NextResponse.json({ subjects });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/owned GET]");
  }
}
