export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { cachedHodScope } from "@/lib/departments/cachedHodScope";
import { ceaErrorResponse, ceaRefs, ceaSubjects } from "@/lib/cea/server";
import { reviewingDepartment } from "@/lib/midBank/reviewer";
import { departmentNamesById, ownerDepartmentNames } from "@/lib/subjects/ownerDepartment";
import type { CeaPlan } from "@/types";

// Subjects that need a CEA plan, with each one's plan status. The Exam Cell (and Principal / VP / Academics)
// see every one; an HOD sees the subjects their department looks after (Subject Department).

export async function GET() {
  try {
    const session = await requireCollegeMember("HOD", "EXAM_CELL", "PRINCIPAL", "VICE_PRINCIPAL", "ACADEMICS", "SUPER_ADMIN");
    const db = getAdminDb();
    const [list, names, plans, syllabi] = await Promise.all([
      ceaSubjects(db, session.collegeId), departmentNamesById(db, session.collegeId),
      ceaRefs(db, session.collegeId).plans.get(), ceaRefs(db, session.collegeId).college.collection("subjectSyllabus").get(),
    ]);
    const planOf = new Map(plans.docs.map((d) => [d.id, d.data() as CeaPlan]));
    const sylStatus = new Map(syllabi.docs.map((d) => [d.id, String(d.get("status") ?? "")]));
    const scope = session.role === "HOD" ? await cachedHodScope(db, session.collegeId, session.uid) : null;
    const rows = list.flatMap(({ subject, settings }) => {
      const owners = ownerDepartmentNames(subject, names);
      if (scope && !(owners.length && reviewingDepartment(scope, owners, true))) return [];
      const plan = planOf.get(subject.id);
      return [{
        subjectId: subject.id, code: subject.code, name: subject.name, courseName: settings.courseName, regulation: settings.regulation,
        subjectDepartments: owners, syllabusStatus: sylStatus.get(subject.id) ?? null,
        planned: !!plan, units: plan?.units ?? [], updatedAt: plan?.updatedAt ?? null, updatedByName: plan?.updatedByName ?? null,
      }];
    }).sort((a, b) => a.courseName.localeCompare(b.courseName) || a.code.localeCompare(b.code));
    return NextResponse.json({ subjects: rows, role: session.role });
  } catch (err) {
    return ceaErrorResponse(err, "[college/cea/subjects GET]");
  }
}
