export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { parseCodeList, SubjectAssignService } from "@/lib/subjects/services/SubjectAssignService";

// Assign by code - the only way a subject is put into a department's semester.
//   { mode: "validate" | "commit", courseId, departmentId, regulation, year, semester, codes | codesText }
// `validate` writes nothing and reports every code (will be assigned / already there / not found /
// deactivated). `commit` runs the same checks and saves all of them in one transaction - or none:
// a single code with a problem means nothing is assigned (422, same per-code report).
// GET ?courseId&departmentId -> what the Assign tab offers for that department: the years it can be assigned
// subjects for (its own plus the shared years a managing department runs for it) and each year's semesters.
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    const departmentId = searchParams.get("departmentId");
    if (!courseId || !departmentId) return NextResponse.json({ error: "courseId and departmentId are required" }, { status: 400 });
    return NextResponse.json(await new SubjectAssignService().getScope(session.collegeId, courseId, departmentId));
  } catch (err) {
    return subjectErrorResponse(err, "[subject-semester-assignments/assign-by-code GET]");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const body = (await readJsonBody(request)) as {
      mode?: "validate" | "commit";
      courseId?: string;
      departmentId?: string;
      regulation?: string;
      year?: number | string;
      semester?: number | string;
      codes?: string[];
      codesText?: string;
    };
    if (body.mode !== "validate" && body.mode !== "commit") {
      return NextResponse.json({ error: 'mode must be "validate" or "commit"' }, { status: 400 });
    }
    if (!body.courseId || !body.departmentId) {
      return NextResponse.json({ error: "Select a course and a department first." }, { status: 400 });
    }
    const codes = Array.isArray(body.codes) ? body.codes.map(String) : parseCodeList(String(body.codesText ?? ""));

    const result = await new SubjectAssignService().run(
      {
        collegeId: session.collegeId,
        courseId: body.courseId,
        departmentId: body.departmentId,
        regulation: String(body.regulation ?? ""),
        year: Number(body.year),
        semester: Number(body.semester),
        codes,
        actor: { uid: session.uid, name: session.email },
      },
      body.mode,
    );
    const status = !result.ok ? 422 : body.mode === "commit" && result.counts.toAssign > 0 ? 201 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return subjectErrorResponse(err, "[subject-semester-assignments/assign-by-code]");
  }
}
