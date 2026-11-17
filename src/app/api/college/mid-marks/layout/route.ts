export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanLayout } from "@/lib/exams/midMarksEntry";
import { layoutDocId, layoutsCol, subjectMidMarksExist } from "@/lib/exams/midMarksEntryServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// The questions + max marks of a Mid for a subject + branch, set by the Exam Cell (lib/exams/midMarksEntry.ts) -
// used where no paper is finalized in the app (faculty entry), and always in Exam Cell mode.
// PUT { subjectId, subjectName, branch, midNumber, questions: [{ label, max }], paperMax }
// Refused once marks of that Mid exist for the subject in that branch (the columns would shift under them).
export async function PUT(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { subjectId?: unknown; subjectName?: unknown; branch?: unknown; midNumber?: unknown; questions?: unknown; paperMax?: unknown };
    const subjectId = typeof body.subjectId === "string" ? body.subjectId : "";
    const branch = typeof body.branch === "string" ? body.branch : "";
    const mid = Number(body.midNumber);
    if (!subjectId || !branch || !(mid > 0)) throw new MidMarksError("Select the subject, branch and Mid.");
    const cleaned = cleanLayout(body);
    if ("error" in cleaned) throw new MidMarksError(cleaned.error);
    const db = getAdminDb();
    if (await subjectMidMarksExist(db, session.collegeId, subjectId, branch, mid)) {
      throw new MidMarksError(`Marks of Mid-${mid} are already entered for this subject in ${branch}, so its questions can't change now.`, 409);
    }
    const actor = (await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined;
    const id = layoutDocId(subjectId, branch, mid);
    await layoutsCol(db, session.collegeId).doc(id).set({
      subjectId, subjectName: typeof body.subjectName === "string" ? body.subjectName : "", branch, midNumber: mid,
      ...cleaned.layout, updatedAt: new Date(), updatedBy: session.uid, updatedByName: actor?.name ?? "",
    });
    await writeAuditLogSafe(db, session.collegeId, {
      action: "MID_MARKS_LAYOUT_SET", performedBy: session.uid, performedByName: actor?.name, targetId: id,
      details: { subjectId, branch, midNumber: mid, questions: cleaned.layout.questions.length, paperMax: cleaned.layout.paperMax },
    });
    return NextResponse.json({ layout: cleaned.layout });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/layout PUT");
  }
}
