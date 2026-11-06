export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";

// Academics / Principal / VP: change the Subject Departments of one or many master subjects -
// { subjectIds: string[], mode: "SET" | "ADD" | "REMOVE", departmentIds: string[] } (SET with none =
// each branch looks after it). At most two per subject; their HODs approve the subject's question
// banks / papers (either one decides) and keep its syllabus.
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const body = (await readJsonBody(request)) as { subjectIds?: unknown; mode?: unknown; departmentIds?: unknown };
    if (!Array.isArray(body.subjectIds)) return NextResponse.json({ error: "subjectIds must be a list" }, { status: 400 });
    if (!Array.isArray(body.departmentIds)) return NextResponse.json({ error: "departmentIds must be a list" }, { status: 400 });
    const mode = body.mode === "ADD" || body.mode === "REMOVE" ? body.mode : body.mode === "SET" ? "SET" : null;
    if (!mode) return NextResponse.json({ error: "mode must be SET, ADD or REMOVE" }, { status: 400 });
    const result = await new SubjectMasterService().setOwnerDepartments({
      collegeId: session.collegeId,
      subjectIds: body.subjectIds.map(String),
      mode,
      departmentIds: body.departmentIds.map(String),
      actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json(result);
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/owner-department POST]");
  }
}
