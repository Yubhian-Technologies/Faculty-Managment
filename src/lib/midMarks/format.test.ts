import { describe, expect, it } from "vitest";
import { paperTotal, partTotal, questionMarksError } from "@/lib/exams/questionMarks";
import { cleanComponents, cleanSectionQuestions, coPendingCount, formatLine, keepCos, questionsFromHeaders, sameComponents, sheetFromFormat } from "./format";
import { parseWorkbook, planFile, type RawWorkbook } from "./fileUpload";
import { applyEntries, entryTotal, isComplete, notAttemptedFilled, partMarks } from "./sheet";
import type { MidFormatComponent, MidMarksEntry, MidSectionQuestion } from "@/types/midMarks";

// The Mid exam format as VWU's Exam Cell keeps its Mid marks files (R26, I B.Tech I Sem, Mid 1): a Descriptive
// paper of 6 questions x 10 in OR pairs (30), a 20-item Quiz scaled to 10, and a Course Activity out of 10.
// Engineering Drawing has Descriptive 30 + Day to Day Work 20. Rows below are real mark patterns, de-identified.

const VWU = (() => {
  const r = cleanComponents([
    { name: "Descriptive", kind: "QUESTIONS", questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" } },
    { name: "Quiz", kind: "ITEMS", items: 20, itemMarks: 1, max: 10 },
    { name: "Course Activity", kind: "MARK", max: 10 },
  ]);
  if ("error" in r) throw new Error(r.error);
  return r.components;
})();

const q = (labels: string[]): MidSectionQuestion[] => {
  const r = questionsFromHeaders(labels);
  if ("error" in r) throw new Error(r.error);
  return r.questions;
};

describe("Mid exam format", () => {
  it("works out each component's max and the total", () => {
    expect(VWU.map((c) => [c.id, c.max])).toEqual([["P1", 30], ["P2", 10], ["P3", 10]]);
    expect(formatLine(VWU)).toBe("Descriptive 30 + Quiz 10 + Course Activity 10 = 50");
  });

  it("refuses bad formats", () => {
    expect(cleanComponents([])).toEqual({ error: expect.stringContaining("at least one") });
    expect(cleanComponents([{ name: "D", kind: "QUESTIONS", questions: 5, marksEach: 10, choice: { kind: "OR_PAIRS" } }])).toEqual({ error: expect.stringContaining("even") });
    expect(cleanComponents([{ name: "A", kind: "MARK", max: 10 }, { name: "a", kind: "MARK", max: 5 }])).toEqual({ error: expect.stringContaining("twice") });
    expect(cleanComponents([{ name: "D", kind: "QUESTIONS", questions: 6, marksEach: 5, choice: { kind: "ANY", answer: 4 } }])).toMatchObject({ components: [{ max: 20 }] });
  });

  it("compares components", () => {
    expect(sameComponents(VWU, VWU.map((c) => ({ ...c })))).toBe(true);
    expect(sameComponents(VWU, VWU.slice(0, 2))).toBe(false);
  });
});

describe("questions from the file's headings", () => {
  it("reads parts", () => {
    expect(q(["Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6"]).map((x) => x.parts.join(""))).toEqual(["", "", "", "", "AB", ""]);
    expect(q(["Q1(A)", "Q1(B)", "Q2(A)", "Q2(B)", "Q2(C)", "Q3", "Q4(A)", "Q4(B)", "Q5(A)", "Q5(B)", "Q6(A)", "Q6(B)"]).map((x) => x.parts.length)).toEqual([2, 3, 0, 2, 2, 2]);
    expect(q(["1", "2a", "2 (b)", "3"]).map((x) => x.parts.join(""))).toEqual(["", "AB", ""]);
  });

  it("refuses broken headings", () => {
    expect(questionsFromHeaders(["Q1", "Q3"])).toEqual({ error: expect.stringContaining("in order") });
    expect(questionsFromHeaders(["Q1", "Q1"])).toEqual({ error: expect.stringContaining("twice") });
    expect(questionsFromHeaders(["Q1(A)", "Q2", "Q1(B)"])).toEqual({ error: expect.stringContaining("next to each other") });
    expect(questionsFromHeaders(["Q1(A)"])).toEqual({ error: expect.stringContaining("only part") });
    expect(questionsFromHeaders(["Q1(A)", "Q1(C)"])).toEqual({ error: expect.stringContaining("in order") });
    expect(questionsFromHeaders(["Marks"])).toEqual({ error: expect.stringContaining("isn't a question heading") });
  });
});

describe("format sheet totals (match the files' Total columns)", () => {
  // UG26BS1T04: Q1 Q2 Q3 Q4 Q5(A) Q5(B) Q6
  const sheet = sheetFromFormat({ components: VWU, questions: { P1: q(["Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6"]) } });
  const desc = sheet.parts[0];
  const v = (marks: (number | null)[]) => Object.fromEntries(desc.keys!.map((k, i) => [k, marks[i]]));

  it("adds parts into their question, then takes the better of each OR pair", () => {
    expect(partTotal(desc, v([2, 10, 8, 10, 5, 5, 10]))).toBe(30);
    expect(partTotal(desc, v([10, 10, 10, 10, 5, 5, null]))).toBe(30);
    expect(partTotal(desc, v([8, 6, null, 9, null, null, 10]))).toBe(27);
    expect(partTotal(desc, v([1, 2, null, 3, 1, 0, null]))).toBe(6);
    expect(partTotal(desc, v([null, null, null, null, null, null, null]))).toBeNull();
  });

  it("scales the quiz half up", () => {
    const quiz = sheet.parts[1];
    const items = (n: number) => Object.fromEntries(quiz.keys!.map((k, i) => [k, i < n ? 1 : 0]));
    expect([19, 18, 14, 15, 10, 0].map((n) => partTotal(quiz, items(n)))).toEqual([10, 9, 7, 8, 5, 0]);
  });

  it("refuses parts adding up to more than the question", () => {
    expect(questionMarksError(sheet, { ...v([null, null, null, null, 6, 5, null]) })).toMatch(/Q5\(A\) \+ Q5\(B\) add up to 11/);
    expect(questionMarksError(sheet, { ...v([null, null, null, null, 5, 5, null]) })).toBeNull();
  });

  it("totals the paper", () => {
    expect(sheet.paperMax).toBe(50);
    const all = { ...v([2, 10, 8, 10, 5, 5, 10]), ...Object.fromEntries(sheet.parts[1].keys!.map((k) => [k, 1])), P3: 9 };
    expect(paperTotal(sheet, all)).toBe(49);
  });

  it("counts CO pending boxes and keeps COs on the same questions", () => {
    expect(coPendingCount({ components: VWU, questions: { P1: q(["Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6"]) } })).toBe(7);
    const withCos = cleanSectionQuestions(VWU[0], q(["Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6"]).map((x, i) => ({ ...x, cos: x.cos.map(() => `co${1 + Math.floor(i / 2)}`) })));
    if ("error" in withCos) throw new Error(withCos.error);
    expect(withCos.questions[4].cos).toEqual(["CO3", "CO3"]);
    expect(coPendingCount({ components: VWU, questions: { P1: withCos.questions } })).toBe(0);
    const again = keepCos(q(["Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6"]), withCos.questions);
    expect(again[0].cos).toEqual(["CO1"]);
    expect(keepCos(q(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]), withCos.questions)[0].cos).toEqual([null]);
    const s = sheetFromFormat({ components: VWU, questions: { P1: withCos.questions } });
    expect(s.columns.find((c) => c.label === "Q5(B)")?.co).toBe("CO3");
  });
});

describe("format sheet entries", () => {
  const sheet = sheetFromFormat({ components: VWU, questions: { P1: q(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"]) } });
  const blank = (): MidMarksEntry => ({ studentId: "s1", rollNumber: "R1", name: "N", q: Object.fromEntries(sheet.columns.map((c) => [c.key, null])), total: null });

  it("needs every component (or AB)", () => {
    const e = blank();
    e.q.P1q1 = 10;
    expect(isComplete(sheet, e)).toBe(false);
    e.q.P2i1 = 1;
    expect(isComplete(sheet, e)).toBe(false);
    expect(isComplete(sheet, { ...e, abParts: ["P3"] })).toBe(true);
    e.q.P3 = 10;
    expect(isComplete(sheet, e)).toBe(true);
    expect(entryTotal(sheet, e)).toBe(10 + 1 + 10); // quiz 1/20 -> 0.5 -> 1
  });

  it("takes AB per component and AB everywhere = absent", () => {
    const [x] = applyEntries(sheet, [blank()], [{ studentId: "s1", abParts: ["P1", "P2"], q: { P3: 0 } }]);
    expect(x).toMatchObject({ abParts: ["P1", "P2"], total: 0 });
    expect(partMarks(sheet, x)).toEqual({ P1: "AB", P2: "AB", P3: 0 });
    const [y] = applyEntries(sheet, [blank()], [{ studentId: "s1", abParts: ["P1", "P2", "P3"] }]);
    expect(y.absent).toBe(true);
    expect(y.abParts).toBeUndefined();
  });

  it("fills empty boxes as not attempted on submit, not in AB parts", () => {
    const e = { ...blank(), abParts: ["P3"] };
    e.q.P1q1 = 5;
    e.q.P2i1 = 1;
    const [f] = notAttemptedFilled(sheet, [e]);
    expect(f.q.P1q2).toBe("NA");
    expect(f.q.P3).toBeNull();
  });
});

describe("upload file", () => {
  const head = ["Student Registration No", "Name", "Subject Code", "Subject Name"];
  const items = (n: number) => Array.from({ length: 20 }, (_, i) => (i < n ? 1 : 0));
  const wb = (desc: unknown[][], quiz: unknown[][], act: unknown[][]): RawWorkbook => ({
    fileName: "UG26XX1T01_Mid1_marks.xlsx",
    sheets: [
      { name: "Descriptive", rows: [[...head, "Q1", "Q2", "Q3", "Q4", "Q5(A)", "Q5(B)", "Q6", "Total (30)"], ...desc] },
      { name: "Quiz", rows: [[...head, ...Array.from({ length: 20 }, (_, i) => `Q${i + 1}`), "Total (10)"], ...quiz] },
      { name: "Course Activity", rows: [[...head, "Course Activity (10)"], ...act] },
    ],
  });
  const row = (roll: string, cells: unknown[]) => [roll, "Name", "UG26XX1T01", "Subject", ...cells];

  it("reads a good file", () => {
    const p = parseWorkbook(wb(
      [row("R1", [2, 10, 8, 10, 5, 5, 10, 30]), row("R2", ["AB", "AB", "AB", "AB", "AB", "AB", "AB", "AB"]), row("R3", [0, "-", "-", 0, 0, 0, 0, 0])],
      [row("R1", [...items(19), 10]), row("R2", [...Array(20).fill("AB"), "AB"]), row("R3", [...items(4), 2])],
      [row("R1", [10]), row("R2", ["AB"]), row("R3", [7])],
    ));
    if ("error" in p) throw new Error(p.error);
    expect(p.subjectCode).toBe("UG26XX1T01");
    const plan = planFile(p, VWU);
    expect(plan.errors).toEqual([]);
    expect(plan.students.map((s) => [s.roll, s.absent, s.totals])).toEqual([
      ["R1", false, { P1: 30, P2: 10, P3: 10 }],
      ["R2", true, { P1: "AB", P2: "AB", P3: "AB" }],
      ["R3", false, { P1: 0, P2: 2, P3: 7 }],
    ]);
    expect(plan.students[2].q.P1q2).toBe("NA");
    expect(coPendingCount({ components: VWU, questions: plan.questions })).toBe(7);
  });

  it("lists every problem", () => {
    const p = parseWorkbook(wb(
      [row("R1", [2, 10, 8, 10, 5, 5, 10, 29]), row("R2", [11, "-", "-", "-", "-", "-", "-", 11]), row("R3", ["AB", 5, "-", "-", "-", "-", "-", 5])],
      [row("R1", [...items(19), 10]), row("R2", [...items(1), 1]), row("R3", [...items(2), 1])],
      [row("R1", [10]), row("R2", [10]), row("R3", ["x"])],
    ));
    if ("error" in p) throw new Error(p.error);
    const { errors, students } = planFile(p, VWU);
    expect(students).toEqual([]);
    expect(errors.join("\n")).toMatch(/R1: Descriptive total in the file is 29, the marks add up to 30/);
    expect(errors.join("\n")).toMatch(/R2: Descriptive Q1 is 11 \(0 to 10\)/);
    expect(errors.join("\n")).toMatch(/R3: "Descriptive" has AB with marks; Course Activity Course Activity is not a number/);
  });

  it("checks the sheets against the format", () => {
    const p = parseWorkbook({ fileName: "x.xlsx", sheets: [{ name: "Descriptive", rows: [[...head, "Q1", "Q2", "Total (25)"], row("R1", [5, 5, 10])] }] });
    if ("error" in p) throw new Error(p.error);
    const { errors } = planFile(p, VWU);
    expect(errors).toEqual([
      '"Descriptive" is out of 25; the format has Descriptive out of 30.',
      'No "Quiz" sheet in the file.',
      'No "Course Activity" sheet in the file.',
      '"Descriptive" has 2 questions; the format has 6.',
    ]);
  });

  it("matches a subject's own format (Engineering Drawing)", () => {
    const own = cleanComponents([
      { name: "Descriptive", kind: "QUESTIONS", questions: 6, marksEach: 10, choice: { kind: "OR_PAIRS" } },
      { name: "Day to Day Work", kind: "MARK", max: 20 },
    ]) as { components: MidFormatComponent[] };
    const p = parseWorkbook({ fileName: "UG26ME1T02_Mid1_marks.xlsx", sheets: [
      { name: "Descriptive", rows: [[...head, "Q1", "Q2(A)", "Q2(B)", "Q3", "Q4(A)", "Q4(B)", "Q5(A)", "Q5(B)", "Q6", "Total (30)"], row("R1", ["-", 4, 5, "-", 5, 5, 5, 5, 10, 29])] },
      { name: "Day to Day work", rows: [[...head, "Day to Day work (20)"], row("R1", [19])] },
    ] });
    if ("error" in p) throw new Error(p.error);
    const plan = planFile(p, own.components);
    expect(plan.errors).toEqual([]);
    expect(plan.students[0].totals).toEqual({ P1: 29, P2: 19 });
  });
});
