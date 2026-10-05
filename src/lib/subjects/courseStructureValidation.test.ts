import { describe, expect, it } from "vitest";
import {
  COURSE_STRUCTURE_MAX_ROWS,
  deriveSubjectCode,
  missingRequiredColumns,
  parseOrdinal,
  resolveImportCategory,
  resolveSemesterForYear,
  validateCourseStructureRows,
  type CourseStructureRawRow,
  type CourseStructureScope,
} from "./courseStructureValidation";

// CSE teaches Years 2-4 of a 4-year B.Tech (Year 1 is fed by Basic Science).
const scope: CourseStructureScope = {
  durationYears: 4,
  teachableYears: [2, 3, 4],
  semestersByYear: { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8] },
};

const base: CourseStructureRawRow = {
  year: "2", semester: "3", category: "PCC", name: "Data Structures",
  lectureHours: "3", tutorialHours: "0", practicalHours: "0",
};

function run(...rows: CourseStructureRawRow[]) {
  return validateCourseStructureRows(rows.map((data, i) => ({ rowNumber: i + 2, data })), scope);
}

describe("parseOrdinal", () => {
  it.each([["2", 2], ["2.0", 2], ["II", 2], ["Year 2", 2], ["2nd", 2], ["Sem 3", 3], ["III Semester", 3], ["Semester-IV", 4]])(
    "reads %s as %i", (raw, n) => expect(parseOrdinal(raw)).toBe(n),
  );
  it.each(["", "0", "1.5", "two", "A", "-1"])("rejects %j", (raw) => expect(parseOrdinal(raw)).toBeNull());
});

describe("resolveImportCategory", () => {
  const mine = [{ code: "PC", fullForm: "Professional Core" }, { code: "BS&H", fullForm: "Basic Sciences and Humanities" }];

  it("accepts standard codes and labels", () => {
    expect(resolveImportCategory("pcc")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core (PCC)")).toEqual({ kind: "known", category: "PCC" });
  });
  it("accepts categories the college defined, by code or full form", () => {
    expect(resolveImportCategory("pc", mine)).toEqual({ kind: "known", category: "PC" });
    expect(resolveImportCategory("BS&H", mine)).toEqual({ kind: "known", category: "BS&H" });
    expect(resolveImportCategory("basic sciences and humanities", mine)).toEqual({ kind: "known", category: "BS&H" });
  });
  it("treats anything undefined as unknown, with a suggestion when one is close", () => {
    expect(resolveImportCategory("PC")).toEqual({ kind: "unknown", suggestion: "PCC" });
    expect(resolveImportCategory("PCCC")).toEqual({ kind: "unknown", suggestion: "PCC" });
    expect(resolveImportCategory("Professional Elective-II")).toEqual({ kind: "unknown", suggestion: "PEC" });
    expect(resolveImportCategory("Open Elective-IV")).toEqual({ kind: "unknown", suggestion: "OEC" });
    expect(resolveImportCategory("SEC")).toEqual({ kind: "unknown" });
    expect(resolveImportCategory("Audit Course", mine)).toEqual({ kind: "unknown" });
  });
});

describe("resolveSemesterForYear", () => {
  it("uses the number when the year has it, else its position in the year", () => {
    expect(resolveSemesterForYear(5, [5, 6])).toBe(5);
    expect(resolveSemesterForYear(1, [5, 6])).toBe(5);
    expect(resolveSemesterForYear(2, [5, 6])).toBe(6);
    expect(resolveSemesterForYear(1, [3, 4])).toBe(3);
    expect(resolveSemesterForYear(2, [1, 4])).toBe(4);
    expect(resolveSemesterForYear(3, [5, 6])).toBeNull();
    expect(resolveSemesterForYear(1, [])).toBeNull();
  });
});

describe("validateCourseStructureRows", () => {
  it("accepts a clean file and fills derived fields", () => {
    const r = run(base, { ...base, semester: "IV", name: "DS Lab", lectureHours: "0", practicalHours: "3", code: "cs204" });
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toMatchObject({ code: "DATASTRUCT", codeSource: "derived", type: "THEORY", credits: 3, hoursPerWeek: 3 });
    expect(r.rows[1]).toMatchObject({ code: "CS204", codeSource: "file", semester: 4, type: "PRACTICAL", credits: 1.5 });
  });

  it("rejects years the department isn't assigned and semesters not in timings", () => {
    const r = run({ ...base, year: "1", semester: "1" }, { ...base, semester: "5" }, { ...base, year: "5" });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(r.errors[0].message).toMatch(/isn't assigned Year 1/);
    expect(r.errors[1].message).toMatch(/Semester 5 isn't configured for Year 2/);
    expect(r.errors[2].message).toMatch(/beyond this course's 4-year/);
  });

  it("fails the whole file when any single row is bad", () => {
    const r = run(base, { ...base, name: "Algorithms", semester: "Sem X" });
    expect(r.ok).toBe(false);
    expect(r.rows).toHaveLength(1);
  });

  it("checks required, numeric and consistency rules", () => {
    const r = run(
      { ...base, lectureHours: "" },
      { ...base, name: "B", tutorialHours: "abc" },
      { ...base, name: "C", credits: "x" },
      { ...base, name: "D", internalMarks: "30", externalMarks: "70", totalMarks: "90" },
      { ...base, name: "E", category: "OTHER" },
      { ...base, name: "F", type: "banana" },
    );
    expect(r.errors.map((e) => e.field)).toEqual(["lectureHours", "tutorialHours", "credits", "totalMarks", "customCategory", "type"]);
  });

  it("allows a shared code on different subjects but flags exact duplicates", () => {
    const r = run(base, { ...base, name: "Data Structures Lab", practicalHours: "2" }, { ...base });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/Duplicate of row 2/);
  });

  it("allows one subject across two semesters", () => {
    const r = run({ ...base, code: "YL1" }, { ...base, code: "YL1", semester: "4" });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(2);
  });

  it("warns on non-blocking inconsistencies", () => {
    const r = run({ ...base, hoursPerWeek: "5", shortCode: "DS" }, { ...base, name: "Discrete Structures", code: "MA201", shortCode: "ds" });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.field)).toEqual(["hoursPerWeek", "shortCode"]);
  });

  it("enforces the row cap", () => {
    const rows = Array.from({ length: COURSE_STRUCTURE_MAX_ROWS + 1 }, (_, i) => ({ ...base, code: `C${i}` }));
    expect(run(...rows).errors[0]).toMatchObject({ row: 0 });
  });
});

describe("validateCourseStructureRows - importing years with their own semester numbers", () => {
  const scope2: CourseStructureScope = {
    durationYears: 4,
    teachableYears: [2, 3, 4],
    semestersByYear: { 1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8] },
    customCategories: [{ code: "SEC", fullForm: "Skill Enhancement Course" }, { code: "AC", fullForm: "Audit Course" }],
  };
  const run2 = (...rows: CourseStructureRawRow[]) => validateCourseStructureRows(rows.map((data, i) => ({ rowNumber: i + 2, data })), scope2);

  it("reads a year's semesters 1 and 2 as its configured semesters, and says so", () => {
    const r = run2(
      { ...base, year: "3", semester: "1", name: "Computer Networks", code: "CS301" },
      { ...base, year: "3", semester: "2", name: "Compiler Design", code: "CS302" },
      { ...base, year: "4", semester: "2", name: "Project", code: "CS499" },
    );
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => [x.year, x.semester])).toEqual([[3, 5], [3, 6], [4, 8]]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("Year 3: Semester 1 is read as Semester 5, Semester 2 is read as Semester 6"),
      expect.stringContaining("Year 4: Semester 2 is read as Semester 8"),
    ]);
  });

  it("still accepts the configured numbers as they are, and rejects a semester the year doesn't have", () => {
    expect(run2({ ...base, year: "3", semester: "5", code: "A1" }).warnings).toEqual([]);
    const r = run2({ ...base, year: "3", semester: "3" });
    expect(r.errors[0].message).toMatch(/isn't configured for Year 3\. Use 5 or 6, or 1-2/);
  });

  it("flags a year whose configured semesters aren't consecutive", () => {
    const skewed = { ...scope2, semestersByYear: { ...scope2.semestersByYear, 2: [1, 4] } };
    const r = validateCourseStructureRows([{ rowNumber: 2, data: { ...base, semester: "2", code: "A1" } }], skewed);
    expect(r.rows[0].semester).toBe(4);
    expect(r.warnings.some((w) => /Year 2 has semesters 1, 4 .* aren't consecutive/.test(w.message))).toBe(true);
  });

  it("accepts defined categories and lists each undefined one with a suggestion", () => {
    const r = run2(
      { ...base, category: "SEC", code: "A1" },
      { ...base, category: "audit course", name: "Env Science", code: "A2" },
      { ...base, category: "PC", name: "OS", code: "A3" },
      { ...base, category: "Professional Elective-II", name: "DevOps", code: "A4" },
    );
    expect(r.rows.map((x) => x.category)).toEqual(["SEC", "AC"]);
    expect(r.errors).toEqual([
      expect.objectContaining({ row: 4, kind: "unknown-category", value: "PC", suggestion: "PCC" }),
      expect.objectContaining({ row: 5, kind: "unknown-category", value: "Professional Elective-II", suggestion: "PEC" }),
    ]);
    expect(r.errors[0].message).toContain("Add it in Category settings");
  });

  it("reads dashes and non-credit markers the way curriculum tables use them", () => {
    const r = run2(
      { ...base, code: "A1", tutorialHours: "-", credits: "-" },
      { ...base, code: "A2", name: "Audit One", credits: "NC" },
      { ...base, code: "A3", name: "Audit Two", credits: "Non-credit", internalMarks: "-" },
      { ...base, code: "A4", name: "Bad", credits: "two" },
    );
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining('Credits "two" must be a number 0 or more')]);
    expect(r.rows.map((x) => [x.tutorialHours, x.credits])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(r.rows[2].internalMarks).toBeUndefined();
  });
});

describe("helpers", () => {
  it("derives the same code as the previous importer", () => {
    expect(deriveSubjectCode(" Data Structures & Algorithms ")).toBe("DATASTRUCT");
  });
  it("lists missing required columns", () => {
    expect(missingRequiredColumns(["year", "name", "category", "lectureHours", "tutorialHours", "practicalHours"])).toEqual(["semester"]);
  });
});
