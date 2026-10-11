import { describe, expect, it } from "vitest";
import { batchTitle, normalizeBatchMeta, resolveResultHeaders } from "./sheet";

describe("resolveResultHeaders", () => {
  it("reads the template's own headings", () => {
    const r = resolveResultHeaders(["Roll No", "Subject Code", "Grade"]);
    expect(r.keyMap).toEqual({ 0: "rollNumber", 1: "subjectCode", 2: "grade" });
    expect(r.missing).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it("ignores marks columns - results are grades only", () => {
    const r = resolveResultHeaders(["Roll No", "Subject Code", "Internal Marks", "External Marks", "Total", "Grade"]);
    expect(r.keyMap).toEqual({ 0: "rollNumber", 1: "subjectCode", 5: "grade" });
    expect(r.ignored).toEqual(["Internal Marks", "External Marks", "Total"]);
  });

  it("reads common results-sheet wording and lists the columns it ignores", () => {
    const r = resolveResultHeaders(["Sl.No", "HTNO", "Student Name", "Sub Code", "Subject Name", "Credits", "Grade Secured", "Result"]);
    expect(r.keyMap).toEqual({ 1: "rollNumber", 3: "subjectCode", 6: "grade" });
    expect(r.missing).toEqual([]);
    expect(r.ignored).toEqual(["Sl.No", "Student Name", "Subject Name", "Credits", "Result"]);
  });

  it("names the required columns that are missing", () => {
    expect(resolveResultHeaders(["Roll No", "Marks"]).missing).toEqual(["Subject Code", "Grade"]);
  });

  it("uses only the first column for a field named twice", () => {
    const r = resolveResultHeaders(["Roll No", "Regd No", "Subject Code", "Grade"]);
    expect(r.keyMap).toEqual({ 0: "rollNumber", 2: "subjectCode", 3: "grade" });
    expect(r.ignored).toEqual(["Regd No"]);
  });
});

describe("normalizeBatchMeta", () => {
  const good = { courseKey: "cat1", courseName: "Bachelor of Technology", courseIds: ["c1", "c2", "c1"], department: "CSE", departmentId: "d1", regulation: " r23 ", academicYear: "2026-27", year: "1", semester: 2, examType: "REGULAR" };

  it("cleans a valid choice", () => {
    expect(normalizeBatchMeta(good)).toEqual({
      meta: { courseKey: "cat1", courseName: "Bachelor of Technology", courseIds: ["c1", "c2"], department: "CSE", departmentId: "d1", regulation: "R23", academicYear: "2026-27", year: 1, semester: 2, examType: "REGULAR" },
    });
  });

  it("allows no regulation", () => {
    expect(normalizeBatchMeta({ ...good, regulation: "" })).toMatchObject({ meta: { regulation: "" } });
  });

  it("refuses a missing choice", () => {
    const err = (o: unknown) => (normalizeBatchMeta(o) as { error: string }).error;
    expect(err({ ...good, courseIds: [] })).toBe("Choose a course");
    expect(err({ ...good, department: "" })).toBe("Choose a branch");
    expect(err({ ...good, academicYear: "2026" })).toBe("Choose an academic year");
    expect(err({ ...good, year: 0 })).toBe("Choose a year");
    expect(err({ ...good, semester: "x" })).toBe("Choose a semester");
    expect(err({ ...good, examType: "MAKEUP" })).toBe("Choose Regular or Supplementary");
  });

  it("titles a batch", () => {
    const m = (normalizeBatchMeta({ ...good, examType: "SUPPLEMENTARY" }) as { meta: Parameters<typeof batchTitle>[0] }).meta;
    expect(batchTitle(m)).toBe("Bachelor of Technology · CSE · R23 · 2026-27 · Year 1 · Semester 2 · Supplementary");
  });
});
