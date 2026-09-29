import { describe, expect, it } from "vitest";
import {
  COURSE_STRUCTURE_MAX_ROWS,
  deriveSubjectCode,
  missingRequiredColumns,
  parseOrdinal,
  resolveImportCategory,
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
  it("accepts codes and labels", () => {
    expect(resolveImportCategory("pcc")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core")).toEqual({ kind: "known", category: "PCC" });
    expect(resolveImportCategory("Professional Core (PCC)")).toEqual({ kind: "known", category: "PCC" });
  });
  it("flags typos instead of inventing categories", () => {
    expect(resolveImportCategory("PCCC")).toEqual({ kind: "typo", suggestion: "PCC" });
    expect(resolveImportCategory("Proffesional Core")).toEqual({ kind: "typo", suggestion: "PCC" });
  });
  it("keeps genuinely custom categories", () => {
    expect(resolveImportCategory("SEC")).toEqual({ kind: "custom", category: "SEC" });
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

  it("detects derived-code collisions and exact duplicates", () => {
    const r = run(base, { ...base, name: "Data Structures Lab", practicalHours: "2" }, { ...base });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].message).toMatch(/both produce the code DATASTRUCT/);
    expect(r.errors[1].message).toMatch(/Duplicate of row 2/);
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

describe("helpers", () => {
  it("derives the same code as the previous importer", () => {
    expect(deriveSubjectCode(" Data Structures & Algorithms ")).toBe("DATASTRUCT");
  });
  it("lists missing required columns", () => {
    expect(missingRequiredColumns(["year", "name", "category", "lectureHours", "tutorialHours", "practicalHours"])).toEqual(["semester"]);
  });
});
