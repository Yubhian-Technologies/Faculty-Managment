import { describe, expect, it } from "vitest";
import { finalSubjectsOfSemester, type PublishedSitting } from "./studentSittings";
import type { ExamResultSubject } from "@/types/examResults";

const sub = (code: string, grade: string, isPass: boolean, points: number): ExamResultSubject =>
  ({ subjectId: code, subjectCode: code, subjectName: code, credits: 3, grade, points, isPass } as ExamResultSubject);

const sitting = (o: Partial<PublishedSitting> & Pick<PublishedSitting, "batchId" | "examType" | "subjects">): PublishedSitting => ({
  semester: 1, year: 1, academicYear: "2024-25", regulation: "R23", at: 1, ...o,
});

describe("finalSubjectsOfSemester - the same answer the student's own page gives", () => {
  it("a revaluation that turns a fail into a pass counts (best of two)", () => {
    const final = finalSubjectsOfSemester([
      sitting({ batchId: "reg", examType: "REGULAR", examHeld: "2025-05", subjects: [sub("A1", "F", false, 0)] }),
      sitting({ batchId: "rev", examType: "REVALUATION", revaluesBatchId: "reg", examHeld: "2025-07", subjects: [sub("A1", "C", true, 5)] }),
    ], 1);
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ grade: "C", isPass: true });
  });

  it("a revaluation that lowers the grade does not replace the original", () => {
    const final = finalSubjectsOfSemester([
      sitting({ batchId: "reg", examType: "REGULAR", examHeld: "2025-05", subjects: [sub("A1", "B", true, 7)] }),
      sitting({ batchId: "rev", examType: "REVALUATION", revaluesBatchId: "reg", examHeld: "2025-07", subjects: [sub("A1", "D", true, 4)] }),
    ], 1);
    expect(final[0]).toMatchObject({ grade: "B", points: 7 });
  });

  it("a pass is not undone by a later failed supplementary", () => {
    const final = finalSubjectsOfSemester([
      sitting({ batchId: "reg", examType: "REGULAR", examHeld: "2025-05", subjects: [sub("A1", "F", false, 0)] }),
      sitting({ batchId: "rev", examType: "REVALUATION", revaluesBatchId: "reg", examHeld: "2025-07", subjects: [sub("A1", "C", true, 5)] }),
      sitting({ batchId: "sup", examType: "SUPPLEMENTARY", examHeld: "2025-12", subjects: [sub("A1", "F", false, 0)] }),
    ], 1);
    expect(final[0]).toMatchObject({ grade: "C", isPass: true });
  });

  it("only the asked semester's subjects", () => {
    const final = finalSubjectsOfSemester([
      sitting({ batchId: "s1", examType: "REGULAR", semester: 1, subjects: [sub("A1", "A", true, 9)] }),
      sitting({ batchId: "s2", examType: "REGULAR", semester: 2, subjects: [sub("B1", "B", true, 8)] }),
    ], 2);
    expect(final.map((s) => s.subjectCode)).toEqual(["B1"]);
  });
});
