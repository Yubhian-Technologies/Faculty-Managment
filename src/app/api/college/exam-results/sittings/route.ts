export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { batchesCol, recordsCol } from "@/lib/examResults/store";
import type { ExamResultBatch } from "@/types/examResults";

// The published Regular / Supplementary exams of one class - what a
// Supplementary ("Re-sit of") or Revaluation ("Revalue") is picked from.
//   GET ?courseKey&batch&departmentId&year&semester

export async function GET(request: Request) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const q = new URL(request.url).searchParams;
    const courseKey = q.get("courseKey") ?? "";
    const batch = q.get("batch") ?? "";
    const departmentId = q.get("departmentId") ?? "";
    // A sub-department's sheet can be for the whole branch's exam or its own; a branch sheet only the branch's.
    const subDepartmentId = q.get("subDepartmentId") ?? "";
    const year = Number(q.get("year"));
    const semester = Number(q.get("semester"));
    // No branch = every branch: one entry per exam (type + month) across the branch sheets.
    if (!courseKey || !batch || !year || !semester) return NextResponse.json({ sittings: [] });

    const db = getAdminDb();
    const snap = await batchesCol(db, session.collegeId).where("courseKey", "==", courseKey).where("semester", "==", semester).get();
    const exams = snap.docs
      .map((d) => ({ ...(d.data() as ExamResultBatch), id: d.id }))
      .filter((b) => b.status === "PUBLISHED" && b.examType !== "REVALUATION" && b.batch === batch && b.year === year
        && (!departmentId || (b.departmentId === departmentId && (!b.subDepartmentId || b.subDepartmentId === subDepartmentId))));

    const sittings = await Promise.all(exams.map(async (b) => {
      const records = await recordsCol(db, session.collegeId).where("batchId", "==", b.id).get();
      const withBacklogs = records.docs.filter((d) => ((d.get("subjects") ?? []) as { isPass?: boolean }[]).some((s) => s.isPass === false)).length;
      return { id: b.id, title: b.title, examType: b.examType, examHeld: b.examHeld ?? "", students: records.size, withBacklogs };
    }));
    sittings.sort((a, b) => a.examHeld.localeCompare(b.examHeld));
    if (departmentId) return NextResponse.json({ sittings: sittings.map((x) => ({ ...x, ids: [x.id] })) });
    // Every branch: the branch sheets of one exam added together.
    const merged = new Map<string, { id: string; ids: string[]; title: string; examType: string; examHeld: string; students: number; withBacklogs: number; branches: number }>();
    for (const x of sittings) {
      const k = `${x.examType}|${x.examHeld}`;
      const m = merged.get(k) ?? { id: k, ids: [], title: x.title, examType: x.examType, examHeld: x.examHeld, students: 0, withBacklogs: 0, branches: 0 };
      m.ids.push(x.id);
      m.students += x.students;
      m.withBacklogs += x.withBacklogs;
      m.branches++;
      merged.set(k, m);
    }
    return NextResponse.json({ sittings: [...merged.values()] });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/sittings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
