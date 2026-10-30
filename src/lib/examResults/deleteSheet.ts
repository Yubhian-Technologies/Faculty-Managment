import type { ExamResultBatch, ExamResultRecord } from "@/types/examResults";

// Deleting a PUBLISHED results sheet (pure part). A later sitting may rest on
// it - a Revaluation of it, or a Supplementary of the same semester held in
// the same month or after (it re-sat subjects this sheet failed) - and
// deleting it would leave that sitting without the exam it built on. Such a
// sheet must be deleted first.

type Rec = Pick<ExamResultRecord, "batchId" | "studentId" | "courseKey" | "semester" | "examType" | "examHeld" | "revaluesBatchId">;

/** The other sheets (batch ids) that rest on this one for at least one of its students. */
export function dependentSheets(sheet: Pick<ExamResultBatch, "id" | "examType" | "examHeld">, own: Rec[], others: Rec[]): string[] {
  const mine = new Map(own.map((r) => [r.studentId, r]));
  const out = new Set<string>();
  for (const r of others) {
    if (r.batchId === sheet.id) continue;
    const m = mine.get(r.studentId);
    if (!m || r.courseKey !== m.courseKey || r.semester !== m.semester) continue;
    if (r.revaluesBatchId === sheet.id) out.add(r.batchId);
    else if (sheet.examType !== "REVALUATION" && r.examType === "SUPPLEMENTARY" && (r.examHeld ?? "") >= (sheet.examHeld ?? "")) out.add(r.batchId);
  }
  return [...out];
}
