export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { cleanLayout } from "@/lib/exams/midMarksEntry";
import { loadTarget, processUpload, requireExamCellMode } from "@/lib/exams/midMarksUploadServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";
import type { UploadRow } from "@/lib/exams/midMarksUploadRows";

// The Exam Cell's Mid marks upload (Exam Cell mode only). The page reads the Excel file and sends:
// POST { planId, subjectId, branch, apply: boolean, layout: { questions: [{ label, max }], paperMax }, rows: [{ rowNo, roll, absent, values: { label: n|null } }] }
// apply false -> each row checked, nothing written; apply true -> refused while any row has a problem, else written.
const MAX_ROWS = 1500;

export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { planId?: unknown; subjectId?: unknown; branch?: unknown; apply?: unknown; layout?: unknown; rows?: unknown };
    const planId = String(body.planId ?? ""), subjectId = String(body.subjectId ?? ""), branch = String(body.branch ?? "");
    if (!planId || !subjectId || !branch) throw new MidMarksError("Select the Mid, subject and branch.");
    const cleaned = cleanLayout(body.layout);
    if ("error" in cleaned) throw new MidMarksError(cleaned.error);
    const rows = Array.isArray(body.rows) ? (body.rows as UploadRow[]) : [];
    if (!rows.length) throw new MidMarksError("The file has no student rows.");
    if (rows.length > MAX_ROWS) throw new MidMarksError(`At most ${MAX_ROWS} students in one file.`);
    const clean: UploadRow[] = rows.map((r) => ({
      rowNo: Number(r?.rowNo) || 0, roll: String(r?.roll ?? "").trim().toUpperCase(), absent: r?.absent === true,
      values: Object.fromEntries(Object.entries(r?.values ?? {}).map(([k, v]) => [k, v == null ? null : Number(v)])),
    }));

    const db = getAdminDb();
    const t = await loadTarget(db, session.collegeId, planId, subjectId, branch);
    await requireExamCellMode(db, session.collegeId, t);
    const actorName = ((await db.collection("colleges").doc(session.collegeId).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    const apply = body.apply === true;
    const result = await processUpload(db, session.collegeId, t, cleaned.layout, clean, apply, { uid: session.uid, name: actorName });
    if (apply) {
      await writeAuditLogSafe(db, session.collegeId, {
        action: "MID_MARKS_UPLOADED", performedBy: session.uid, performedByName: actorName, targetId: `${subjectId}__${branch}__m${t.midNumber}`,
        details: { subject: t.subjectCode, branch, midNumber: t.midNumber, students: clean.length, applied: result.applied, skipped: result.skipped },
      });
    }
    return NextResponse.json({ layout: cleaned.layout, ...result });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/upload POST");
  }
}
