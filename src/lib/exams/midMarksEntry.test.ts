import { describe, expect, it } from "vitest";
import { cleanLayout, entryStateFor, sheetFromLayout } from "./midMarksEntry";
import { paperTotal, questionMarksError, scaleToComponent } from "./questionMarks";

describe("Exam Cell question layout", () => {
  it("cleans a layout; the paper max defaults to the questions added up", () => {
    const r = cleanLayout({ questions: [{ label: "Q1", max: 5 }, { label: "Q2", max: 5 }, { label: "Q3", max: 10 }] });
    expect(r).toEqual({ layout: { questions: [{ label: "Q1", max: 5 }, { label: "Q2", max: 5 }, { label: "Q3", max: 10 }], paperMax: 20 } });
  });

  it("refuses repeated labels, bad max marks and a paper max above the questions' total", () => {
    expect(cleanLayout({ questions: [{ label: "Q1", max: 5 }, { label: "q1", max: 5 }] })).toHaveProperty("error");
    expect(cleanLayout({ questions: [{ label: "Q1", max: 2.3 }] })).toHaveProperty("error");
    expect(cleanLayout({ questions: [{ label: "Q1", max: 5 }], paperMax: 6 })).toHaveProperty("error");
    expect(cleanLayout({ questions: [] })).toHaveProperty("error");
  });

  it("the sheet adds up what was entered, refuses a total above the paper max, and scales to the component", () => {
    const { layout } = cleanLayout({ questions: [{ label: "1a", max: 5 }, { label: "1b", max: 5 }, { label: "2", max: 10 }], paperMax: 15 }) as { layout: never };
    const sheet = sheetFromLayout(layout);
    expect(sheet.columns.map((c) => c.label)).toEqual(["1a", "1b", "2"]);
    expect(paperTotal(sheet, { L1: 4, L2: 3.5, L3: null })).toBe(7.5);
    expect(questionMarksError(sheet, { L1: 5, L2: 5, L3: 10 })).toMatch(/paper max/);
    expect(questionMarksError(sheet, { L1: 6 })).toMatch(/between 0 and 5/);
    expect(scaleToComponent(7.5, 15, 30)).toBe(15);
  });
});

describe("who enters a Mid", () => {
  it("faculty can enter only in FACULTY mode with a sheet; Exam Cell mode is read only", () => {
    expect(entryStateFor(1, "FACULTY", true, false).facultyCanEdit).toBe(true);
    expect(entryStateFor(1, "FACULTY", false, false)).toMatchObject({ facultyCanEdit: false, note: expect.stringMatching(/finalizes/) });
    expect(entryStateFor(1, "EXAM_CELL", true, true)).toMatchObject({ facultyCanEdit: false, lockedByExamCell: true });
    // Faculty mode, not yet opened by the Exam Cell after the exam.
    expect(entryStateFor(2, "FACULTY", true, false, false)).toMatchObject({ facultyCanEdit: false, note: expect.stringMatching(/Mid-2 marks entry/) });
  });
});
