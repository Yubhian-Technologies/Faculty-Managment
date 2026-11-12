import { describe, expect, it } from "vitest";
import { CEA_PART_ID, ceaPart, midMinutes, withCeaPart, withoutCea } from "./paper";
import { patternMax, unitOfQuestion } from "@/lib/midPapers/pattern";
import { defaultPartHeaders } from "@/lib/midPapers/printLayout";
import { paperSetHtmls } from "@/lib/pdf/midPaperSetTemplate";
import type { MidPaperQuestion, PaperPartDef } from "@/types";

const partA: PaperPartDef = { id: "A", label: "Part A", title: "Objective", kind: "MCQ", questions: 2, marksEach: 1, choice: { kind: "ALL" }, options: 4 };
const partB: PaperPartDef = { id: "B", label: "Part B", title: "Descriptive", kind: "DESCRIPTIVE", questions: 2, marksEach: 10, choice: { kind: "OR_PAIRS" } };
const P = { unitMarks: 10, paperMinutes: 20 };
const cea = ceaPart(P, 3);
const pattern = withCeaPart({ parts: [partA, partB], durationMinutes: 90, instruction: "", regdBoxes: 10 }, cea);

describe("the CEA paper inside a Mid paper set", () => {
  it("is one unit's part, last, with its own minutes; replaced, never doubled", () => {
    // Only the max marks are fixed - the setter decides the questions and their marks.
    expect(cea).toMatchObject({ id: CEA_PART_ID, label: "CEA - Unit 3", flexible: true, maxMarks: 10, choice: { kind: "ALL" }, cea: { unit: 3, minutes: 20 } });
    expect([1, 7].map((n) => unitOfQuestion(cea, [1, 2], n))).toEqual([3, 3]);
    expect(pattern.parts.map((p) => p.id)).toEqual(["A", "B", "CEA"]);
    expect(withCeaPart(pattern, ceaPart(P, 4)).parts.map((p) => p.label)).toEqual(["Part A", "Part B", "CEA - Unit 4"]);
    expect(withCeaPart(pattern, null).parts.map((p) => p.id)).toEqual(["A", "B"]);
  });
  it("the Mid's marks and time leave the CEA paper out (90 = 70 Mid + 20 CEA)", () => {
    expect(patternMax(pattern)).toBe(2 + 10);
    expect(midMinutes(pattern)).toBe(70);
    expect(withoutCea(pattern).parts).toHaveLength(2);
    expect(defaultPartHeaders(pattern.parts, 90)).toEqual([
      { partId: "A", durationMinutes: 70, maxMarks: 2 }, { partId: "B", durationMinutes: 70, maxMarks: 10 }, { partId: "CEA", durationMinutes: 20, maxMarks: 10 },
    ]);
  });
  it("prints as two papers: the Mid (70 min) and the CEA paper (20 min, 10 marks, numbered 1a, 1b ...)", () => {
    const q = (partId: string, no: number, text: string, marks?: number) => ({ id: `1_${partId}_${no}`, set: 1, partId, no, text, cos: [], bloom: "", state: "COMPLETE", options: ["1", "2", "3", "4"], ...(marks ? { kind: "SHORT", marks } : {}) }) as unknown as MidPaperQuestion;
    const pages = paperSetHtmls({
      college: { name: "VWU" }, exam: { courseName: "B.Tech", year: 1, semester: 1, midNumber: 1 }, subject: { name: "Maths", code: "MA101", regulation: "R26" },
      branch: "CSE", sections: [], pattern, set: 1, outcomes: { cos: false, poMapping: false, bloom: false },
      questions: [q("A", 1, "ALPHA"), q("B", 1, "GAMMA"), q("CEA", 1, "CEAQ1", 6), q("CEA", 2, "CEAQ2", 4)],
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("ALPHA");
    expect(pages[0]).not.toContain("CEAQ1");
    expect(pages[0]).toContain("Time: <b>70 Mins.</b>");
    expect(pages[0]).toContain("Max. Marks: <b>12</b>");
    expect(pages[1]).toContain("CEAQ1");
    expect(pages[1]).not.toContain("ALPHA");
    expect(pages[1]).toContain("Time: <b>20 Mins.</b>");
    expect(pages[1]).toContain("Max. Marks: <b>10</b>");
    // Heading: "I B.Tech. SEMESTER-1" (no "Continuous Evaluation" line); the Mid paper keeps its own.
    expect(pages[1]).toContain("I B.Tech. SEMESTER-1</p>");
    expect(pages[1]).not.toContain("CONTINUOUS EVALUATION (WITH");
    expect(pages[0]).toContain("I B.Tech. SEMESTER-1 MID EXAMINATION-1</p>");
    // PO / PSO column only when the Exam Cell prints POs (Mid Configuration).
    const withPo = (printPo: boolean) => paperSetHtmls({
      college: { name: "VWU", printPo }, exam: { courseName: "B.Tech", year: 1, semester: 1, midNumber: 1 }, subject: { name: "Maths", code: "MA101", regulation: "R26" },
      branch: "CSE", sections: [], pattern, set: 1, outcomes: { cos: true, poMapping: true, bloom: true },
      questions: [q("A", 1, "ALPHA"), q("B", 1, "GAMMA"), q("CEA", 1, "CEAQ1", 6), q("CEA", 2, "CEAQ2", 4)],
    });
    expect(withPo(false).every((h) => !h.includes("colhead\">PO</td>"))).toBe(true);
    expect(withPo(true).every((h) => h.includes("colhead\">PO</td>"))).toBe(true);
    expect(pages[1]).toMatch(/<td class="no">1a<\/td><td class="q">CEAQ1/);
    expect(pages[1]).toMatch(/<td class="no">1b<\/td><td class="q">CEAQ2/);
  });
});

describe("plan changes after writing", () => {
  it("moving to a CEA paper for another unit drops (refuses) the old unit's questions; same unit keeps them", async () => {
    const { remapQuestions } = await import("@/lib/midPapers/pattern");
    const qs = [{ id: "1_CEA_1", set: 1, partId: "CEA", no: 1, unit: 3 }, { id: "1_A_1", set: 1, partId: "A", no: 1 }];
    const old = { ...pattern, setsPerFaculty: 1 };
    const same = remapQuestions(old, old, qs, [1, 2]);
    expect(same.dropped).toEqual([]);
    const moved = remapQuestions(old, { ...withCeaPart(pattern, ceaPart(P, 4)), setsPerFaculty: 1 }, qs, [1, 2]);
    expect(moved.dropped).toEqual(["1_CEA_1"]);
    expect(remapQuestions(old, { ...withCeaPart(pattern, null), setsPerFaculty: 1 }, qs, [1, 2]).dropped).toEqual(["1_CEA_1"]);
  });
  it("a hand-made 'own questions' part the Exam Cell removed moves into the CEA paper (its unit only); every refusal says why", async () => {
    const { remapQuestions } = await import("@/lib/midPapers/pattern");
    // Before: X = the Exam Cell's own 10-mark written part, M = 5 fixed questions. After: M per unit + the planned CEA (Unit 2).
    const X: PaperPartDef = { id: "X", label: "Written", title: "", kind: "DESCRIPTIVE", questions: 0, marksEach: 0, choice: { kind: "ALL" }, flexible: true, maxMarks: 10 };
    const M: PaperPartDef = { id: "M", label: "Mid", title: "", kind: "DESCRIPTIVE", questions: 5, marksEach: 5, choice: { kind: "ALL" } };
    const M2: PaperPartDef = { ...M, questions: 0, perUnit: 2, maxMarks: 25, unitLayout: [1, 1, 2, 2, 3] };
    const old = { parts: [X, M], setsPerFaculty: 1 };
    const now = { parts: withCeaPart({ parts: [M2] }, ceaPart(P, 2)).parts, setsPerFaculty: 1 };
    const qs = [
      { id: "1_X_1", set: 1, partId: "X", no: 1, unit: 2 }, { id: "1_X_2", set: 1, partId: "X", no: 2 }, { id: "1_X_3", set: 1, partId: "X", no: 3, unit: 1 },
      { id: "1_M_1", set: 1, partId: "M", no: 1, unit: 1 }, { id: "1_M_2", set: 1, partId: "M", no: 2 },
    ];
    const r = remapQuestions(old, now, qs, [1, 2, 3]);
    expect(r.moves).toEqual([{ from: "1_M_1", to: "1_M_1" }, { from: "1_X_1", to: "1_CEA_1" }, { from: "1_X_2", to: "1_CEA_2" }]);
    expect(r.dropped.sort()).toEqual(["1_M_2", "1_X_3"]);
    expect(r.reasons["1_X_3"]).toBe("Written now goes to the CEA paper on Unit 2 - this question is on Unit 1");
    expect(r.reasons["1_M_2"]).toBe("Mid now goes unit by unit - pick this question's unit");
  });
  it("the Exam Cell reshaped the parts (their written part 1 became the Mid part, part 2 removed): own questions -> CEA, fixed -> the Mid part", async () => {
    const { remapQuestions } = await import("@/lib/midPapers/pattern");
    const P1old: PaperPartDef = { id: "p1", label: "Continuous Internal Evalution", title: "", kind: "DESCRIPTIVE", questions: 0, marksEach: 0, choice: { kind: "ALL" }, flexible: true, maxMarks: 10 };
    const P2old: PaperPartDef = { id: "p2", label: "MID EXAMINATION", title: "", kind: "DESCRIPTIVE", questions: 5, marksEach: 5, choice: { kind: "ALL" } };
    const P1new: PaperPartDef = { id: "p1", label: "MID EXAMINATION", title: "", kind: "DESCRIPTIVE", questions: 0, marksEach: 5, choice: { kind: "ALL" }, perUnit: 2, maxMarks: 25, unitLayout: [1, 1, 2, 2, 3] };
    const old = { parts: [P1old, P2old], setsPerFaculty: 3 };
    const now = { parts: withCeaPart({ parts: [P1new] }, ceaPart(P, 2)).parts, setsPerFaculty: 3 };
    const qs = [
      ...[1, 2, 3, 4].map((no) => ({ id: `3_p1_${no}`, set: 3, partId: "p1", no, unit: 2 })),
      ...[1, 1, 2, 2, 3].map((unit, i) => ({ id: `3_p2_${i + 1}`, set: 3, partId: "p2", no: i + 1, unit })),
    ];
    const r = remapQuestions(old, now, qs, [1, 2, 3]);
    expect(r.dropped).toEqual([]);
    expect(r.moves).toEqual([
      { from: "3_p1_1", to: "3_CEA_1" }, { from: "3_p1_2", to: "3_CEA_2" }, { from: "3_p1_3", to: "3_CEA_3" }, { from: "3_p1_4", to: "3_CEA_4" },
      { from: "3_p2_1", to: "3_p1_1" }, { from: "3_p2_2", to: "3_p1_2" }, { from: "3_p2_3", to: "3_p1_3" }, { from: "3_p2_4", to: "3_p1_4" }, { from: "3_p2_5", to: "3_p1_5" },
    ]);
  });
});
