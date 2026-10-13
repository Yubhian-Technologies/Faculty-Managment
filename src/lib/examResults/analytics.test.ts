import { describe, expect, it } from "vitest";
import { buildResultsAnalytics, type AnalyticsRecord } from "./analytics";
import type { ExamResultSubject } from "@/types/examResults";
import { STARTER_GRADE_TABLE } from "./rules";

const P: Record<string, number> = { S: 10, A: 9, B: 8, C: 7, D: 6, E: 5, F: 0 };
const g = (code: string, credits: number, grade: string): ExamResultSubject =>
  ({ subjectId: code, subjectCode: code, subjectName: `${code} name`, credits, grade, points: P[grade], isPass: grade !== "F" });
const rec = (studentId: string, branch: string, examType: AnalyticsRecord["examType"], subjects: ExamResultSubject[], over: Partial<AnalyticsRecord> = {}): AnalyticsRecord => ({
  batchId: `${examType}-${branch}`, studentId, rollNumber: studentId.toUpperCase(), name: `Student ${studentId}`, semester: 3,
  academicYear: "2025-26", examHeld: examType === "REGULAR" ? "2025-11" : "2026-05", examType, branch, at: examType === "REGULAR" ? 1 : 2, subjects, ...over,
});
const strict = { showSgpa: "ALL_PASSED" as const, showCgpa: "ALL_PASSED" as const, decimals: 2 };

// Four students in two branches; one fails a subject and clears it in the supplementary,
// one fails and has not cleared it yet.
const records = [
  rec("s1", "CSE", "REGULAR", [g("MA", 3, "S"), g("PH", 3, "A")]),                // 9.5
  rec("s2", "CSE", "REGULAR", [g("MA", 3, "B"), g("PH", 3, "F")]),                // fail PH...
  rec("s2", "CSE", "SUPPLEMENTARY", [g("PH", 3, "C")]),                           // ...cleared: (24 + 21) / 6 = 7.5
  rec("s3", "ECE", "REGULAR", [g("MA", 3, "F"), g("PH", 3, "D")]),                // backlog MA
  rec("s4", "ECE", "REGULAR", [g("MA", 3, "A"), g("PH", 3, "A")]),                // 9
];

describe("buildResultsAnalytics", () => {
  const a = buildResultsAnalytics(records, strict, STARTER_GRADE_TABLE, 3);

  it("counts appeared, Regular pass and pass now (after the supplementary)", () => {
    expect(a).toMatchObject({ appeared: 4, passedRegular: 2, passedNow: 3, studentsWithBacklogs: 1, backlogSubjects: 1 });
  });

  it("averages only SGPAs the rules show, and finds the highest", () => {
    expect(a).toMatchObject({ withSgpa: 3, averageSgpa: 8.67, highestSgpa: 9.5 }); // (9.5 + 7.5 + 9) / 3
    expect(a.toppers.map((t) => [t.rollNumber, t.sgpa])).toEqual([["S1", 9.5], ["S4", 9], ["S2", 7.5]]);
  });

  it("subject-wise: Regular vs now, final grades and average points", () => {
    const ph = a.subjects.find((s) => s.subjectCode === "PH")!;
    expect(ph).toMatchObject({ appeared: 4, passedRegular: 3, passedNow: 4, grades: { A: 2, C: 1, D: 1 }, averagePoints: 7.75 });
    const ma = a.subjects.find((s) => s.subjectCode === "MA")!;
    expect(ma).toMatchObject({ passedRegular: 3, passedNow: 3, grades: { S: 1, B: 1, F: 1, A: 1 } });
  });

  it("grade distribution in grade-table order, fails marked", () => {
    expect(a.grades).toEqual([
      { grade: "S", count: 1, isPass: true }, { grade: "A", count: 3, isPass: true }, { grade: "B", count: 1, isPass: true },
      { grade: "C", count: 1, isPass: true }, { grade: "D", count: 1, isPass: true }, { grade: "F", count: 1, isPass: false },
    ]);
  });

  it("SGPA bands, with the withheld ones counted apart", () => {
    expect(a.sgpaBands).toEqual([
      { label: "9 - 10", count: 2 }, { label: "8 - 9", count: 0 }, { label: "7 - 8", count: 1 },
      { label: "6 - 7", count: 0 }, { label: "Below 6", count: 0 }, { label: "Withheld", count: 1 },
    ]);
  });

  it("branch comparison by the sheet's branch", () => {
    expect(a.branches).toEqual([
      { branch: "CSE", appeared: 2, passedRegular: 1, passedNow: 2, averageSgpa: 8.5 },
      { branch: "ECE", appeared: 2, passedRegular: 1, passedNow: 1, averageSgpa: 9 },
    ]);
  });

  it("lists backlog students with their subjects", () => {
    expect(a.backlogStudents).toEqual([{ studentId: "s3", rollNumber: "S3", name: "Student s3", branch: "ECE", sgpa: null, backlogs: [{ subjectCode: "MA", subjectName: "MA name" }] }]);
  });

  it("a revaluation that clears a fail counts as passed now, not in the Regular", () => {
    const rv = rec("s3", "ECE", "REVALUATION", [g("MA", 3, "C")], { revaluesBatchId: "REGULAR-ECE", examHeld: "2025-11", at: 3 });
    const b = buildResultsAnalytics([...records, rv], strict, STARTER_GRADE_TABLE, 3);
    expect(b).toMatchObject({ passedRegular: 2, passedNow: 4, studentsWithBacklogs: 0 });
  });

  it("is empty with no records", () => {
    expect(buildResultsAnalytics([], strict)).toMatchObject({ appeared: 0, averageSgpa: null, highestSgpa: null, subjects: [], branches: [] });
  });
});
