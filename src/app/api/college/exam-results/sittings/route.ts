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
    const year = Number(q.get("year"));
    const semester = Number(q.get("semester"));
    if (!courseKey || !batch || !departmentId || !year || !semester) return NextResponse.json({ sittings: [] });

    const db = getAdminDb();
    const snap = await batchesCol(db, session.collegeId).where("courseKey", "==", courseKey).where("semester", "==", semester).get();
    const exams = snap.docs
      .map((d) => ({ ...(d.data() as ExamResultBatch), id: d.id }))
      .filter((b) => b.status === "PUBLISHED" && b.examType !== "REVALUATION" && b.batch === batch && b.departmentId === departmentId && b.year === year);

    const sittings = await Promise.all(exams.map(async (b) => {
      const records = await recordsCol(db, session.collegeId).where("batchId", "==", b.id).get();
      const withBacklogs = records.docs.filter((d) => ((d.get("subjects") ?? []) as { isPass?: boolean }[]).some((s) => s.isPass === false)).length;
      return { id: b.id, title: b.title, examType: b.examType, examHeld: b.examHeld ?? "", students: records.size, withBacklogs };
    }));
    sittings.sort((a, b) => a.examHeld.localeCompare(b.examHeld));
    return NextResponse.json({ sittings });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/sittings GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
