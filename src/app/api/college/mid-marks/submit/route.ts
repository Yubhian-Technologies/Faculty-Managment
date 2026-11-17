export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { loadTarget, requireExamCellMode, submitSections } from "@/lib/exams/midMarksUploadServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// "Submit All Sections": locks this Mid's marks of every section of the subject + branch (Exam Cell mode). A
// section with a student still without marks is left open and listed.
// POST { planId, subjectId, branch }
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { planId?: unknown; subjectId?: unknown; branch?: unknown };
    const planId = String(body.planId ?? ""), subjectId = String(body.subjectId ?? ""), branch = String(body.branch ?? "");
    if (!planId || !subjectId || !branch) throw new MidMarksError("Select the Mid, subject and branch.");
    const db = getAdminDb();
    const t = await loadTarget(db, session.collegeId, planId, subjectId, branch);
    await requireExamCellMode(db, session.collegeId, t);
    const actorName = ((await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    const result = await submitSections(db, session.collegeId, t, { name: actorName });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "MID_MARKS_SUBMITTED", performedBy: session.uid, performedByName: actorName, targetId: `${subjectId}__${branch}__m${t.midNumber}`,
      details: { subject: t.subjectCode, branch, midNumber: t.midNumber, ...result },
    });
    return NextResponse.json(result);
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/submit POST");
  }
}
