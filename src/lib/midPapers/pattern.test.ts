import { describe, expect, it } from "vitest";
import { answeredCount, choiceText, cleanPaperQuestion, cleanPattern, flexibleProblem, paperProgress, paperQuestionErrors, partMax, patternMax, questionSlots, setNumbers, checkSetShare } from "./pattern";
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
    const done = Array.from({ length: 16 }, (_, i) => ({ set: 1, partId: i < 10 ? "A" : "B", no: i < 10 ? i + 1 : i - 9, state: "COMPLETE" as const }));
    const p = paperProgress(pat, [...done, { set: 2, partId: "A", no: 1, state: "DRAFT" }]);
    expect(p.setProgress).toEqual({ "1": { complete: 16, total: 16 }, "2": { complete: 0, total: 16 } });
    expect(p).toMatchObject({ completeCount: 16, totalCount: 32, allComplete: false });
  });
});

describe("faculty-decides parts", () => {
  const all: PaperPartDef = { id: "B", label: "Part B", title: "", flexible: true, maxMarks: 20, kind: "DESCRIPTIVE", questions: 0, marksEach: 0, choice: { kind: "ALL" } };
  it("the Exam Cell fixes the max marks and the choice", () => {
    expect(partMax(all)).toBe(20);
    expect(cleanPattern({ setsPerFaculty: 1, durationMinutes: 90, parts: [{ ...all, choice: { kind: "ANY", answer: 3 } }] }).errors).toEqual([expect.stringMatching(/divide by 3/)]);
    expect(cleanPattern({ setsPerFaculty: 1, durationMinutes: 90, parts: [all] }).value.parts[0]).toMatchObject({ flexible: true, maxMarks: 20 });
  });
  it("answer all: the questions add up to the max", () => {
    expect(flexibleProblem(all, [])).toMatch(/add questions/);
    expect(flexibleProblem(all, [{ marks: 5 }, { marks: 10 }])).toMatch(/15 of 20/);
    expect(flexibleProblem(all, [{ marks: 2 }, { marks: 8 }, { marks: 10 }])).toBe("");
  });
  it("OR pairs: equal marks per pair, one of each pair adds up to the max", () => {
    const or = { ...all, choice: { kind: "OR_PAIRS" as const } };
    expect(flexibleProblem(or, [{ marks: 10 }, { marks: 10 }, { marks: 10 }])).toMatch(/one more/);
    expect(flexibleProblem(or, [{ marks: 10 }, { marks: 8 }])).toMatch(/same marks/);
    expect(flexibleProblem(or, [{ marks: 10 }, { marks: 10 }, { marks: 10 }, { marks: 10 }])).toBe("");
  });
  it("any k: more than k questions, each max / k", () => {
    const any = { ...all, choice: { kind: "ANY" as const, answer: 2 } };
    expect(flexibleProblem(any, [{ marks: 10 }, { marks: 10 }])).toMatch(/more than 2/);
    expect(flexibleProblem(any, [{ marks: 10 }, { marks: 10 }, { marks: 5 }])).toMatch(/carries 10 marks/);
    expect(flexibleProblem(any, [{ marks: 10 }, { marks: 10 }, { marks: 10 }])).toBe("");
  });
  it("each question keeps its own kind and whole marks; a paper is complete only when the part fits", () => {
    const q = cleanPaperQuestion({ kind: "MCQ", marks: 2.6, text: "2+2?", options: ["3", "4", "5"], answer: 1 }, all, new Set());
    expect(q).toMatchObject({ kind: "MCQ", marks: 3, options: ["3", "4", "5"] });
    expect(paperQuestionErrors(q, all, { cos: false, poMapping: false, bloom: false })).toEqual([]);
    const pat = { parts: [all], setsPerFaculty: 1 };
    const qs = [{ set: 1, partId: "B", no: 1, marks: 10, state: "COMPLETE" as const }, { set: 1, partId: "B", no: 2, marks: 5, state: "COMPLETE" as const }];
    expect(paperProgress(pat, qs)).toMatchObject({ allComplete: false, completeCount: 2, totalCount: 2 });
    expect(paperProgress(pat, [...qs, { set: 1, partId: "B", no: 3, marks: 5, state: "COMPLETE" as const }]).allComplete).toBe(true);
  });
});

describe("per-unit parts", () => {
  const U = { id: "A", label: "Part A", title: "", kind: "SHORT" as const, questions: 0, marksEach: 5, choice: { kind: "ALL" as const }, perUnit: 1, maxMarks: 25 };
  it("the number of questions follows the Mid's units; the paper prints the real total", async () => {
    const { cleanPattern: clean, expandPattern, unitOfQuestion, countedMax, needsUnits, partMax: pm } = await import("./pattern");
    const c = clean({ setsPerFaculty: 1, durationMinutes: 90, parts: [U] });
    expect(c.errors).toEqual([]);
    expect(c.value.parts[0]).toMatchObject({ perUnit: 1, maxMarks: 25, questions: 0 });
    expect(needsUnits(c.value)).toBe(true);
    const six = expandPattern(c.value, [1, 2, 3, 4, 5, 6]);
    expect(six.parts[0].questions).toBe(6);
    expect(pm(six.parts[0])).toBe(30);
    expect(countedMax(six.parts[0])).toBe(25);
    const pairs = expandPattern({ parts: [{ ...U, perUnit: 2, choice: { kind: "OR_PAIRS" as const } }] }, [3, 4, 5]);
    expect(pairs.parts[0].questions).toBe(6);
    expect([1, 2, 3, 4, 5, 6].map((n) => unitOfQuestion(pairs.parts[0], [3, 4, 5], n))).toEqual([3, 3, 4, 4, 5, 5]);
    expect(clean({ setsPerFaculty: 1, durationMinutes: 90, parts: [{ ...U, choice: { kind: "OR_PAIRS" } }] }).errors).toEqual([expect.stringMatching(/even number of questions per unit/)]);
  });
});

describe("half units shared by two Mids", () => {
  it("a shared unit gets half its questions in each Mid", async () => {
    const { unitLayout, expandPattern, unitOfQuestion } = await import("./pattern");
    const p = { perUnit: 2, choice: { kind: "ALL" as const } };
    // 5-unit subject, 2½ units per Mid: Mid 1 = 1, 2, 3 and Mid 2 = 3, 4, 5 (unit 3 shared).
    expect(unitLayout(p, [1, 2, 3], [3])).toEqual([1, 1, 2, 2, 3]);
    expect(unitLayout(p, [3, 4, 5], [3])).toEqual([3, 4, 4, 5, 5]);
    // 6-unit subject, 3 per Mid: nothing shared.
    expect(unitLayout(p, [1, 2, 3])).toEqual([1, 1, 2, 2, 3, 3]);
    expect(unitLayout(p, [4, 5, 6])).toEqual([4, 4, 5, 5, 6, 6]);
    // One per unit: a shared unit still gets its question; OR pairs keep the pair.
    expect(unitLayout({ perUnit: 1, choice: { kind: "ALL" as const } }, [1, 2, 3], [3])).toEqual([1, 2, 3]);
    expect(unitLayout({ perUnit: 2, choice: { kind: "OR_PAIRS" as const } }, [1, 2, 3], [3])).toEqual([1, 1, 2, 2, 3, 3]);
    const pat = expandPattern({ parts: [{ id: "A", label: "Part A", title: "", kind: "SHORT" as const, questions: 0, marksEach: 5, choice: { kind: "ALL" as const }, perUnit: 2, maxMarks: 25 }] }, [3, 4, 5], [3]);
    expect(pat.parts[0].questions).toBe(5);
    expect([1, 2, 3, 4, 5].map((n) => unitOfQuestion(pat.parts[0], [3, 4, 5], n))).toEqual([3, 4, 4, 5, 5]);
  });
});

describe("updating a started paper to a newer pattern", () => {
  it("1 per unit -> 2 per unit keeps each question in its unit", async () => {
    const { remapQuestions, expandPattern } = await import("./pattern");
    const B = { id: "B", label: "Part B", title: "", kind: "SHORT" as const, questions: 0, marksEach: 5, choice: { kind: "ALL" as const }, perUnit: 1, maxMarks: 25 };
    const oldPat = { ...expandPattern({ parts: [B] }, [1, 2, 3], [3]), setsPerFaculty: 1 };
    const newPat = { ...expandPattern({ parts: [{ ...B, perUnit: 2 }] }, [1, 2, 3], [3]), setsPerFaculty: 1 };
    expect((newPat.parts[0] as { unitLayout?: number[] }).unitLayout).toEqual([1, 1, 2, 2, 3]);
    const qs = [{ id: "1_B_1", set: 1, partId: "B", no: 1, unit: 1 }, { id: "1_B_2", set: 1, partId: "B", no: 2, unit: 2 }, { id: "1_B_3", set: 1, partId: "B", no: 3, unit: 3 }];
    expect(remapQuestions(oldPat, newPat, qs, [1, 2, 3])).toEqual({ moves: [{ from: "1_B_1", to: "1_B_1" }, { from: "1_B_2", to: "1_B_3" }, { from: "1_B_3", to: "1_B_5" }], dropped: [] });
    // Back to 1 per unit: the second question of unit 1 has no place - refused, never lost.
    const two = [{ id: "1_B_1", set: 1, partId: "B", no: 1, unit: 1 }, { id: "1_B_2", set: 1, partId: "B", no: 2, unit: 1 }];
    expect(remapQuestions(newPat, oldPat, two, [1, 2, 3]).dropped).toEqual(["1_B_2"]);
  });
});

describe("papers shared among the setters", () => {
  it("a setter writes only their own papers", () => {
    expect(setNumbers({ setsPerFaculty: 3 })).toEqual([1, 2, 3]);
    expect(setNumbers({ setsPerFaculty: 3, sets: [2] })).toEqual([2]);
    expect(setNumbers({ setsPerFaculty: 3, sets: [3, 1, 9] })).toEqual([1, 3]);
  });
  it("every paper to exactly one setter, each setter at least one", () => {
    expect(checkSetShare({ a: [1], b: [2], c: [3] }, ["a", "b", "c"], 3)).toEqual({ value: { a: [1], b: [2], c: [3] }, errors: [] });
    expect(checkSetShare({ a: [1, 2], b: [3] }, ["a", "b"], 3).errors).toEqual([]);
    expect(checkSetShare({ a: [1], b: [1] }, ["a", "b"], 2).errors).toEqual(["Paper 1 is given to both a and b", "Paper 2 has no setter"]);
    expect(checkSetShare({ a: [1], b: [] }, ["a", "b"], 2).errors).toEqual(["Give b at least one paper", "Paper 2 has no setter"]);
    expect(checkSetShare({ a: [1, 4] }, ["a"], 1).errors).toEqual(["There is no Paper 4 - the subject has 1"]);
  });
});
