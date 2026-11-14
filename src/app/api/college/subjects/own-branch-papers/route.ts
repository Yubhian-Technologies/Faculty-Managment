export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { getHodDepartmentScope } from "@/lib/departments/scope";
import { reviewingDepartment } from "@/lib/midBank/reviewer";
import { ownerDepartmentNamesLive } from "@/lib/subjects/ownerDepartment";
import { subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";
import type { Subject } from "@/types";

// Which branches prepare and approve their OWN Mid papers for one subject that has a Subject Department -
// { subjectId: string, departmentIds: string[] } (the whole list; [] = none). In those branches the branch's own HOD
// assigns the setters and approves; the other branches stay with the Subject Department.
// Set by the Subject Department's HOD (their own department, never a 1st-year coordinator), from the Assign paper
// setters card - it is their subject. Super Admin may change it for support. Academics / Principal / VP see it on
// the Subjects list (read only).
export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember("HOD", "SUPER_ADMIN");
    const body = (await readJsonBody(request)) as { subjectId?: unknown; departmentIds?: unknown };
    if (typeof body.subjectId !== "string" || !body.subjectId) return NextResponse.json({ error: "Select a subject." }, { status: 400 });
    if (!Array.isArray(body.departmentIds)) return NextResponse.json({ error: "Select the branches." }, { status: 400 });

    if (session.role === "HOD") {
      const db = getAdminDb();
      const snap = await db.collection("colleges").doc(session.collegeId).collection("subjects").doc(body.subjectId).get();
      if (!snap.exists) return NextResponse.json({ error: "Subject not found. It may have been deleted." }, { status: 404 });
      const owners = await ownerDepartmentNamesLive(db, session.collegeId, snap.data() as Subject);
      const scope = await getHodDepartmentScope(db, session.collegeId, session.uid, { activeOnly: false });
      if (!owners.length || !reviewingDepartment(scope, owners, true)) {
        return NextResponse.json({ error: "Only the HOD of this subject's Subject Department can choose the branches that prepare their own papers." }, { status: 403 });
      }
    }

    const result = await new SubjectMasterService().setOwnBranchPapers({
      collegeId: session.collegeId,
      subjectId: body.subjectId,
      departmentIds: body.departmentIds.map(String),
      actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json(result);
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/own-branch-papers PUT]");
  }
}
