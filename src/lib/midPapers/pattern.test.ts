import { describe, expect, it } from "vitest";
import { answeredCount, choiceText, cleanPaperQuestion, cleanPattern, paperProgress, paperQuestionErrors, partMax, patternMax, questionSlots } from "./pattern";
import type { PaperPartDef } from "@/types";

const partA: PaperPartDef = { id: "A", label: "Part A", title: "Choose the correct answer", kind: "MCQ", questions: 10, marksEach: 1, choice: { kind: "ALL" }, options: 4 };
const partB: PaperPartDef = { id: "B", label: "Part B", title: "Descriptive", kind: "DESCRIPTIVE", questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" }, maxSubParts: 2 };

describe("paper pattern", () => {
  it("works out the max marks from the answered questions", () => {
    expect(partMax(partA)).toBe(10);
    expect(answeredCount(partB)).toBe(3);
    expect(patternMax({ parts: [partA, partB] })).toBe(40);
    expect(partMax({ questions: 8, marksEach: 5, choice: { kind: "ANY", answer: 5 } })).toBe(25);
    expect(choiceText(partB)).toMatch(/each pair/);
  });

  it("refuses bad patterns", () => {
    expect(cleanPattern({ setsPerFaculty: 0, durationMinutes: 90, parts: [] }).errors).toEqual(expect.arrayContaining([expect.stringMatching(/1 to 5/), expect.stringMatching(/at least one part/)]));
    const odd = cleanPattern({ setsPerFaculty: 2, durationMinutes: 90, parts: [{ ...partB, questions: 5 }] });
    expect(odd.errors).toEqual([expect.stringMatching(/even/)]);
    const any = cleanPattern({ setsPerFaculty: 2, durationMinutes: 90, parts: [{ ...partB, choice: { kind: "ANY", answer: 6 } }] });
    expect(any.errors).toEqual([expect.stringMatching(/fewer/)]);
    const ok = cleanPattern({ setsPerFaculty: 2, durationMinutes: 90, parts: [partA, partB] });
    expect(ok.errors).toEqual([]);
    expect(ok.value.parts.map((p) => p.id)).toEqual(["A", "B"]);
  });

  it("lists every question of every set", () => {
    const slots = questionSlots({ parts: [partA, partB], setsPerFaculty: 2 });
    expect(slots).toHaveLength(32);
    expect(slots[0]).toEqual({ set: 1, partId: "A", no: 1, id: "1_A_1" });
    expect(slots.at(-1)!.id).toBe("2_B_6");
  });
});

describe("paper questions", () => {
  const sw = { cos: false, poMapping: false, bloom: false };
  it("an MCQ needs every option, distinct, and the answer", () => {
    const q = cleanPaperQuestion({ text: "2+2?", options: ["3", "4", "5", ""], answer: 1 }, partA, new Set());
    expect(paperQuestionErrors(q, partA, sw)).toEqual(["Fill every option"]);
    const ok = cleanPaperQuestion({ text: "2+2?", options: ["3", "4", "5", "6"], answer: 1 }, partA, new Set());
    expect(paperQuestionErrors(ok, partA, sw)).toEqual([]);
    expect(paperQuestionErrors(cleanPaperQuestion({ text: "x", options: ["1", "1", "2", "3"], answer: 0 }, partA, new Set()), partA, sw)).toEqual(["Two options are the same"]);
  });

  it("descriptive sub-parts must add up to the question's marks; COs / Bloom only when used", () => {
    const q = cleanPaperQuestion({ subParts: [{ text: "a", marks: 6 }, { text: "b", marks: 3 }] }, partB, new Set(["CO1"]));
    expect(paperQuestionErrors(q, partB, sw)).toEqual(["Parts must add up to 10 marks (now 9)"]);
    const full = cleanPaperQuestion({ text: "Explain", cos: ["CO1", "CO9"], bloom: "L3" }, partB, new Set(["CO1"]));
    expect(full.cos).toEqual(["CO1"]);
    expect(paperQuestionErrors(full, partB)).toEqual([]);
    expect(paperQuestionErrors(cleanPaperQuestion({ text: "Explain" }, partB, new Set()), partB)).toEqual(["Pick at least one Course Outcome", "Pick the Bloom's level"]);
  });

  it("fill in the blanks needs a blank and its answer", () => {
    const part: PaperPartDef = { ...partA, kind: "FILL_BLANK", options: undefined };
    expect(paperQuestionErrors(cleanPaperQuestion({ text: "Water boils at" }, part, new Set()), part, sw)).toEqual(["Mark the blank with ____ (four underscores)", "Give the answer"]);
    expect(paperQuestionErrors(cleanPaperQuestion({ text: "Water boils at ____ C", answer: "100" }, part, new Set()), part, sw)).toEqual([]);
  });

  it("progress per set", () => {
    const pat = { parts: [partA, partB], setsPerFaculty: 2 };
    const done = Array.from({ length: 16 }, () => ({ set: 1, state: "COMPLETE" as const }));
    const p = paperProgress(pat, [...done, { set: 2, state: "DRAFT" }]);
    expect(p.setProgress).toEqual({ "1": { complete: 16, total: 16 }, "2": { complete: 0, total: 16 } });
    expect(p).toMatchObject({ completeCount: 16, totalCount: 32, allComplete: false });
  });
});
