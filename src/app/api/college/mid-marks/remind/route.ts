export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { loadMidSettings } from "@/lib/exams/midSettings";
import { loadPlan } from "@/lib/midTimetable/server";
import { courseIdsForKey, teachingFor } from "@/lib/midBank/server";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { loadMode, midProgress, openCol } from "@/lib/exams/midMarksEntryServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// "Remind Pending Faculty" (subject faculty mode): one notification to each faculty member with a section whose
// subject is open for entry and whose Mid marks are not complete or not submitted yet.
// POST { planId }
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { planId?: unknown };
    const planId = String(body.planId ?? "");
    if (!planId) throw new MidMarksError("Select a Mid.");
    const db = getAdminDb();
    const page = (await loadMidSettings(db, session.collegeId)).midMarksPage;
    const c = session.collegeId;
    const plan = await loadPlan(db, c, planId);
    if (!plan) throw new MidMarksError("Mid timetable not found. It may have been deleted.", 404);
    if ((await loadMode(db, c, plan.courseKey, plan.midNumber)) !== "FACULTY") throw new MidMarksError("The Exam Cell enters this Mid's marks - there is nobody to remind.", 409);
    const openSnap = await openCol(db, c).where("planId", "==", planId).get();
    const openSubjects = new Set(openSnap.docs.map((d) => d.data() as { subjectId: string; open?: boolean }).filter((o) => o.open).map((o) => o.subjectId));
    if (!openSubjects.size) throw new MidMarksError("No subject of this Mid is open for marks entry yet.", 409);
    const { ids } = await courseIdsForKey(db, c, plan.courseKey);
    const rows = (await teachingFor(db, c, { courseIds: ids, year: plan.year, semester: plan.semester })).filter((r) => openSubjects.has(r.subjectId));
    const progress = await midProgress(db, c, plan.midNumber, rows);
    const pending = new Map<string, string[]>();
    for (const r of rows) {
      const p = progress.get(`${r.subjectId}|${r.branch}`)?.find((x) => x.sectionId === r.sectionId && x.facultyId === r.facultyId);
      if (p && (p.status === "SUBMITTED" || p.status === "FROZEN")) continue; // pending = not submitted yet (not started, or a draft)
      pending.set(r.facultyId, [...(pending.get(r.facultyId) ?? []), `${r.subjectCode || r.subjectName} ${r.sectionName}${p ? ` (${p.entered}/${p.total})` : ""}`]);
    }
    let notified = 0;
    for (const [fid, items] of pending) {
      const uid = await resolveLoginUidForFacultyMember(db, c, fid);
      if (!uid || uid === fid) continue;
      await notify(db, c, uid, "MID_MARKS_REMINDER", `Mid-${plan.midNumber} marks pending`,
        `Enter and submit the Mid-${plan.midNumber} marks of: ${items.join("; ")}.`, page ? "/panel/mid-marks" : "/panel/internal-exam");
      notified++;
    }
    const actorName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    await writeAuditLogSafe(db, c, {
      action: "MID_MARKS_REMINDED", performedBy: session.uid, performedByName: actorName, targetId: planId,
      details: { midNumber: plan.midNumber, notified },
    });
    return NextResponse.json({ notified });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/remind POST");
  }
}
