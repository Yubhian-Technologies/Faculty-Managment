import { describe, expect, it } from "vitest";
import { cleanQuestionValues, paperTotal, partTotal, questionMarksError, scaleToComponent, sheetFromPattern } from "./questionMarks";
import type { PaperPartDef } from "@/types";

const A: PaperPartDef = { id: "A", label: "Part A", title: "MCQ", kind: "MCQ", questions: 10, marksEach: 1, choice: { kind: "ALL" }, options: 4 };
const B: PaperPartDef = { id: "B", label: "Part B", title: "Descriptive", kind: "DESCRIPTIVE", questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" } };
const sheet = sheetFromPattern({ parts: [A, B] }, "PATTERN");

describe("marks per question", () => {
  it("one total column for an objective part, one per descriptive question", () => {
    expect(sheet.columns.map((c) => c.key)).toEqual(["A", "B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(sheet.columns[0].max).toBe(10);
    expect(sheet.paperMax).toBe(40);
  });

  it("OR pairs count the better answer of each pair; any-k the best k", () => {
    expect(partTotal(sheet.parts[1], { B1: 7, B2: 9, B4: 5, B5: 6 })).toBe(9 + 5 + 6);
    const any = sheetFromPattern({ parts: [{ ...B, questions: 5, choice: { kind: "ANY", answer: 3 } }] }, "PATTERN");
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
