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
import { openCol, openDocId, subjectExamDay } from "@/lib/exams/midMarksEntryServer";
import { MID_MARKS_WRITERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// Opens (or closes) the subject faculty's marks entry of ONE subject in a Mid timetable, after that subject's exam:
// not before its exam day (its latest date across the branches' timetables; the Mid's last day when it isn't placed).
// Opening notifies the faculty teaching that subject in the course + year + semester.
// POST { planId, subjectIds: string[], open: boolean }  (one subject, or several at once)
export async function POST(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_WRITERS);
    const body = (await readJsonBody(request)) as { planId?: unknown; subjectIds?: unknown; open?: unknown };
    const planId = String(body.planId ?? "");
    const subjectIds = Array.isArray(body.subjectIds) ? [...new Set(body.subjectIds.map(String).filter(Boolean))] : [];
    const open = body.open === true;
    if (!planId || subjectIds.length === 0) throw new MidMarksError("Select the Mid and the subject.");
    const db = getAdminDb();
    const c = session.collegeId;
    const plan = await loadPlan(db, c, planId);
    if (!plan) throw new MidMarksError("Mid timetable not found. It may have been deleted.", 404);
    const today = istDateKey(new Date());
    const days = await Promise.all(subjectIds.map((sid) => subjectExamDay(db, c, plan, sid)));
    if (open) {
      const early = subjectIds.map((sid, i) => ({ sid, day: days[i] })).filter((x) => x.day && today < x.day);
      if (early.length === subjectIds.length) {
        throw new MidMarksError(`The exam is on ${early[0].day} - marks entry can be opened from that day.`, 409);
      }
      // Several at once: only those whose exam is over are opened.
      for (const e of early) subjectIds.splice(subjectIds.indexOf(e.sid), 1);
    }
    const actorName = ((await db.collection("colleges").doc(c).collection("users").doc(session.uid).get()).data() as { name?: string } | undefined)?.name ?? "";
    const now = new Date();
    const batch = db.batch();
    for (const sid of subjectIds) {
      batch.set(openCol(db, c).doc(openDocId(planId, sid)), {
        planId, courseKey: plan.courseKey, courseName: plan.courseName, year: plan.year, semester: plan.semester, midNumber: plan.midNumber,
        subjectId: sid, open, ...(open ? { openedAt: now, openedByName: actorName } : { closedAt: now, closedByName: actorName }), updatedAt: now,
      }, { merge: true });
    }
    await batch.commit();
    await writeAuditLogSafe(db, c, {
      action: open ? "MID_MARKS_ENTRY_OPENED" : "MID_MARKS_ENTRY_CLOSED", performedBy: session.uid, performedByName: actorName, targetId: planId,
      details: { course: plan.courseName, year: plan.year, semester: plan.semester, midNumber: plan.midNumber, subjectIds },
    });
    let notified = 0;
    if (open) {
      const { ids } = await courseIdsForKey(db, c, plan.courseKey);
      const rows = (await teachingFor(db, c, { courseIds: ids, year: plan.year, semester: plan.semester })).filter((r) => subjectIds.includes(r.subjectId));
      const byFaculty = new Map<string, Set<string>>();
      for (const r of rows) byFaculty.set(r.facultyId, (byFaculty.get(r.facultyId) ?? new Set()).add(`${r.subjectCode || r.subjectName}`));
      for (const [fid, subjects] of byFaculty) {
        const uid = await resolveLoginUidForFacultyMember(db, c, fid);
        if (!uid || uid === fid) continue;
        await notify(db, c, uid, "MID_MARKS_ENTRY_OPENED", `Mid-${plan.midNumber} marks entry is open`,
          `Enter the Mid-${plan.midNumber} marks of ${[...subjects].join(", ")} question-wise on Internal Marks.`, "/panel/internal-exam");
        notified++;
      }
    }
    return NextResponse.json({ open, opened: subjectIds, notified });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/open POST");
  }
}
