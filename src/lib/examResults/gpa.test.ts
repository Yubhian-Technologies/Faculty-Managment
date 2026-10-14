import { describe, expect, it } from "vitest";
import { applyRevaluations, computeCgpa, computeSgpa, finalPerSubject, latestPerSubject, studentStanding, type GpaSubject, type StudentSitting } from "./gpa";

const sub = (subjectCode: string, credits: number, points: number, isPass = true): GpaSubject => ({ subjectCode, credits, points, isPass });

describe("computeSgpa", () => {
  // The worked example on the college's own formula sheet: 96 / 12 = 8.
  const sheet = [sub("MATH", 4, 8), sub("PROG", 3, 9), sub("PHY", 3, 7), sub("ENG", 2, 8)];

  it("is Σ(Ci × Gi) / ΣCi", () => {
    const r = computeSgpa(sheet, "ALL_PASSED");
    expect(r.credits).toBe(12);
    expect(r.weightedPoints).toBe(96);
    expect(r.sgpa).toBe(8);
    expect(r.backlogs).toEqual([]);
    expect(r.withheld).toBe(false);
  });

  it("rounds to the decimals asked for", () => {
    const r = computeSgpa([sub("A", 4, 10), sub("B", 3, 8)], "ALWAYS");
    expect(r.sgpa).toBe(9.14);
    expect(computeSgpa([sub("A", 4, 10), sub("B", 3, 8)], "ALWAYS", 3).sgpa).toBe(9.143);
  });

  it("ALL_PASSED withholds the SGPA while a subject is failed, and names it", () => {
    const r = computeSgpa([...sheet.slice(0, 3), sub("ENG", 2, 0, false)], "ALL_PASSED");
    expect(r.sgpa).toBeNull();
    expect(r.withheld).toBe(true);
    expect(r.backlogs).toEqual(["ENG"]);
  });

  it("ALWAYS counts a failed subject as 0 points with its credits still in the divisor", () => {
    const r = computeSgpa([...sheet.slice(0, 3), sub("ENG", 2, 0, false)], "ALWAYS");
    expect(r.credits).toBe(12);
    expect(r.sgpa).toBe(6.67); // 80 / 12
    expect(r.withheld).toBe(false);
    expect(r.backlogs).toEqual(["ENG"]);
  });

  it("never credits points to a failed subject, whatever the row carries", () => {
    expect(computeSgpa([sub("A", 4, 10), sub("B", 4, 5, false)], "ALWAYS").sgpa).toBe(5);
  });

  it("leaves a zero-credit subject out of the formula but still requires it to be passed", () => {
    expect(computeSgpa([...sheet, sub("AUDIT", 0, 0)], "ALL_PASSED").sgpa).toBe(8);
    const failed = computeSgpa([...sheet, sub("AUDIT", 0, 0, false)], "ALL_PASSED");
    expect(failed.sgpa).toBeNull();
    expect(failed.backlogs).toEqual(["AUDIT"]);
    expect(computeSgpa([...sheet, sub("AUDIT", 0, 0, false)], "ALWAYS").sgpa).toBe(8);
  });

  it("gives no figure when nothing carries credits", () => {
    expect(computeSgpa([], "ALWAYS").sgpa).toBeNull();
    expect(computeSgpa([sub("AUDIT", 0, 0)], "ALWAYS").sgpa).toBeNull();
  });
});

describe("computeCgpa", () => {
  // The formula sheet's example: semesters of 20, 22 and 20 credits at SGPA
  // 8.0, 8.5 and 9.0 -> 527 / 62 = 8.50.
  const sem1 = [sub("S1A", 10, 8), sub("S1B", 10, 8)];
  const sem2 = [sub("S2A", 11, 8), sub("S2B", 11, 9)];
  const sem3 = [sub("S3A", 20, 9)];

  it("is Σ(semester credits × SGPA) / Σ semester credits", () => {
    expect(computeSgpa(sem2, "ALWAYS").sgpa).toBe(8.5);
    const r = computeCgpa([sem1, sem2, sem3], "ALL_PASSED");
    expect(r.credits).toBe(62);
    expect(r.cgpa).toBe(8.5);
  });

  const failedSem1 = [sub("S1A", 10, 8), sub("S1B", 10, 0, false)];

  it("ALL_PASSED: no CGPA while any earlier semester has a backlog, even after a clean semester", () => {
    // Sem 1 has a fail -> no SGPA for it and no CGPA.
    expect(computeSgpa(failedSem1, "ALL_PASSED").sgpa).toBeNull();
    expect(computeCgpa([failedSem1], "ALL_PASSED").cgpa).toBeNull();
    // Sem 2 all passed -> its SGPA is given, CGPA still is not.
    expect(computeSgpa(sem2, "ALL_PASSED").sgpa).toBe(8.5);
    const afterSem2 = computeCgpa([failedSem1, sem2], "ALL_PASSED");
    expect(afterSem2.cgpa).toBeNull();
    expect(afterSem2.withheld).toBe(true);
    expect(afterSem2.backlogs).toEqual(["S1B"]);
  });

  it("ALL_PASSED: clearing the backlog in a supplementary exam brings SGPA and CGPA back by itself", () => {
    const sem1Cleared = latestPerSubject([failedSem1, [sub("S1B", 10, 6)]]);
    expect(computeSgpa(sem1Cleared, "ALL_PASSED").sgpa).toBe(7);
    expect(computeCgpa([sem1Cleared, sem2], "ALL_PASSED").cgpa).toBe(7.79); // (140 + 187) / 42
  });

  it("ALWAYS: SGPA and CGPA are given with the fail counted as 0", () => {
    expect(computeSgpa(failedSem1, "ALWAYS").sgpa).toBe(4);
    const r = computeCgpa([failedSem1, sem2], "ALWAYS");
    expect(r.cgpa).toBe(6.36); // (80 + 187) / 42
    expect(r.withheld).toBe(false);
    expect(r.backlogs).toEqual(["S1B"]);
  });

  it("uses the exact semester values, not the rounded SGPAs", () => {
    const a = [sub("A1", 3, 10), sub("A2", 4, 8)]; // 62 / 7 = 8.857...
    const b = [sub("B1", 3, 7), sub("B2", 4, 9)]; // 57 / 7 = 8.142...
    expect(computeCgpa([a, b], "ALWAYS").cgpa).toBe(8.5); // 119 / 14
  });

  it("gives no figure with no semesters", () => {
    expect(computeCgpa([], "ALWAYS").cgpa).toBeNull();
  });
});

describe("latestPerSubject", () => {
  it("keeps the last sitting of each subject, matching codes in any case", () => {
    const out = latestPerSubject([[sub("MATH", 4, 0, false), sub("PHY", 3, 7)], [sub("math", 4, 6)]]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.subjectCode.toUpperCase() === "MATH")).toMatchObject({ points: 6, isPass: true });
  });
});

describe("studentStanding", () => {
  const strict = { showSgpa: "ALL_PASSED" as const, showCgpa: "ALL_PASSED" as const, decimals: 2 };
  const always = { showSgpa: "ALWAYS" as const, showCgpa: "ALWAYS" as const, decimals: 2 };
  const sem1Regular: StudentSitting = { semester: 1, examType: "REGULAR", at: 1, subjects: [sub("S1A", 10, 8), sub("S1B", 10, 0, false)] };
  const sem2Regular: StudentSitting = { semester: 2, examType: "REGULAR", at: 2, subjects: [sub("S2A", 11, 8), sub("S2B", 11, 9)] };
  const sem1Supply: StudentSitting = { semester: 1, examType: "SUPPLEMENTARY", at: 3, subjects: [sub("S1B", 10, 6)] };

  it("strict college: a fail in Sem 1 withholds Sem 1 SGPA and the CGPA; Sem 2 SGPA is still given", () => {
    expect(studentStanding([sem1Regular], 1, strict)).toEqual({ sgpa: null, sgpaWithheld: true, cgpa: null, cgpaWithheld: true, semesterBacklogs: ["S1B"], backlogs: ["S1B"] });
    const sem2 = studentStanding([sem1Regular, sem2Regular], 2, strict);
    expect(sem2).toMatchObject({ sgpa: 8.5, sgpaWithheld: false, cgpa: null, cgpaWithheld: true, semesterBacklogs: [], backlogs: ["S1B"] });
  });

  it("strict college: passing the subject in a supplementary brings Sem 1 SGPA and the CGPA back", () => {
    expect(studentStanding([sem1Regular, sem2Regular, sem1Supply], 1, strict)).toMatchObject({ sgpa: 7, cgpa: 7, backlogs: [] });
    expect(studentStanding([sem1Supply, sem2Regular, sem1Regular], 2, strict)).toMatchObject({ sgpa: 8.5, cgpa: 7.79, backlogs: [] });
  });

  it("always-calculate college: SGPA and CGPA are given with the fail counted as 0", () => {
    expect(studentStanding([sem1Regular, sem2Regular], 2, always)).toMatchObject({ sgpa: 8.5, cgpa: 6.36, backlogs: ["S1B"] });
  });

  it("orders attempts by academic year, so a later re-sit always wins", () => {
    const fail: StudentSitting = { semester: 1, academicYear: "2026-27", examType: "SUPPLEMENTARY", at: 1, subjects: [sub("S1B", 10, 0, false)] };
    const pass: StudentSitting = { semester: 1, academicYear: "2027-28", examType: "SUPPLEMENTARY", at: 0, subjects: [sub("S1B", 10, 6)] };
    expect(studentStanding([sem1Regular, pass, fail], 1, strict)).toMatchObject({ sgpa: 7, backlogs: [] });
  });

  it("ignores semesters after the one asked for", () => {
    expect(studentStanding([sem1Regular, sem2Regular, sem1Supply], 1, always).cgpa).toBe(7);
  });
});

describe("revaluation - best of two", () => {
  const strict = { showSgpa: "ALL_PASSED" as const, showCgpa: "ALL_PASSED" as const, decimals: 2 };
  const regular: StudentSitting = { semester: 1, academicYear: "2026-27", examType: "REGULAR", batchId: "reg", at: 1, subjects: [sub("MA", 4, 7), sub("PH", 3, 0, false)] };
  const reval = (subjects: GpaSubject[], at = 5): StudentSitting => ({ semester: 1, academicYear: "2026-27", examType: "REVALUATION", batchId: "rv", revaluesBatchId: "reg", at, subjects });

  it("a better revaluation grade replaces the original", () => {
    const [s] = applyRevaluations([regular, reval([sub("MA", 4, 9)])]);
    expect(s.subjects.map((x) => [x.subjectCode, x.points])).toEqual([["MA", 9], ["PH", 0]]);
  });

  it("a lower revaluation grade is ignored - the original stays", () => {
    const [s] = applyRevaluations([regular, reval([sub("MA", 4, 6)])]);
    expect(s.subjects[0].points).toBe(7);
  });

  it("a revaluation turning a fail into a pass clears the backlog and brings SGPA back", () => {
    expect(studentStanding([regular], 1, strict).sgpa).toBeNull();
    const r = studentStanding([regular, reval([sub("PH", 3, 6)])], 1, strict);
    expect(r).toMatchObject({ sgpa: 6.57, backlogs: [] }); // (28 + 18) / 7
  });

  it("a revaluation of a sitting that is not in the list changes nothing", () => {
    const orphan: StudentSitting = { ...reval([sub("MA", 4, 10)]), revaluesBatchId: "other" };
    expect(applyRevaluations([regular, orphan])).toEqual([regular]);
  });

  it("revaluing a supplementary applies to that sitting only", () => {
    const supply: StudentSitting = { semester: 1, academicYear: "2026-27", examType: "SUPPLEMENTARY", batchId: "sup", at: 3, subjects: [sub("PH", 3, 5)] };
    const rv: StudentSitting = { ...reval([sub("PH", 3, 8)]), revaluesBatchId: "sup" };
    expect(studentStanding([regular, supply, rv], 1, strict)).toMatchObject({ sgpa: 7.43, backlogs: [] }); // (28 + 24) / 7
  });

  it("a pass from revaluation stands even when a later supplementary was failed", () => {
    const supplyFail: StudentSitting = { semester: 1, academicYear: "2026-27", examType: "SUPPLEMENTARY", batchId: "sup", at: 3, subjects: [sub("PH", 3, 0, false)] };
    expect(studentStanding([regular, supplyFail, reval([sub("PH", 3, 6)], 9)], 1, strict)).toMatchObject({ sgpa: 6.57, backlogs: [] });
  });

  it("finalPerSubject keeps the latest pass over a later fail", () => {
    expect(finalPerSubject([[sub("X", 3, 6)], [sub("X", 3, 0, false)]])[0].points).toBe(6);
    expect(finalPerSubject([[sub("X", 3, 0, false)], [sub("X", 3, 8)]])[0].points).toBe(8);
  });
});
