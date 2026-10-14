export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireCollegeMember } from "@/lib/auth/verifySession";
import { getAdminDb } from "@/lib/firebase/admin";
import { batchesCol, recordsCol } from "@/lib/examResults/store";
import { applyRevaluations, finalPerSubject, orderSittings, type StudentSitting } from "@/lib/examResults/gpa";
import type { ExamResultBatch, ExamResultRecord, ExamResultSubject } from "@/types/examResults";

// Pre-filled rows for the import template, from one published exam:
//   ?for=SUPPLEMENTARY - every student of that exam with each subject of the
//                        semester they have still not passed (all their
//                        published results, revaluations included)
//   ?for=REVALUATION   - every student and subject of that exam
// Grades are left blank for the Exam Cell to fill in.

type Params = { params: Promise<{ id: string }> };
type Row = { rollNumber: string; name: string; subjectCode: string; subjectName: string };

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireCollegeMember("EXAM_CELL");
    const { id } = await params;
    const purpose = new URL(request.url).searchParams.get("for");
    if (purpose !== "SUPPLEMENTARY" && purpose !== "REVALUATION") return NextResponse.json({ error: "Unknown template" }, { status: 400 });

    const db = getAdminDb();
    const snap = await batchesCol(db, session.collegeId).doc(id).get();
    if (!snap.exists) return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    const exam = snap.data() as ExamResultBatch;
    if (exam.status !== "PUBLISHED") return NextResponse.json({ error: "That exam is not published" }, { status: 400 });

    const records = (await recordsCol(db, session.collegeId).where("batchId", "==", id).get()).docs.map((d) => d.data() as ExamResultRecord);
    const rows: Row[] = [];
    if (purpose === "REVALUATION") {
      for (const r of records) for (const s of r.subjects) rows.push({ rollNumber: r.rollNumber, name: r.name, subjectCode: s.subjectCode, subjectName: s.subjectName });
    } else {
      // Every published sitting of this semester for these students.
      const all = (await recordsCol(db, session.collegeId).where("courseKey", "==", exam.courseKey).where("semester", "==", exam.semester).get())
        .docs.map((d) => d.data() as ExamResultRecord & { createdAt?: { toMillis?: () => number } })
        .filter((r) => r.status === "PUBLISHED");
      for (const r of records) {
        const sittings: StudentSitting[] = all.filter((x) => x.studentId === r.studentId).map((x) => ({
          semester: x.semester, academicYear: x.academicYear, examHeld: x.examHeld, examType: x.examType, batchId: x.batchId,
          ...(x.revaluesBatchId ? { revaluesBatchId: x.revaluesBatchId } : {}), at: x.createdAt?.toMillis?.() ?? 0, subjects: x.subjects,
        }));
        const finals = finalPerSubject(orderSittings(applyRevaluations(sittings)).map((s) => s.subjects as ExamResultSubject[]));
        for (const s of finals) if (!s.isPass) rows.push({ rollNumber: r.rollNumber, name: r.name, subjectCode: s.subjectCode, subjectName: s.subjectName });
      }
    }
    rows.sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "NO_COLLEGE_CONTEXT")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[exam-results/batches/[id]/template GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
