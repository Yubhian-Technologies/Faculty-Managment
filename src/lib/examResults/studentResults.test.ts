import { describe, expect, it } from "vitest";
import { buildStudentResults, type StudentResultSitting } from "./studentResults";
import type { ExamResultSubject } from "@/types/examResults";

const sub = (subjectCode: string, credits: number, grade: string, points: number, isPass = true): ExamResultSubject =>
  ({ subjectId: subjectCode, subjectCode, subjectName: `${subjectCode} name`, credits, grade, points: isPass ? points : 0, isPass });
const strict = { showSgpa: "ALL_PASSED" as const, showCgpa: "ALL_PASSED" as const, decimals: 2 };

// The IT student from the first real test: Semester 3, one theory subject failed.
const regular: StudentResultSitting = {
  semester: 3, year: 2, academicYear: "2026-27", examType: "REGULAR", batchId: "reg", at: 1,
  subjects: [sub("23CS3T01", 3, "F", 0, false), sub("23CS3T02", 3, "S", 10), sub("23CS3P01", 1.5, "S", 10)],
};
const supply: StudentResultSitting = { semester: 3, year: 2, academicYear: "2026-27", examType: "SUPPLEMENTARY", batchId: "sup", at: 2, subjects: [sub("23CS3T01", 3, "A", 9)] };

describe("buildStudentResults", () => {
  it("strict college, before the supplementary: SGPA and CGPA withheld, the backlog listed", () => {
    const v = buildStudentResults([regular], strict);
    expect(v.semesters[0]).toMatchObject({ semester: 3, year: 2, sgpa: null, sgpaWithheld: true, cgpa: null, cgpaWithheld: true, credits: 7.5, backlogs: ["23CS3T01"] });
    expect(v).toMatchObject({ cgpa: null, cgpaWithheld: true, creditsEarned: 4.5 });
    expect(v.backlogs).toEqual([{ semester: 3, subjectCode: "23CS3T01", subjectName: "23CS3T01 name" }]);
  });

  it("after passing the supplementary: the new grade counts, both attempts are kept, SGPA and CGPA appear", () => {
    const v = buildStudentResults([supply, regular], strict);
    const s = v.semesters[0];
    expect(s.subjects.map((x) => [x.subjectCode, x.grade])).toEqual([["23CS3T01", "A"], ["23CS3T02", "S"], ["23CS3P01", "S"]]);
    expect(s.subjects[0].attempts).toEqual([
      { academicYear: "2026-27", examType: "REGULAR", grade: "F", isPass: false },
      { academicYear: "2026-27", examType: "SUPPLEMENTARY", grade: "A", isPass: true },
    ]);
    expect(s).toMatchObject({ sgpa: 9.6, cgpa: 9.6, backlogs: [] }); // (27 + 30 + 15) / 7.5
    expect(v).toMatchObject({ cgpa: 9.6, creditsEarned: 7.5, backlogs: [] });
  });

  it("always-calculate college: figures shown with the fail counted as 0", () => {
    const v = buildStudentResults([regular], { ...strict, showSgpa: "ALWAYS", showCgpa: "ALWAYS" });
    expect(v.semesters[0]).toMatchObject({ sgpa: 6, cgpa: 6 }); // 45 / 7.5
  });

  it("CGPA runs up to each semester, and the overall one is the latest", () => {
    const sem4: StudentResultSitting = { semester: 4, year: 2, academicYear: "2026-27", examType: "REGULAR", batchId: "reg4", at: 3, subjects: [sub("23CS4T01", 3, "B", 8)] };
    const v = buildStudentResults([regular, supply, sem4], strict);
    expect(v.semesters.map((s) => [s.semester, s.sgpa, s.cgpa])).toEqual([[3, 9.6, 9.6], [4, 8, 9.14]]); // (72 + 24) / 10.5
    expect(v.cgpa).toBe(9.14);
  });

  it("revaluation of the Regular: a better grade counts and shows in the history; a lower one is kept as history only", () => {
    const reval: StudentResultSitting = {
      semester: 3, year: 2, academicYear: "2026-27", examType: "REVALUATION", revaluationOf: "REGULAR", batchId: "rv", revaluesBatchId: "reg", at: 5,
      subjects: [sub("23CS3T01", 3, "C", 7), sub("23CS3T02", 3, "A", 9)],
    };
    const v = buildStudentResults([regular, reval], strict);
    const s = v.semesters[0];
    expect(s.subjects.map((x) => [x.subjectCode, x.grade, x.isPass])).toEqual([["23CS3T01", "C", true], ["23CS3T02", "S", true], ["23CS3P01", "S", true]]);
    expect(s.subjects[0].attempts).toEqual([
      { academicYear: "2026-27", examType: "REGULAR", grade: "F", isPass: false },
      { academicYear: "2026-27", examType: "REVALUATION", revaluationOf: "REGULAR", improved: true, grade: "C", isPass: true },
    ]);
    expect(s.subjects[1].attempts[1]).toMatchObject({ examType: "REVALUATION", improved: false, grade: "A" });
    expect(s).toMatchObject({ sgpa: 8.8, backlogs: [] }); // (21 + 30 + 15) / 7.5
  });

  it("revaluation of the Supplementary improves the supplementary grade", () => {
    const rv: StudentResultSitting = {
      semester: 3, year: 2, academicYear: "2026-27", examType: "REVALUATION", revaluationOf: "SUPPLEMENTARY", batchId: "rv2", revaluesBatchId: "sup", at: 6,
      subjects: [sub("23CS3T01", 3, "S", 10)],
    };
    const s = buildStudentResults([regular, supply, rv], strict).semesters[0];
    expect(s.subjects[0]).toMatchObject({ grade: "S", isPass: true });
    expect(s.subjects[0].attempts.map((a) => [a.examType, a.grade])).toEqual([["REGULAR", "F"], ["SUPPLEMENTARY", "A"], ["REVALUATION", "S"]]);
    expect(s.sgpa).toBe(10);
  });

  it("has nothing to show with no results", () => {
    expect(buildStudentResults([], strict)).toEqual({ semesters: [], cgpa: null, cgpaWithheld: false, creditsEarned: 0, backlogs: [], decimals: 2 });
  });
});
