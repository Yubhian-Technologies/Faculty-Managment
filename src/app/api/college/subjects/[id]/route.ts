export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";

// Edits one master subject. Code and Name are locked once the subject is assigned to any semester
// (a renamed subject gets a new code, which makes it a new subject); every other field can change,
// and the change reaches the semester copies and teaching assignments (SubjectMasterService.update).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    const patch = (await readJsonBody(request)) as Record<string, unknown>;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const { cascaded } = await new SubjectMasterService().update({
      collegeId: session.collegeId,
      id,
      patch,
      actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json({ success: true, cascaded });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id] PATCH]");
  }
}

// Deletes a subject nothing refers to. One that is assigned, taught or on a timetable is refused (409).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    await new SubjectMasterService().remove({ collegeId: session.collegeId, id, actor: { uid: session.uid, name: session.email } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id] DELETE]");
  }
}
