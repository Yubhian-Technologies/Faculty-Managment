import type { Firestore } from "firebase-admin/firestore";
import type { ExamResultBatch, ExamResultRecord, ExamResultSubject } from "@/types/examResults";
import { applyRevaluations, finalPerSubject, orderSittings, type StudentSitting } from "./gpa";
import { batchesCol, recordsCol } from "./store";
import type { StudentResultSitting } from "./studentResults";

// One student's PUBLISHED sittings, loaded one way for everyone who shows them (the student's own
// Results page, the mentor's view, the Mentoring Record), so all of them work out the same SGPA,
// CGPA and backlogs. Only records of a PUBLISHED sheet count: a sheet whose publish was interrupted
// part-way is not shown until it completes, and a draft is the Exam Cell's alone.

export interface PublishedSitting extends StudentResultSitting {
  regulation: string;
}

export async function loadPublishedSittings(db: Firestore, collegeId: string, studentId: string): Promise<PublishedSitting[]> {
  const snap = await recordsCol(db, collegeId).where("studentId", "==", studentId).get();
  const records = snap.docs
    .map((d) => d.data() as ExamResultRecord & { createdAt?: { toMillis?: () => number } })
    .filter((r) => r.status === "PUBLISHED");
  const batchIds = [...new Set(records.map((r) => r.batchId))];
  const batches = batchIds.length ? await db.getAll(...batchIds.map((id) => batchesCol(db, collegeId).doc(id))) : [];
  const published = new Set(batches.filter((b) => b.exists && (b.data() as ExamResultBatch).status === "PUBLISHED").map((b) => b.id));
  return records
    .filter((r) => published.has(r.batchId))
    .map((r) => ({
      semester: r.semester, year: r.year, academicYear: r.academicYear, examHeld: r.examHeld, examType: r.examType, batchId: r.batchId,
      ...(r.revaluationOf ? { revaluationOf: r.revaluationOf } : {}),
      ...(r.revaluesBatchId ? { revaluesBatchId: r.revaluesBatchId } : {}),
      regulation: r.regulation ?? "",
      at: r.createdAt?.toMillis?.() ?? 0,
      subjects: r.subjects ?? [],
    }));
}

/** The engine's view of a sitting (what studentStanding / applyRevaluations read). */
export function asGpaSitting(s: StudentResultSitting): StudentSitting {
  return {
    semester: s.semester, academicYear: s.academicYear, examHeld: s.examHeld, examType: s.examType, batchId: s.batchId,
    ...(s.revaluesBatchId ? { revaluesBatchId: s.revaluesBatchId } : {}), at: s.at, subjects: s.subjects,
  };
}

/**
 * Each subject's FINAL result in one semester: a revaluation counts only when better than the grade
 * it re-grades, and the latest passing attempt wins over a later fail (gpa.ts). The same answer the
 * student's own page gives.
 */
export function finalSubjectsOfSemester(sittings: StudentResultSitting[], semester: number): ExamResultSubject[] {
  const resolved = applyRevaluations(orderSittings(sittings).map(asGpaSitting)).filter((s) => s.semester === semester);
  return finalPerSubject(orderSittings(resolved).map((s) => s.subjects as ExamResultSubject[]));
}
