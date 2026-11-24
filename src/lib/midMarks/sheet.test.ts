import { describe, expect, it } from "vitest";
import { applyEntries, completeCount, entryTotal, isComplete, MidMarksError, notAttemptedFilled, reconcileRoster, runningTotal, withinLastDate } from "./sheet";
import type { QuestionSheet } from "@/lib/exams/questionMarks";
import type { MidMarksEntry } from "@/types/midMarks";

// VIT's paper: Part A "MID", 5 descriptive questions x 5 marks, all compulsory = 25.
const vit: QuestionSheet = {
  paperMax: 25, source: "CHOSEN",
  parts: [{ id: "A", label: "MID", perQuestion: true, questions: 5, marksEach: 5, choice: { kind: "ALL" }, max: 25 }],
  columns: [1, 2, 3, 4, 5].map((n) => ({ key: `A${n}`, label: `A${n}`, max: 5, partId: "A" })),
};
// Three OR pairs of 10: the better of each pair counts (out of 30).
const orPairs: QuestionSheet = {
  paperMax: 30, source: "CHOSEN",
  parts: [{ id: "A", label: "Descriptive", perQuestion: true, questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" }, max: 30 }],
  columns: [1, 2, 3, 4, 5, 6].map((n) => ({ key: `A${n}`, label: `Q${n}`, max: 10, partId: "A" })),
};
const blank = (sheet: QuestionSheet, id = "s1"): MidMarksEntry => ({ studentId: id, rollNumber: `R-${id}`, name: id, q: Object.fromEntries(sheet.columns.map((c) => [c.key, null])), total: null });

describe("Mid marks sheet", () => {
  it("is complete once any box has a mark or '-' (empty = not attempted), or the student is absent", () => {
    expect(isComplete(vit, { q: {} })).toBe(false);
    expect(isComplete(vit, { q: { A1: null } })).toBe(false);
    expect(isComplete(vit, { q: { A1: 5, A2: 4, A3: "NA", A4: 3 } })).toBe(true);
    expect(isComplete(vit, { q: { A1: 5, A2: 4, A3: "NA", A4: 3, A5: 0 } })).toBe(true);
    expect(isComplete(vit, { absent: true, q: {} })).toBe(true);
  });

  it("adds the paper up, '-' counting 0, never scaled", () => {
    expect(entryTotal(vit, { q: { A1: 5, A2: 4.5, A3: "NA", A4: 3, A5: 2 } })).toBe(14.5);
    expect(entryTotal(vit, { q: { A1: 5 } })).toBe(5);
    expect(entryTotal(vit, { q: {} })).toBeNull();
    expect(entryTotal(vit, { absent: true, q: {} })).toBe(0);
    expect(runningTotal(vit, { q: { A1: 5, A2: 4 } })).toBe(9);
  });

  it("takes the better question of each OR pair", () => {
    expect(entryTotal(orPairs, { q: { A1: 10, A2: "NA", A3: 4, A4: 7, A5: "NA", A6: "NA" } })).toBe(17);
  });

  it("applies the browser's rows: '-' stored as NA, absent clears the boxes, totals worked out here", () => {
    const out = applyEntries(vit, [blank(vit, "a"), blank(vit, "b"), blank(vit, "c")], [
      { studentId: "a", q: { A1: "5", A2: "-", A3: 3, A4: 2, A5: 1 } },
      { studentId: "b", absent: true, q: { A1: 5 } },
      { studentId: "zz", q: { A1: 5 } },
    ]);
    expect(out[0].q.A2).toBe("NA");
    expect(out[0].total).toBe(11);
    expect(out[1]).toMatchObject({ absent: true, total: 0 });
    expect(out[1].q.A1).toBeNull();
    expect(out[2].total).toBeNull();
    expect(completeCount(vit, out)).toBe(2);
    const filled = notAttemptedFilled(vit, out);
    expect(filled[2].q.A1).toBeNull();
    expect(notAttemptedFilled(vit, applyEntries(vit, [blank(vit, "d")], [{ studentId: "d", q: { A1: 4 } }]))[0]).toMatchObject({ q: { A1: 4, A2: "NA", A5: "NA" }, total: 4 });
  });

  it("keeps boxes the browser didn't send", () => {
    const first = applyEntries(vit, [blank(vit, "a")], [{ studentId: "a", q: { A1: 5, A2: 4 } }]);
    const second = applyEntries(vit, first, [{ studentId: "a", q: { A3: 3 } }]);
    expect(second[0].q).toMatchObject({ A1: 5, A2: 4, A3: 3 });
  });

  it("refuses a mark above the question's max, negative, or not a half", () => {
    expect(() => applyEntries(vit, [blank(vit)], [{ studentId: "s1", q: { A1: 6 } }])).toThrow(MidMarksError);
    expect(() => applyEntries(vit, [blank(vit)], [{ studentId: "s1", q: { A1: -1 } }])).toThrow(/between 0 and 5/);
    expect(() => applyEntries(vit, [blank(vit)], [{ studentId: "s1", q: { A1: 2.3 } }])).toThrow(/half marks/);
  });

  it("re-lists the roster, keeping marks of students still on it", () => {
    const [a] = applyEntries(vit, [blank(vit, "a")], [{ studentId: "a", q: { A1: 5 } }]);
    const out = reconcileRoster(vit, [a], [{ id: "n", rollNumber: "1", name: "New" }, { id: "a", rollNumber: "2", name: "A" }]);
    expect(out.map((e) => e.studentId)).toEqual(["n", "a"]);
    expect(out[1].q.A1).toBe(5);
    expect(out[0].q.A1).toBeNull();
  });

  it("is open up to and including the last date", () => {
    expect(withinLastDate("2026-11-30", "2026-11-30")).toBe(true);
    expect(withinLastDate("2026-12-01", "2026-11-30")).toBe(false);
    expect(withinLastDate("2026-12-01", null)).toBe(true);
  });
});
