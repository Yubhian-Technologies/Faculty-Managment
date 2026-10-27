import { describe, expect, it } from "vitest";
import { batchTitle, completeFromTarget, examHeldLabel, normalizeBatchMeta, regularAcademicYear, resolveResultHeaders, type ResultBatchMeta, type TargetExam } from "./sheet";

describe("resolveResultHeaders", () => {
  it("reads the template's own headings", () => {
    const r = resolveResultHeaders(["Regd. No", "Subject Code", "Grade"]);
    expect(r.keyMap).toEqual({ 0: "rollNumber", 1: "subjectCode", 2: "grade" });
    expect(r.missing).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it("ignores marks columns - results are grades only", () => {
    const r = resolveResultHeaders(["Regd. No", "Subject Code", "Internal Marks", "External Marks", "Total", "Grade"]);
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
    expect(resolveResultHeaders(["Regd. No", "Marks"]).missing).toEqual(["Subject Code", "Grade"]);
  });

  it("uses only the first column for a field named twice", () => {
    const r = resolveResultHeaders(["Regd. No", "Regd No", "Subject Code", "Grade"]);
    expect(r.keyMap).toEqual({ 0: "rollNumber", 2: "subjectCode", 3: "grade" });
    expect(r.ignored).toEqual(["Regd No"]);
  });
});

describe("normalizeBatchMeta", () => {
  // A June-start college; it is Oct 2026.
  const ctx = { currentMonth: "2026-10", academicYearOfMonth: (ym: string) => { const y = Number(ym.slice(0, 4)); const s = Number(ym.slice(5)) >= 6 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; } };
  const good = {
    courseKey: "cat1", courseName: "Bachelor of Technology", courseIds: ["c1", "c2", "c1"], department: "CSE", departmentId: "d1",
    regulation: " r23 ", batch: "2024-2028", year: "2", semester: 3, examType: "REGULAR", examHeld: "2025-11",
  };
  const meta = (o: object) => (normalizeBatchMeta(o, ctx) as { meta: ResultBatchMeta }).meta;
  const err = (o: object) => (normalizeBatchMeta(o, ctx) as { error: string }).error;

  it("cleans a Regular and derives its academic year from batch + year", () => {
    expect(meta(good)).toEqual({
      courseKey: "cat1", courseName: "Bachelor of Technology", courseIds: ["c1", "c2"], department: "CSE", departmentId: "d1",
      regulation: "R23", batch: "2024-2028", year: 2, semester: 3, examType: "REGULAR", examHeld: "2025-11", academicYear: "2025-26",
    });
    expect(regularAcademicYear("2024-2028", 4)).toBe("2027-28");
  });

  it("refuses a missing or impossible choice", () => {
    expect(err({ ...good, regulation: "" })).toBe("Choose a regulation");
    expect(err({ ...good, batch: "2024" })).toBe("Choose a batch");
    expect(err({ ...good, department: "" })).toBe("Choose the branch again");
    // No branch at all = every branch in one upload.
    expect(meta({ ...good, department: "", departmentId: "" })).toMatchObject({ department: "", departmentId: "" });
    expect(err({ ...good, year: 5 })).toBe("Batch 2024-2028 has no Year 5");
    expect(err({ ...good, semester: "x" })).toBe("Choose a semester");
    expect(err({ ...good, examType: "MAKEUP" })).toBe("Choose Regular, Supplementary or Revaluation");
    expect(err({ ...good, examHeld: "" })).toBe("Choose the month the exam was held");
  });

  it("refuses an exam month that hasn't come, and a Regular dated before its year", () => {
    expect(err({ ...good, examHeld: "2026-12" })).toBe("Dec 2026 hasn't come yet - choose the month the exam was held");
    expect(err({ ...good, examHeld: "2025-03" })).toBe("A Mar 2025 exam is before 2025-26, when batch 2024-2028 is in Year 2 - check the batch, year or date");
    expect(meta({ ...good, examHeld: "2026-07" }).academicYear).toBe("2025-26"); // a late exam is fine
  });

  it("a Supplementary needs its exam and takes the academic year of its date", () => {
    expect(err({ ...good, examType: "SUPPLEMENTARY" })).toBe("Choose the exam this supplementary is for");
    expect(meta({ ...good, examType: "SUPPLEMENTARY", examHeld: "2026-05", targetBatchId: "reg" })).toMatchObject({ targetBatchId: "reg", academicYear: "2025-26" });
  });

  it("a Revaluation needs its exam and nothing else - date and year come from that exam", () => {
    expect(err({ ...good, examType: "REVALUATION", examHeld: "" })).toBe("Choose the exam being revalued");
    expect(meta({ ...good, examType: "REVALUATION", examHeld: "", targetBatchId: "reg" })).toMatchObject({ targetBatchId: "reg", examHeld: "" });
  });
});

describe("completeFromTarget", () => {
  const base: ResultBatchMeta = {
    courseKey: "cat1", courseName: "B.Tech", courseIds: ["c1"], department: "CSE", departmentId: "d1", regulation: "R23", batch: "2024-2028",
    year: 2, semester: 3, examType: "SUPPLEMENTARY", examHeld: "2026-05", academicYear: "2025-26", targetBatchId: "reg",
  };
  const target: TargetExam = { status: "PUBLISHED", courseKey: "cat1", batch: "2024-2028", departmentId: "d1", year: 2, semester: 3, examType: "REGULAR", examHeld: "2025-11", academicYear: "2025-26" };
  const err = (m: ResultBatchMeta, t: TargetExam | null) => (completeFromTarget(m, t) as { error: string }).error;

  it("accepts a supplementary held after its exam", () => {
    expect(completeFromTarget(base, target)).toEqual({ meta: base });
  });

  it("refuses an unpublished, mismatched or same-month exam", () => {
    expect(err(base, null)).toBe("The picked exam was not found");
    expect(err(base, { ...target, status: "DRAFT" })).toBe("The picked exam is not published yet - publish it first");
    expect(err(base, { ...target, examType: "REVALUATION" })).toBe("Pick a Regular or Supplementary exam");
    expect(err(base, { ...target, batch: "2023-2027" })).toBe("The picked exam is for a different course, batch, branch, year or semester");
    expect(err({ ...base, examHeld: "2025-11" }, target)).toBe("A supplementary must be held after the exam it re-sits (Nov 2025)");
  });

  it("completes a revaluation from its exam", () => {
    const rv = { ...base, examType: "REVALUATION" as const, examHeld: "", academicYear: "" };
    expect((completeFromTarget(rv, { ...target, examType: "SUPPLEMENTARY", examHeld: "2026-05", academicYear: "2025-26" }) as { meta: ResultBatchMeta }).meta)
      .toMatchObject({ examHeld: "2026-05", academicYear: "2025-26", revaluationOf: "SUPPLEMENTARY" });
  });
});

describe("sub-department", () => {
  const ctx = { currentMonth: "2026-10", academicYearOfMonth: () => "2025-26" };
  const good = { courseKey: "cat1", courseName: "B.Tech", courseIds: ["c1"], department: "CSE", departmentId: "d1", regulation: "R23", batch: "2024-2028", year: 2, semester: 3, examType: "REGULAR", examHeld: "2025-11" };
  it("is optional, and goes into the title when picked", () => {
    expect(normalizeBatchMeta(good, ctx)).not.toHaveProperty("meta.subDepartment");
    const m = (normalizeBatchMeta({ ...good, subDepartment: "CSE - AI&ML", subDepartmentId: "d9" }, ctx) as { meta: ResultBatchMeta }).meta;
    expect(batchTitle(m)).toBe("B.Tech · CSE · CSE - AI&ML · R23 · 2024-2028 · Year 2 · Semester 3 · Regular · Nov 2025");
  });
  it("a sub-department sheet may pick the whole branch's exam, not another sub-department's", () => {
    const target: TargetExam = { status: "PUBLISHED", courseKey: "cat1", batch: "2024-2028", departmentId: "d1", year: 2, semester: 3, examType: "REGULAR", examHeld: "2025-11", academicYear: "2025-26" };
    const sup: ResultBatchMeta = { ...(good as unknown as ResultBatchMeta), year: 2, examType: "SUPPLEMENTARY", examHeld: "2026-05", academicYear: "2025-26", subDepartment: "AI", subDepartmentId: "d9", targetBatchId: "t" };
    expect(completeFromTarget(sup, target)).toEqual({ meta: sup });
    expect(completeFromTarget(sup, { ...target, subDepartmentId: "d8" })).toEqual({ error: "The picked exam is for a different course, batch, branch, year or semester" });
  });
});

describe("labels", () => {
  it("titles a sheet with its batch and exam month", () => {
    const m: ResultBatchMeta = {
      courseKey: "cat1", courseName: "Bachelor of Technology", courseIds: ["c1"], department: "CSE", departmentId: "d1", regulation: "R23",
      batch: "2024-2028", year: 2, semester: 3, examType: "REVALUATION", revaluationOf: "SUPPLEMENTARY", examHeld: "2026-05", academicYear: "2025-26",
    };
    expect(batchTitle(m)).toBe("Bachelor of Technology · CSE · R23 · 2024-2028 · Year 2 · Semester 3 · Revaluation of Supplementary · May 2026");
    expect(examHeldLabel("2026-11")).toBe("Nov 2026");
    expect(examHeldLabel("bad")).toBe("");
  });
});
