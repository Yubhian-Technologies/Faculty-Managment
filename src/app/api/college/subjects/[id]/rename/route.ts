export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { SubjectMasterService } from "@/lib/subjects/services/SubjectMasterService";

// Rename a subject that is already in use: { name, code, preview? }. Preview counts what would change; otherwise the
// subject is renamed and a job is started that updates every copy (run it with rename-jobs/[jobId]).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { id } = await params;
    const body = (await readJsonBody(request)) as { name?: unknown; code?: unknown; preview?: unknown };
    const r = await new SubjectMasterService().beginRename({
      collegeId: session.collegeId, id, name: String(body.name ?? ""), code: String(body.code ?? ""), preview: body.preview === true,
      actor: { uid: session.uid, name: session.email },
    });
    return NextResponse.json(r);
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/[id]/rename POST]");
  }
}
