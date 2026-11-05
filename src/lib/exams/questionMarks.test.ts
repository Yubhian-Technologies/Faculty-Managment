import { describe, expect, it } from "vitest";
import { cleanQuestionValues, paperTotal, partTotal, questionMarksError, scaleToComponent, sheetFromPattern } from "./questionMarks";
import type { PaperPartDef } from "@/types";

const A: PaperPartDef = { id: "A", label: "Part A", title: "MCQ", kind: "MCQ", questions: 10, marksEach: 1, choice: { kind: "ALL" }, options: 4 };
const B: PaperPartDef = { id: "B", label: "Part B", title: "Descriptive", kind: "DESCRIPTIVE", questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" } };
const sheet = sheetFromPattern({ parts: [A, B] }, "PATTERN")!;

describe("marks per question", () => {
  it("a per-unit part is entered per question and scales to what it counts for", () => {
    const U: PaperPartDef = { id: "A", label: "Part A", title: "", kind: "SHORT", questions: 6, marksEach: 5, choice: { kind: "ALL" }, perUnit: 1, maxMarks: 25 };
    expect(sheetFromPattern({ parts: [{ ...U, questions: 0 }] }, "PATTERN")).toBeNull();
    const sh = sheetFromPattern({ parts: [U] }, "CHOSEN")!;
    expect(sh.columns).toHaveLength(6);
    expect(sh.paperMax).toBe(25);
    const t = paperTotal(sh, { A1: 5, A2: 5, A3: 4, A4: 4, A5: 4, A6: 4 })!; // 26 of 30
    expect(t).toBeCloseTo(21.667, 2);
    expect(scaleToComponent(t, 25, 25)).toBe(22);
    expect(scaleToComponent(t, 25, 10)).toBe(9); // 8.67
    const five = sheetFromPattern({ parts: [{ ...U, questions: 5 }] }, "CHOSEN")!; // 5 units x 5 = 25 -> 25, unchanged
    expect(paperTotal(five, { A1: 5, A2: 4, A3: 4, A4: 4, A5: 3 })).toBe(20);
  });

  it("a faculty-decides part is laid out from the chosen paper's own questions", () => {
    const F: PaperPartDef = { id: "B", label: "Part B", title: "", flexible: true, maxMarks: 20, kind: "DESCRIPTIVE", questions: 0, marksEach: 0, choice: { kind: "ALL" } };
    expect(sheetFromPattern({ parts: [A, F] }, "PATTERN")).toBeNull();
    const qs = [
      { set: 1, partId: "B", no: 1, kind: "MCQ" as const, marks: 2 }, { set: 1, partId: "B", no: 2, kind: "SHORT" as const, marks: 4 },
      { set: 1, partId: "B", no: 3, kind: "FILL_BLANK" as const, marks: 4 }, { set: 1, partId: "B", no: 4, kind: "DESCRIPTIVE" as const, marks: 10 },
    ];
    const sh = sheetFromPattern({ parts: [F] }, "CHOSEN", { set: 1, questions: qs })!;
    expect(sh.columns.map((c) => [c.key, c.max])).toEqual([["Bobj", 6], ["B2", 4], ["B4", 10]]);
    expect(paperTotal(sh, { Bobj: 5, B2: 3, B4: 8 })).toBe(16);
    const or = sheetFromPattern({ parts: [{ ...F, choice: { kind: "OR_PAIRS" } }] }, "CHOSEN", { set: 1, questions: qs.map((q) => ({ ...q, marks: 10 })) })!;
    expect(or.columns.map((c) => c.key)).toEqual(["B1", "B2", "B3", "B4"]);
    expect(paperTotal(or, { B1: 6, B2: 8, B4: 9 })).toBe(17);
  });

  it("one total column for an objective part, one per descriptive question", () => {
    expect(sheet.columns.map((c) => c.key)).toEqual(["A", "B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(sheet.columns[0].max).toBe(10);
    expect(sheet.paperMax).toBe(40);
  });

  it("OR pairs count the better answer of each pair; any-k the best k", () => {
    expect(partTotal(sheet.parts[1], { B1: 7, B2: 9, B4: 5, B5: 6 })).toBe(9 + 5 + 6);
    const any = sheetFromPattern({ parts: [{ ...B, questions: 5, choice: { kind: "ANY", answer: 3 } }] }, "PATTERN")!;
    expect(partTotal(any.parts[0], { B1: 4, B2: 9, B3: 6, B4: 8, B5: null })).toBe(9 + 8 + 6);
  });

  it("the paper total needs the objective total and some descriptive marks", () => {
    expect(paperTotal(sheet, { B1: 7 })).toBeNull();
    expect(paperTotal(sheet, { A: 8 })).toBeNull();
    expect(paperTotal(sheet, { A: 8, B1: 7, B3: 6, B6: 10 })).toBe(8 + 7 + 6 + 10);
  });

  it("scales to the component's maximum (nearest, half up) and checks each value", () => {
    expect(scaleToComponent(31, 40, 25)).toBe(19); // 19.375
    expect(scaleToComponent(30, 40, 25)).toBe(19); // 18.75
    expect(scaleToComponent(26, 40, 25)).toBe(16); // 16.25
    expect(scaleToComponent(20, 40, 40)).toBe(20);
    expect(questionMarksError(sheet, { B1: 11 })).toMatch(/between 0 and 10/);
    expect(questionMarksError(sheet, { A: 7.3 })).toMatch(/halves/);
    expect(cleanQuestionValues(sheet, { A: "8", B1: 5, X: 3 })).toEqual({ A: 8, B1: 5, B2: null, B3: null, B4: null, B5: null, B6: null });
  });
});
