import { describe, expect, it } from "vitest";
import { applyPriorResults, applyRevaluationTargets, groupByBranch, pickSubject, validateResultRows, wrongBatchFile, type PriorResult, type RawResultRow, type ResultImportContext, type ResultStudent, type ResultSubjectOption } from "./importRows";
import { normalizeResultRules, gradeTableFor, rulesOrStarter, STARTER_GRADE_TABLE, STARTER_RULES } from "./rules";

const anil: ResultStudent = { id: "s1", rollNumber: "24A91A0501", name: "Anil", department: "CSE", courseId: "c-cse", regulation: "R23" };
const bina: ResultStudent = { id: "s2", rollNumber: "24A91A0502", name: "Bina", department: "CSE", courseId: "c-cse", regulation: "R23" };
const mba: ResultStudent = { id: "s3", rollNumber: "24MBA001", name: "Chitra", department: "MBA", courseId: "c-mba" };

const math: ResultSubjectOption = { id: "sub-math", code: "MA101", name: "Mathematics", credits: 4, courseId: "c-cse", regulation: "R23" };
const prog: ResultSubjectOption = { id: "sub-prog", code: "CS101", name: "Programming", credits: 3, courseId: "c-cse", regulation: "R23" };
const audit: ResultSubjectOption = { id: "sub-audit", code: "MC101", name: "Constitution", credits: 0, courseId: "c-cse", regulation: "R23" };

const ctx = (over: Partial<ResultImportContext> = {}): ResultImportContext => ({
  students: new Map([anil, bina, mba].map((s) => [s.rollNumber.toUpperCase(), s])),
  subjects: new Map([math, prog, audit].map((s) => [s.code.toUpperCase(), [s]])),
  gradeTable: STARTER_GRADE_TABLE,
  courseIds: ["c-cse", "c-ece"],
  courseName: "Bachelor of Technology",
  department: "CSE",
  regulation: "R23",
  academicYear: "2026-27",
  ...over,
});
const row = (n: number, rollNumber: string, subjectCode: string, grade: string, extra: Partial<RawResultRow> = {}): RawResultRow => ({ row: n, rollNumber, subjectCode, grade, ...extra });

describe("validateResultRows", () => {
  it("groups a student's rows into one record, with credits, points and pass/fail from the tables", () => {
    const { accepted, failed } = validateResultRows(
      [row(2, "24a91a0501", "ma101", "s"), row(3, "24A91A0501", "CS101", "F"), row(4, "24A91A0502", "MA101", " b ")],
      ctx()
    );
    expect(failed).toEqual([]);
    expect(accepted).toHaveLength(2);
    expect(accepted[0].student.id).toBe("s1");
    expect(accepted[0].subjects).toEqual([
      { subjectId: "sub-math", subjectCode: "MA101", subjectName: "Mathematics", credits: 4, grade: "S", points: 10, isPass: true },
      { subjectId: "sub-prog", subjectCode: "CS101", subjectName: "Programming", credits: 3, grade: "F", points: 0, isPass: false },
    ]);
    expect(accepted[1].subjects[0]).toMatchObject({ grade: "B", points: 8, isPass: true });
  });

  it("keeps a zero-credit subject, with 0 credits, as a Pass", () => {
    const { accepted } = validateResultRows([row(2, "24A91A0501", "MC101", "A")], ctx());
    expect(accepted[0].subjects[0]).toMatchObject({ credits: 0, grade: "Pass", isPass: true });
  });

  it("rejects a row with a blank roll, subject or grade", () => {
    const { accepted, failed } = validateResultRows([row(2, "", "MA101", "S"), row(3, "24A91A0501", " ", "S"), row(4, "24A91A0501", "MA101", "")], ctx());
    expect(accepted).toEqual([]);
    expect(failed.map((f) => [f.row, f.error])).toEqual([[2, "Regd. No is required"], [3, "Subject Code is required"], [4, "Grade is required"]]);
  });

  it("rejects an unknown roll, a student of another course, an unknown subject and an unknown grade", () => {
    const { accepted, failed } = validateResultRows(
      [row(2, "99X", "MA101", "S"), row(3, "24MBA001", "MA101", "S"), row(4, "24A91A0501", "ZZ999", "S"), row(5, "24A91A0501", "MA101", "Z")],
      ctx()
    );
    expect(accepted).toEqual([]);
    expect(failed[0].error).toBe('No student with Regd. No "99X" in this college');
    expect(failed[1].error).toBe("24MBA001 is not a Bachelor of Technology student");
    expect(failed[2].error).toBe('Subject Code "ZZ999" is not a subject of this college');
    expect(failed[3].error).toContain('Grade "Z" is not in the grade table');
  });

  it("rejects the second row for the same student and subject, keeping the first", () => {
    const { accepted, failed } = validateResultRows([row(2, "24A91A0501", "MA101", "S"), row(3, "24a91a0501", "ma101", "A")], ctx());
    expect(accepted[0].subjects).toHaveLength(1);
    expect(accepted[0].subjects[0].grade).toBe("S");
    expect(failed).toEqual([{ row: 3, rollNumber: "24a91a0501", subjectCode: "ma101", error: "24a91a0501 already has a row for ma101 in this file" }]);
  });

  it("refuses a student of another branch, and accepts a 1st-year by core department", () => {
    const ece = { ...bina, id: "s4", rollNumber: "24A91A0401", department: "ECE" };
    const bsc = { ...bina, id: "s5", rollNumber: "26A91A0001", department: "Basic Science", secondaryDepartment: "CSE" };
    const students = new Map([ece, bsc].map((s) => [s.rollNumber, s]));
    const r = validateResultRows([row(2, "24A91A0401", "MA101", "A"), row(3, "26A91A0001", "MA101", "A")], ctx({ students }));
    expect(r.failed.map((f) => f.error)).toEqual(["24A91A0401 is not a CSE student (ECE)"]);
    expect(r.accepted.map((a) => a.student.id)).toEqual(["s5"]);
  });

  it("does not check the course when the batch names none, or the student has none on record", () => {
    expect(validateResultRows([row(2, "24MBA001", "MA101", "S")], ctx({ courseIds: [], department: "" })).failed).toEqual([]);
    const noCourse = { ...anil, courseId: undefined };
    expect(validateResultRows([row(2, "24A91A0501", "MA101", "S")], ctx({ students: new Map([["24A91A0501", noCourse]]) })).failed).toEqual([]);
  });
});

describe("supplementary checks against the earlier sitting", () => {
  const sheet = () => validateResultRows([row(2, "24A91A0501", "MA101", "B")], ctx()).accepted;
  const regular = (over: Partial<{ academicYear: string; status: "DRAFT" | "PUBLISHED" }> = {}) => ({
    studentId: "s1", batchId: "b0", examType: "REGULAR" as const, academicYear: "2026-27", status: "PUBLISHED" as const,
    subjects: [{ subjectCode: "MA101", isPass: false }], ...over,
  });

  it("is refused while the Regular result is still a draft", () => {
    const r = applyPriorResults(sheet(), [regular({ status: "DRAFT" })], "SUPPLEMENTARY", 3, "2026-27");
    expect(r.failed.map((f) => f.error)).toEqual(["24A91A0501's earlier result for MA101 is not published yet - publish it first"]);
  });

  it("is refused for an academic year before the Regular exam", () => {
    const r = applyPriorResults(sheet(), [regular()], "SUPPLEMENTARY", 3, "2025-26");
    expect(r.failed.map((f) => f.error)).toEqual(["A 2025-26 supplementary cannot come before 24A91A0501's 2026-27 exam in MA101"]);
  });

  it("is accepted in the same or a later academic year", () => {
    expect(applyPriorResults(sheet(), [regular()], "SUPPLEMENTARY", 3, "2026-27").failed).toEqual([]);
    expect(applyPriorResults(sheet(), [regular()], "SUPPLEMENTARY", 3, "2027-28").failed).toEqual([]);
  });
});

describe("zero-credit subjects - Pass / Fail only", () => {
  it("any grade is a Pass, except a failing one, with no points", () => {
    const { accepted, failed } = validateResultRows([
      row(2, "24A91A0501", "MC101", "S"),
      row(3, "24A91A0502", "MC101", "P"),
      row(4, "24MBA001", "MC101", "COMPLETED"),
    ], ctx({ courseIds: [], department: "" }));
    expect(failed).toEqual([]);
    expect(accepted.map((a) => a.subjects[0])).toEqual(["S", "P", "COMPLETED"].map((given) =>
      ({ subjectId: "sub-audit", subjectCode: "MC101", subjectName: "Constitution", credits: 0, grade: "Pass", points: 0, isPass: true, gradeAsGiven: given })));
  });

  it("F - and any grade marked failing in Result Rules (AB, MP, WH) - is a Fail", () => {
    const { accepted } = validateResultRows([row(2, "24A91A0501", "MC101", "F"), row(3, "24A91A0502", "MC101", "ab")], ctx());
    expect(accepted.map((a) => [a.subjects[0].grade, a.subjects[0].isPass, a.subjects[0].gradeAsGiven])).toEqual([["Fail", false, "F"], ["Fail", false, "AB"]]);
  });

  it("a credit subject still needs a grade from the grade table", () => {
    expect(validateResultRows([row(2, "24A91A0501", "MA101", "P")], ctx()).failed[0].error).toContain('Grade "P" is not in the grade table');
  });
});

describe("sub-departments", () => {
  const aiml = { ...bina, id: "s7", rollNumber: "24A91A0601", department: "CSE - AI&ML" };
  const students = () => new Map([anil, aiml].map((s) => [s.rollNumber.toUpperCase(), s]));

  it("the whole branch takes its sub-departments' students too", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0601", "MA101", "A")],
      ctx({ students: students(), allowedDepartments: ["CSE", "CSE - AI&ML"] }));
    expect(r.failed).toEqual([]);
  });

  it("one sub-department picked takes only its own students", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0601", "MA101", "A")],
      ctx({ students: students(), allowedDepartments: ["CSE - AI&ML"] }));
    expect(r.failed.map((f) => f.error)).toEqual(["24A91A0501 is not a CSE - AI&ML student (CSE)"]);
    expect(r.accepted.map((a) => a.student.id)).toEqual(["s7"]);
  });
});

describe("pickSubject", () => {
  it("prefers the student's own course, then the regulation, then the academic year", () => {
    const other = { ...math, id: "other-course", courseId: "c-ece" };
    const oldReg = { ...math, id: "old-reg", regulation: "R20" };
    const thisYear = { ...math, id: "this-year", academicYear: "2026-27" };
    expect(pickSubject([other, math], anil, ctx()).id).toBe("sub-math");
    expect(pickSubject([oldReg, math], anil, ctx()).id).toBe("sub-math");
    expect(pickSubject([math, thisYear], anil, ctx()).id).toBe("this-year");
  });
});

describe("result rules", () => {
  it("accepts the starter rules as they are", () => {
    expect(normalizeResultRules(STARTER_RULES)).toEqual({ rules: STARTER_RULES });
  });

  it("tidies grades and regulation names, and drops an empty regulation table", () => {
    const out = normalizeResultRules({
      showSgpa: "ALWAYS", showCgpa: "ALL_PASSED", decimals: 2,
      gradeTables: { DEFAULT: [{ grade: " o ", points: "10", isPass: true }, { grade: "f", points: 0, isPass: false }], " r23 ": [{ grade: "a+", points: 10, isPass: true }], R20: [] },
    });
    expect(out).toEqual({
      rules: {
        showSgpa: "ALWAYS", showCgpa: "ALL_PASSED", decimals: 2, cgpaFrom: "PRINTED",
        gradeTables: { DEFAULT: [{ grade: "O", points: 10, isPass: true }, { grade: "F", points: 0, isPass: false }], R23: [{ grade: "A+", points: 10, isPass: true }] },
      },
    });
  });

  it("refuses rules that cannot work", () => {
    const base = { showSgpa: "ALWAYS", showCgpa: "ALWAYS", decimals: 2 };
    const pass = { grade: "A", points: 9, isPass: true };
    const fail = { grade: "F", points: 0, isPass: false };
    const err = (o: unknown) => (normalizeResultRules(o) as { error: string }).error;
    expect(err({ ...base, showSgpa: "SOMETIMES", gradeTables: { DEFAULT: [pass, fail] } })).toBe("Choose when SGPA is shown");
    expect(err({ ...base, decimals: 9, gradeTables: { DEFAULT: [pass, fail] } })).toBe("Decimals must be a whole number from 0 to 4");
    expect(err({ ...base, gradeTables: { DEFAULT: [pass] } })).toBe("The default grade table needs at least one failing grade");
    expect(err({ ...base, gradeTables: { DEFAULT: [fail] } })).toBe("The default grade table needs at least one passing grade");
    expect(err({ ...base, gradeTables: { DEFAULT: [pass, fail, { grade: "a", points: 8, isPass: true }] } })).toBe('Default grade table: grade "A" is listed twice');
    expect(err({ ...base, gradeTables: { DEFAULT: [pass, fail, { grade: "B", points: "", isPass: true }] } })).toBe('Default grade table: grade "B" needs points between 0 and 100');
    expect(err({ ...base, gradeTables: { DEFAULT: [pass, fail], R23: [fail] } })).toBe("R23 grade table needs at least one passing grade");
  });

  it("uses a regulation's own table, else the default", () => {
    const rules = { gradeTables: { DEFAULT: STARTER_GRADE_TABLE, R23: [{ grade: "A+", points: 10, isPass: true }] } };
    expect(gradeTableFor(rules, "r23")).toEqual([{ grade: "A+", points: 10, isPass: true }]);
    expect(gradeTableFor(rules, "R20")).toBe(STARTER_GRADE_TABLE);
    expect(gradeTableFor(rules, "")).toBe(STARTER_GRADE_TABLE);
  });

  it("falls back to the starter rules for a college that has saved none", () => {
    expect(rulesOrStarter(undefined)).toEqual(STARTER_RULES);
    expect(rulesOrStarter({ decimals: 2 })).toEqual(STARTER_RULES);
  });
});

describe("applyPriorResults", () => {
  const sheet = () => validateResultRows([row(2, "24A91A0501", "MA101", "B"), row(3, "24A91A0501", "CS101", "A"), row(4, "24A91A0502", "MA101", "S")], ctx()).accepted;

  it("Regular: refuses a student who already has Regular results for the semester, and keeps the rest", () => {
    const r = applyPriorResults(sheet(), [{ studentId: "s1", batchId: "b0", examType: "REGULAR", academicYear: "2025-26", status: "PUBLISHED", subjects: [] }], "REGULAR", 1);
    expect(r.accepted.map((a) => a.student.id)).toEqual(["s2"]);
    expect(r.failed.map((f) => [f.row, f.error])).toEqual([
      [2, "24A91A0501 already has Regular results for Semester 1 in another sheet"],
      [3, "24A91A0501 already has Regular results for Semester 1 in another sheet"],
    ]);
  });

  it("Regular: a student with only a Supplementary result elsewhere is not refused", () => {
    expect(applyPriorResults(sheet(), [{ studentId: "s1", batchId: "b0", examType: "SUPPLEMENTARY", academicYear: "2025-26", status: "PUBLISHED", subjects: [] }], "REGULAR", 1).failed).toEqual([]);
  });

  it("Supplementary: only for a subject with an earlier result that is not passed yet", () => {
    const prior = [
      { studentId: "s1", batchId: "b0", examType: "REGULAR" as const, academicYear: "2025-26", status: "PUBLISHED" as const, subjects: [{ subjectCode: "MA101", isPass: false }, { subjectCode: "CS101", isPass: true }] },
      { studentId: "s2", batchId: "b0", examType: "REGULAR" as const, academicYear: "2025-26", status: "PUBLISHED" as const, subjects: [{ subjectCode: "ma101", isPass: false }] },
    ];
    const r = applyPriorResults(sheet(), prior, "SUPPLEMENTARY", 1);
    expect(r.accepted.map((a) => [a.student.id, a.subjects.map((s) => s.subjectCode), a.rows])).toEqual([["s1", ["MA101"], [2]], ["s2", ["MA101"], [4]]]);
    expect(r.failed).toEqual([{ row: 3, rollNumber: "24A91A0501", subjectCode: "CS101", error: "24A91A0501 has already passed CS101" }]);
  });

  it("Supplementary: refuses a subject passed in an earlier supplementary sitting, or never sat", () => {
    const prior = [
      { studentId: "s1", batchId: "b0", examType: "REGULAR" as const, academicYear: "2025-26", status: "PUBLISHED" as const, subjects: [{ subjectCode: "MA101", isPass: false }] },
      { studentId: "s1", batchId: "b1", examType: "SUPPLEMENTARY" as const, academicYear: "2025-26", status: "PUBLISHED" as const, subjects: [{ subjectCode: "MA101", isPass: true }] },
    ];
    const r = applyPriorResults(sheet(), prior, "SUPPLEMENTARY", 1);
    expect(r.accepted).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual([
      "24A91A0501 has already passed MA101",
      "24A91A0501 has no earlier result for CS101 in Semester 1",
      "24A91A0502 has no earlier result for MA101 in Semester 1",
    ]);
  });
});

describe("applyRevaluationTargets", () => {
  const sheet = () => validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0501", "CS101", "B")], ctx()).accepted;
  const regular = (over: Partial<PriorResult> = {}): PriorResult => ({
    studentId: "s1", batchId: "reg1", examType: "REGULAR", academicYear: "2026-27", status: "PUBLISHED", at: 1,
    subjects: [{ subjectCode: "MA101", isPass: true }, { subjectCode: "CS101", isPass: false }], ...over,
  });

  it("links each student to the picked exam, passed subjects included", () => {
    const r = applyRevaluationTargets(sheet(), [regular()], "reg1", "Regular Nov 2026");
    expect(r.failed).toEqual([]);
    expect(r.accepted[0]).toMatchObject({ revaluesBatchId: "reg1" });
    expect(r.accepted[0].subjects.map((s) => s.subjectCode)).toEqual(["MA101", "CS101"]);
  });

  it("refuses a student with no result in the picked exam", () => {
    expect(applyRevaluationTargets(sheet(), [regular({ batchId: "other" })], "reg1", "Regular Nov 2026").failed[0].error)
      .toBe("24A91A0501 has no result in Regular Nov 2026");
  });

  it("refuses a subject not in that exam, or already revalued for it", () => {
    const prior = [
      regular({ subjects: [{ subjectCode: "MA101", isPass: true }] }),
      { studentId: "s1", batchId: "rv0", examType: "REVALUATION" as const, revaluesBatchId: "reg1", academicYear: "2026-27", status: "DRAFT" as const, subjects: [{ subjectCode: "MA101", isPass: true }] },
    ];
    const r = applyRevaluationTargets(sheet(), prior, "reg1", "Regular Nov 2026");
    expect(r.accepted).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual([
      "24A91A0501's Regular Nov 2026 MA101 has already been revalued",
      "CS101 is not in 24A91A0501's Regular Nov 2026 result",
    ]);
  });
});

describe("batch membership", () => {
  const withBatch = (students: ResultStudent[], over: Partial<ResultImportContext> = {}) =>
    ctx({ students: new Map(students.map((s) => [s.rollNumber.toUpperCase(), s])), batch: "2024-2028", ...over });

  it("accepts the batch itself and a lateral entrant ending the same year", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0502", "MA101", "A")],
      withBatch([{ ...anil, batch: "2024-2028" }, { ...bina, batch: "2025-2028" }]));
    expect(r.failed).toEqual([]);
  });

  it("another batch, or none on record, is a note - the result still goes to the Regd. No's student", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0502", "MA101", "A")],
      withBatch([{ ...anil, batch: "2023-2027" }, { ...bina, batch: undefined }]));
    expect(r.failed).toEqual([]);
    expect(r.accepted.map((a) => [a.student.id, a.otherBatch])).toEqual([["s1", "2023-2027"], ["s2", ""]]);
  });

  it("no batch stored: taken from the section's batch, else worked out from the year of study", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0502", "MA101", "A"), row(4, "24MBA001", "MA101", "A")],
      withBatch([
        { ...anil, batch: undefined, sectionBatch: "2024-2028" },
        { ...bina, batch: undefined, year: 3 },             // 2026-27, Year 3 -> 2024 intake
        { ...mba, batch: undefined, year: 2 },              // 2026-27, Year 2 -> 2025 intake
      ], { currentStartYear: 2026, courseIds: [], department: "" }));
    expect(r.failed).toEqual([]);
    expect(r.accepted.map((a) => a.otherBatch)).toEqual([undefined, undefined, "Year 2 now (2025-)"]);
  });

  it("a detained student now in a later batch with results already under this one gets no note", () => {
    const r = validateResultRows([row(2, "24A91A0501", "MA101", "A")], withBatch([{ ...anil, batch: "2025-2029" }], { batchHistory: new Set(["s1"]) }));
    expect(r.accepted[0].otherBatch).toBeUndefined();
  });

  it("stops only a file that is mostly another batch (5+ students and over half)", () => {
    const st = (n: number, batch: string): ResultStudent => ({ ...anil, id: `s${n}`, rollNumber: `R${n}`, batch });
    const file = (other: number, same: number) => {
      const students = [...Array.from({ length: other }, (_, i) => st(i, "2023-2027")), ...Array.from({ length: same }, (_, i) => st(100 + i, "2024-2028"))];
      return validateResultRows(students.map((s, i) => row(i + 2, s.rollNumber, "MA101", "A")), withBatch(students)).accepted;
    };
    expect(wrongBatchFile(file(6, 4), "2024-2028")).toBe("6 of 10 students are not in batch 2024-2028 on record (most are 2023-2027) - check the batch picked for this file");
    expect(wrongBatchFile(file(5, 5), "2024-2028")).toBeNull();   // not over half
    expect(wrongBatchFile(file(3, 0), "2024-2028")).toBeNull();   // a few detained students on their own
  });

  it("reads the University SGPA from the first row that has it, and '-' as withheld", () => {
    const r = validateResultRows([
      row(2, "24A91A0501", "MA101", "A"), row(3, "24A91A0501", "CS101", "A", { universitySgpa: "8.69" }),
      row(4, "24A91A0502", "MA101", "F", { universitySgpa: "-" }),
    ], ctx());
    expect(r.accepted.map((a) => a.universitySgpa)).toEqual([8.69, null]);
  });
});

describe("supplementary: picked exam and batch", () => {
  const sheet = () => validateResultRows([row(2, "24A91A0501", "MA101", "B")], ctx()).accepted;
  const reg = (over: Partial<PriorResult> = {}): PriorResult => ({ studentId: "s1", batchId: "reg1", examType: "REGULAR", academicYear: "2025-26", status: "PUBLISHED", subjects: [{ subjectCode: "MA101", isPass: false }], ...over });

  it("must be a subject of the picked exam", () => {
    expect(applyPriorResults(sheet(), [reg()], "SUPPLEMENTARY", 3, "2025-26", { targetBatchId: "reg1" }).failed).toEqual([]);
    expect(applyPriorResults(sheet(), [reg(), reg({ batchId: "sup1", examType: "SUPPLEMENTARY", subjects: [{ subjectCode: "CS101", isPass: false }] })], "SUPPLEMENTARY", 3, "2025-26", { targetBatchId: "sup1" }).failed[0].error)
      .toBe("MA101 is not in 24A91A0501's picked exam");
  });

  it("a detained student may write the Regular again under a new batch, but not twice in one", () => {
    expect(applyPriorResults(sheet(), [reg({ batch: "2024-2028" })], "REGULAR", 3, "2026-27", { batch: "2025-2029" }).failed).toEqual([]);
    expect(applyPriorResults(sheet(), [reg({ batch: "2024-2028" })], "REGULAR", 3, "2025-26", { batch: "2024-2028" }).failed).toHaveLength(1);
  });
});

describe("groupByBranch - every branch in one upload", () => {
  const depts = [
    { id: "cse", name: "CSE" }, { id: "ece", name: "ECE" },
    { id: "cs", name: "CSE [CYBER SECURITY]", parentDepartmentId: "cse" },
    { id: "bs", name: "Basic Science" },
  ];
  const stu = (id: string, roll: string, department: string, secondaryDepartment?: string) =>
    ({ student: { id, rollNumber: roll, name: id, department, ...(secondaryDepartment ? { secondaryDepartment } : {}) }, subjects: [{ subjectId: "m", subjectCode: "MA101", subjectName: "M", credits: 3, grade: "A", points: 9, isPass: true }], rows: [2] });

  it("one sheet per branch, a sub-department its own, a Basic Science 1st year under the core department", () => {
    const r = groupByBranch([
      stu("a", "R1", "CSE"), stu("b", "R2", "ECE"), stu("c", "R3", "CSE [CYBER SECURITY]"),
      stu("d", "R4", "Basic Science", "ECE"), stu("e", "R5", "CSE"),
    ], depts);
    expect(r.failed).toEqual([]);
    expect(r.groups.map((g) => [g.department, g.subDepartment ?? "", g.students.map((x) => x.student.id)])).toEqual([
      ["CSE", "", ["a", "e"]],
      ["CSE", "CSE [CYBER SECURITY]", ["c"]],
      ["ECE", "", ["b", "d"]],
    ]);
  });

  it("refuses a student with no department, or one the college doesn't have", () => {
    const r = groupByBranch([stu("a", "R1", ""), stu("b", "R2", "MECH")], depts);
    expect(r.groups).toEqual([]);
    expect(r.failed.map((f) => f.error)).toEqual(["R1 has no department on record", 'R2\'s department "MECH" is not one of the college\'s departments']);
  });
});

describe("picked exam per student (every-branch upload)", () => {
  const sheet = () => validateResultRows([row(2, "24A91A0501", "MA101", "B"), row(3, "24A91A0502", "MA101", "A")], ctx()).accepted;
  const reg = (studentId: string, batchId: string): PriorResult => ({ studentId, batchId, examType: "REGULAR", academicYear: "2025-26", status: "PUBLISHED", subjects: [{ subjectCode: "MA101", isPass: false }] });

  it("a supplementary checks each student against their own branch's sheet of the exam", () => {
    const targets = new Map([["s1", "reg-cse"], ["s2", "reg-ece"]]);
    expect(applyPriorResults(sheet(), [reg("s1", "reg-cse"), reg("s2", "reg-ece")], "SUPPLEMENTARY", 3, "2025-26", { targetByStudent: targets }).failed).toEqual([]);
    expect(applyPriorResults(sheet(), [reg("s1", "reg-cse")], "SUPPLEMENTARY", 3, "2025-26", { targetByStudent: new Map([["s1", "reg-cse"]]) }).failed.map((f) => f.error))
      .toEqual(["24A91A0502 has no earlier result for MA101 in Semester 3"]);
  });

  it("a revaluation links each student to their own sheet of the exam", () => {
    const r = applyRevaluationTargets(sheet(), [reg("s1", "reg-cse"), reg("s2", "reg-ece")], new Map([["s1", "reg-cse"], ["s2", "reg-ece"]]), "Regular Dec 2025");
    expect(r.accepted.map((a) => [a.student.id, a.revaluesBatchId])).toEqual([["s1", "reg-cse"], ["s2", "reg-ece"]]);
  });
});
