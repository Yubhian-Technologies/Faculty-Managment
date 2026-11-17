export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { writeAuditLogSafe } from "@/lib/audit/safeAuditLog";
import { notify } from "@/lib/notify";
import { istDateKey } from "@/lib/attendance/istTime";
import { loadPlan } from "@/lib/midTimetable/server";
import { courseIdsForKey, teachingFor } from "@/lib/midBank/server";
import { resolveLoginUidForFacultyMember } from "@/lib/faculty/resolveFacultyMemberId";
import { openCol } from "@/lib/exams/midMarksEntryServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// Opens (or closes) the subject faculty's marks entry of a Mid timetable (course + year + semester + Mid), after the
// exam: not before the Mid's last exam day. Opening notifies everyone teaching a Mid subject of it.
// POST { planId, open: boolean }
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { planId?: unknown; open?: unknown };
    const planId = String(body.planId ?? "");
    const open = body.open === true;
    if (!planId) throw new MidMarksError("Select a Mid.");
    const db = getAdminDb();
    const c = session.collegeId;
    const plan = await loadPlan(db, c, planId);
    if (!plan) throw new MidMarksError("Mid timetable not found. It may have been deleted.", 404);
    const lastDay = [...(plan.days ?? [])].sort().pop() ?? null;
    if (open && lastDay && istDateKey(new Date()) < lastDay) {
      throw new MidMarksError(`Mid-${plan.midNumber} exams run until ${lastDay} - marks entry can be opened from that day.`, 409);
    }
    const actorName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    const now = new Date();
    await openCol(db, c).doc(planId).set({
      courseKey: plan.courseKey, courseName: plan.courseName, year: plan.year, semester: plan.semester, midNumber: plan.midNumber,
      open, ...(open ? { openedAt: now, openedByName: actorName } : { closedAt: now, closedByName: actorName }), updatedAt: now,
    }, { merge: true });
    await writeAuditLogSafe(db, c, {
      action: open ? "MID_MARKS_ENTRY_OPENED" : "MID_MARKS_ENTRY_CLOSED", performedBy: session.uid, performedByName: actorName, targetId: planId,
      details: { course: plan.courseName, year: plan.year, semester: plan.semester, midNumber: plan.midNumber },
    });
    let notified = 0;
    if (open) {
      const { ids } = await courseIdsForKey(db, c, plan.courseKey);
      const rows = await teachingFor(db, c, { courseIds: ids, year: plan.year, semester: plan.semester });
      for (const fid of new Set(rows.map((r) => r.facultyId))) {
        const uid = await resolveLoginUidForFacultyMember(db, c, fid);
        if (!uid || uid === fid) continue;
        await notify(db, c, uid, "MID_MARKS_ENTRY_OPENED", `Mid-${plan.midNumber} marks entry is open`,
          `Enter the Mid-${plan.midNumber} marks of ${plan.courseName} (year ${plan.year}, semester ${plan.semester}) question-wise on Internal Marks.`, "/panel/internal-exam");
        notified++;
      }
    }
    return NextResponse.json({ open, notified });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/open POST");
  }
}
