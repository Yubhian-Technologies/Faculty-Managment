export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import type { InternalExamMarksBatch } from "@/types";
import { loadLayout, loadMode } from "@/lib/exams/midMarksEntryServer";
import { loadTarget, midComponent } from "@/lib/exams/midMarksUploadServer";
import { resolveExamConfigForBatch } from "@/lib/exams/internalExamMarks";
import { MID_MARKS_READERS, MidMarksError, midMarksErrorResponse } from "@/lib/exams/midMarksRoutes";

// One subject + branch of a Mid: who enters, the questions (layout), and per section its students with what is
// saved - for the Exam Cell's template download and status. Writes nothing.
// GET ?planId=&subjectId=&branch=
export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember(...MID_MARKS_READERS);
    const q = new URL(request.url).searchParams;
    const planId = q.get("planId") ?? "", subjectId = q.get("subjectId") ?? "", branch = q.get("branch") ?? "";
    if (!planId || !subjectId || !branch) throw new MidMarksError("Select the Mid, subject and branch.");
    const db = getAdminDb();
    const c = session.collegeId;
    const t = await loadTarget(db, c, planId, subjectId, branch);
    const [mode, layout] = await Promise.all([loadMode(db, c, t.courseKey, t.midNumber), loadLayout(db, c, subjectId, branch, t.midNumber)]);
    const col = db.collection("colleges").doc(c).collection("internalExamMarks");
    const sections = await Promise.all(t.sections.map(async (s) => {
      const snap = await col.doc(s.assignmentId).get();
      if (!snap.exists) return { name: s.sectionName, faculty: s.facultyName, status: "NOT_STARTED", locked: false, entered: 0, students: [] as unknown[] };
      const b = { ...(snap.data() as InternalExamMarksBatch & { examCellLocks?: Record<string, unknown> }), id: snap.id };
      const resolved = await resolveExamConfigForBatch(db, db.collection("colleges").doc(c), b);
      const comp = resolved ? midComponent(resolved.config, t.midNumber) : null;
      return {
        name: s.sectionName, faculty: s.facultyName, status: b.status, locked: !!(comp && b.examCellLocks?.[comp.id]),
        entered: comp ? b.entries.filter((e) => e.componentMarks?.[comp.id] != null).length : 0,
        students: b.entries.map((e) => ({
          roll: e.rollNumber, name: e.name, absent: !!(comp && e.absentIn?.[comp.id]),
          values: comp ? e.questionMarks?.[comp.id] ?? {} : {},
        })),
        total: b.entries.length,
      };
    }));
    return NextResponse.json({ target: { ...t, sections: undefined }, mode, layout, sections });
  } catch (err) {
    return midMarksErrorResponse(err, "mid-marks/sheet GET");
  }
}
