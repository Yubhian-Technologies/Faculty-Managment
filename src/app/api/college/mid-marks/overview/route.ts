export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { courseIdsForKey, teachingFor } from "@/lib/midBank/server";
import { loadMode, openCol, sheetSourceFor } from "@/lib/exams/midMarksEntryServer";
import { loadPlan, planIdFor } from "@/lib/midTimetable/server";
import { MID_MARKS_READERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// Exam Cell > Mid Marks: for a course + year + semester + Mid, every Mid-exam subject per branch (from the
// curriculum + teaching assignments, as the question banks use) with its sections, who enters, and where the
// question columns come from (finalized paper / the Exam Cell's questions / not set).
// GET ?courseKey=&year=&semester=&mid=
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_READERS);
    const q = new URL(request.url).searchParams;
    const courseKey = q.get("courseKey") ?? "";
    const year = Number(q.get("year")), semester = Number(q.get("semester")), mid = Number(q.get("mid"));
    if (!courseKey || !(year > 0) || !(semester > 0) || !(mid > 0)) throw new MidMarksError("Select the course, year, semester and Mid.");
    const db = getAdminDb();
    const [{ ids }, mode] = await Promise.all([courseIdsForKey(db, session.collegeId, courseKey), loadMode(db, session.collegeId, courseKey, mid)]);
    const rows = await teachingFor(db, session.collegeId, { courseIds: ids, year, semester });
    const groups = new Map<string, { subjectId: string; subjectName: string; subjectCode: string; branch: string; sections: { id: string; name: string; facultyName: string }[] }>();
    for (const r of rows) {
      const key = `${r.subjectId}|${r.branch}`;
      const g = groups.get(key) ?? { subjectId: r.subjectId, subjectName: r.subjectName, subjectCode: r.subjectCode, branch: r.branch, sections: [] };
      if (!g.sections.some((s) => s.id === r.sectionId)) g.sections.push({ id: r.sectionId, name: r.sectionName, facultyName: r.facultyName });
      groups.set(key, g);
    }
    const list = [...groups.values()].sort((a, b) => a.branch.localeCompare(b.branch) || a.subjectCode.localeCompare(b.subjectCode));
    const sources = await Promise.all(list.map((g) => sheetSourceFor(db, session.collegeId, g.subjectId, g.branch, year, mid, mode)));
    // Faculty entry per subject: opened by the Exam Cell after that subject's exam (mid-marks/open).
    const planId = planIdFor(courseKey, year, semester, mid);
    const [openSnap, ttSnap, plan] = await Promise.all([
      openCol(db, session.collegeId).where("planId", "==", planId).get(),
      db.collection("colleges").doc(session.collegeId).collection("midTimetables").where("planId", "==", planId).get(),
      loadPlan(db, session.collegeId, planId),
    ]);
    const openBy = new Map(openSnap.docs.map((d) => { const o = d.data() as { subjectId: string; open?: boolean; openedByName?: string }; return [o.subjectId, o]; }));
    const examDay = new Map<string, string>();
    for (const d of ttSnap.docs) {
      for (const sl of ((d.data() as { slots?: { subjectId: string; date: string }[] }).slots ?? [])) {
        if (!examDay.has(sl.subjectId) || sl.date > examDay.get(sl.subjectId)!) examDay.set(sl.subjectId, sl.date);
      }
    }
    const lastDay = [...(plan?.days ?? [])].sort().pop() ?? null;
    return NextResponse.json({
      mode,
      planId,
      rows: list.map((g, i) => ({
        ...g, sections: g.sections.sort((a, b) => a.name.localeCompare(b.name)), ...sources[i],
        entryOpen: openBy.get(g.subjectId)?.open === true,
        examDay: examDay.get(g.subjectId) ?? lastDay,
      })),
    });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/overview GET");
  }
}
