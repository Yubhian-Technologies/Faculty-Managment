export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { CURRICULUM_ROLES, subjectErrorResponse } from "@/lib/subjects/http";
import { renameJobsCol, renameProgress, runRenameJob, type RenameJob } from "@/lib/subjects/rename";
import { SubjectRequestError } from "@/lib/subjects/services/SubjectMasterService";

// A subject rename job: GET = where it is; POST = work on it for a while (call again until status DONE).
type Params = { params: Promise<{ jobId: string }> };
const view = (j: RenameJob) => ({ id: j.id, status: j.status, from: j.from, to: j.to, updated: j.updated, progress: renameProgress(j), finishedAt: j.finishedAt ?? null });

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { jobId } = await params;
    const snap = await renameJobsCol(getAdminDb(), session.collegeId).doc(jobId).get();
    if (!snap.exists) throw new SubjectRequestError("Rename not found.", 404);
    return NextResponse.json({ job: view({ ...(snap.data() as Omit<RenameJob, "id">), id: snap.id }) });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/rename-jobs GET]");
  }
}

export async function POST(_request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember(...CURRICULUM_ROLES);
    const { jobId } = await params;
    const job = await runRenameJob(getAdminDb(), session.collegeId, jobId, 25_000).catch((e: unknown) => {
      if (e instanceof Error && e.message === "RENAME_JOB_NOT_FOUND") throw new SubjectRequestError("Rename not found.", 404);
      throw e;
    });
    return NextResponse.json({ job: view(job) });
  } catch (err) {
    return subjectErrorResponse(err, "[subjects/rename-jobs POST]");
  }
}
