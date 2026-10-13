export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { findOwnStudent } from "@/lib/students/ownContext";
import { passwordChangeRequired, passwordChangeRequiredResponse } from "@/lib/students/passwordGate";
import { batchesCol, loadResultRules, recordsCol } from "@/lib/examResults/store";
import { buildStudentResults, type StudentResultSitting } from "@/lib/examResults/studentResults";
import type { ExamResultBatch, ExamResultRecord } from "@/types/examResults";

// The signed-in student's own semester results - always resolved from
// session.uid, never an id from the client. Only PUBLISHED results of
// PUBLISHED sheets are returned: a draft is the Exam Cell's alone, and a sheet
// whose publish was interrupted part-way is not shown until it completes.

export async function GET() {
  try {
    const session = await requireCollegeMember("STUDENT");
    const db = getAdminDb();
    const own = await findOwnStudent(db, session.collegeId, session.uid);
    if (!own.ok) {
      return NextResponse.json({ error: "Your login is not linked to a student record yet. Please contact your College Office." }, { status: 404 });
    }
    if (passwordChangeRequired(own.student)) return passwordChangeRequiredResponse();

    const [{ rules }, snap] = await Promise.all([
      loadResultRules(db, session.collegeId),
      recordsCol(db, session.collegeId).where("studentId", "==", own.student.id).get(),
    ]);
    const records = snap.docs
      .map((d) => d.data() as ExamResultRecord & { createdAt?: { toMillis?: () => number } })
      .filter((r) => r.status === "PUBLISHED");
    const batchIds = [...new Set(records.map((r) => r.batchId))];
    const batches = batchIds.length
      ? await db.getAll(...batchIds.map((id) => batchesCol(db, session.collegeId).doc(id)))
      : [];
    const published = new Set(batches.filter((b) => b.exists && (b.data() as ExamResultBatch).status === "PUBLISHED").map((b) => b.id));

    const sittings: StudentResultSitting[] = records
      .filter((r) => published.has(r.batchId))
      .map((r) => ({
        semester: r.semester, year: r.year, academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, batchId: r.batchId,
        ...(r.revaluationOf ? { revaluationOf: r.revaluationOf } : {}),
        ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}),
        at: r.createdAt?.toMillis?.() ?? 0, subjects: r.subjects ?? [],
      }));

    return NextResponse.json({
      results: buildStudentResults(sittings, rules),
      rules: { showSgpa: rules.showSgpa, showCgpa: rules.showCgpa },
    });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[student/me/results GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
