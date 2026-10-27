import { describe, expect, it } from "vitest";
import type { BloomLevel, MidQuestion } from "@/types/midQuestionBank";
import { cleanOutcomes, derivePoPso, mappingErrors, outcomeConflicts } from "./outcomes";
import { findDuplicates, similarity, textKey } from "./duplicates";
import { cleanParts, defaultSplit, formatOf, partMarks, questionErrors, questionFormat } from "./validateQuestion";
import { bankTotals, bloomNeeds, breaksCompletedUnit, lockReason, unitStatus, unitStatuses, unlockedUnits } from "./rules";

const q = (unit: number, state: MidQuestion["state"], ...blooms: BloomLevel[]) =>
  ({ unit, state, parts: blooms.map((bloom) => ({ text: "x", cos: ["CO1"], bloom })) });
/** A complete unit: 10 single-part questions, L2 x4, L3 x3, L4 x3. */
const fullUnit = (unit: number) => [
  ...Array.from({ length: 4 }, () => q(unit, "COMPLETE", "L2")),
  ...Array.from({ length: 3 }, () => q(unit, "COMPLETE", "L3")),
  ...Array.from({ length: 3 }, () => q(unit, "COMPLETE", "L4")),
];

describe("outcomes", () => {
  it("renumbers units and COs; a CO keeps only known POs / PSOs, in PO1..PO11, PSO1, PSO2 order", () => {
    const { value, errors } = cleanOutcomes({
      units: [{ title: " Sets " }, { title: "Relations" }],
      cos: [{ statement: "Explain sets" }, { statement: "Apply relations" }],
      mapping: { CO1: ["PSO1", "PO2", "PO12", "PO1", "PO2"], CO2: { PO3: 2, PSO2: 1 } }, // CO2: an older save with levels
    });
    expect(errors).toEqual([]);
    expect(value.units).toEqual([{ no: 1, title: "Sets" }, { no: 2, title: "Relations" }]);
    expect(value.cos.map((c) => c.id)).toEqual(["CO1", "CO2"]);
    expect(value.mapping).toEqual({ CO1: ["PO1", "PO2", "PSO1"], CO2: ["PO3", "PSO2"] });
  });

  it("lists what is missing; an unmapped CO is a separate, later check", () => {
    const { value, errors } = cleanOutcomes({ units: [{ title: "" }], cos: [{ statement: "A" }, { statement: "" }], mapping: { CO1: ["PO1"] } });
    expect(errors).toEqual(["Unit 1 needs a title", "CO2 needs its statement"]);
    expect(mappingErrors(value)).toEqual(["CO2 is not mapped to any PO or PSO"]);
  });

  it("derives the POs / PSOs a question's COs reach", () => {
    expect(derivePoPso(["CO1", "CO2"], { CO1: ["PSO1", "PO2"], CO2: ["PO2", "PO10"] })).toEqual(["PO2", "PO10", "PSO1"]);
  });

  it("refuses removing a unit or CO that questions use", () => {
    const next = cleanOutcomes({ units: [{ title: "A" }], cos: [{ statement: "x" }], mapping: { CO1: ["PO1"] } }).value;
    expect(outcomeConflicts(next, { units: new Set([1, 2]), cos: new Set(["CO1", "CO3"]) }))
      .toEqual(["Unit 2 already has questions and can't be removed", "CO3 is used by questions and can't be removed"]);
  });
});

describe("duplicates", () => {
  it("normalises case, spacing, punctuation and LaTeX spacing", () => {
    expect(textKey("  Define a Set.  Give an example! ")).toBe(textKey("define a set give an example"));
    expect(textKey("Solve $x^2 \\, + 1 = 0$")).toBe(textKey("solve x^2 + 1 = 0"));
  });

  it("an identical part is exact, a near one is similar, an unrelated one is neither", () => {
    const others = [
      { id: "1_1", unit: 1, slot: 1, textKeys: [textKey("Define a set and give an example")] },
      { id: "1_2", unit: 1, slot: 2, textKeys: [textKey("Define a set and give two examples of it")] },
      { id: "1_3", unit: 1, slot: 3, textKeys: [textKey("State Ohm's law")] },
    ];
    const r = findDuplicates([textKey("define a set and give an example.")], others);
    expect(r.exact.map((h) => h.id)).toEqual(["1_1"]);
    expect(similarity(textKey("Define a set and give an example"), textKey("Define a set and give two examples of it"))).toBeLessThan(0.8);
    expect(findDuplicates([textKey("Explain the working of a transformer in detail")], [{ id: "2_1", unit: 2, slot: 1, textKeys: [textKey("Explain the working of a transformer in detail.")] }]).exact).toHaveLength(1);
    expect(findDuplicates([textKey("Explain the working principle of a transformer")], [{ id: "2_1", unit: 2, slot: 1, textKeys: [textKey("Explain the working principle of a single transformer")] }]).similar).toHaveLength(1);
  });

  it("the two parts of one question must differ", () => {
    expect(findDuplicates([textKey("Define a set"), textKey("define a set")], []).exact).toHaveLength(1);
  });
});

describe("question validation", () => {
  const cos = new Set(["CO1", "CO2"]);

  it("shapes parts to the question's format, keeps whole-number part marks, drops unknown COs and foreign image URLs", () => {
    const parts = cleanParts([{ text: "a", cos: ["CO2", "CO9", "CO1"], bloom: "L3", marks: 6, imageUrl: "https://evil.example/x.png" }, { text: "b", bloom: "L9", marks: 4.5 }, { text: "c" }], "PARTS_AB", cos, 10);
    expect(parts).toEqual([{ text: "a", cos: ["CO1", "CO2"], bloom: "L3", marks: 6 }, { text: "b", cos: [], bloom: "", marks: 5 }]);
    expect(cleanParts([{ text: "a", marks: 3 }], "SINGLE", cos, 10)[0].marks).toBe(10); // one question carries all the marks
  });

  it("a complete question needs text, a CO and one Bloom level in every part", () => {
    const parts = cleanParts([{ text: "Define a set", cos: ["CO1"], bloom: "L2", marks: 5 }, { text: "  ", cos: [], bloom: "", marks: 5 }], "PARTS_AB", cos, 10);
    expect(questionErrors(parts, "PARTS_AB", 10)).toEqual({
      "parts.1.text": "Part (b): write the question (text or a formula)",
      "parts.1.cos": "Part (b): pick at least one Course Outcome",
      "parts.1.bloom": "Part (b): pick one Bloom's level (L2, L3 or L4)",
    });
    expect(questionErrors(cleanParts([{ text: "$x^2$", cos: ["CO1"], bloom: "L3" }], "SINGLE", cos, 10), "SINGLE", 10)).toEqual({});
  });

  it("part marks are the faculty's split, but must add up to the question's marks", () => {
    const p = (marks: number) => ({ text: "x", cos: ["CO1"], bloom: "L2" as const, marks });
    expect(questionErrors([p(6), p(4)], "PARTS_AB", 10)).toEqual({});
    expect(questionErrors([p(6), p(3)], "PARTS_AB", 10)).toEqual({ marks: "Parts (a) and (b) must add up to 10 marks (now 9)" });
    expect(questionErrors([p(10), p(0)], "PARTS_AB", 10)["parts.1.marks"]).toBe("Part (b): give it at least 1 mark");
  });

  it("the format: the bank's own, or the question's when the bank allows either", () => {
    expect(questionFormat("PARTS_AB", "SINGLE")).toBe("PARTS_AB");
    expect(questionFormat("EITHER", "PARTS_AB")).toBe("PARTS_AB");
    expect(questionFormat("EITHER", "bogus")).toBe("SINGLE");
    expect(formatOf({ parts: [{ text: "", cos: [], bloom: "" }, { text: "", cos: [], bloom: "" }] }, "EITHER")).toBe("PARTS_AB"); // older doc without format
    expect(defaultSplit("PARTS_AB", 9)).toEqual([5, 4]);
    expect(partMarks({ text: "", cos: [], bloom: "" }, 1, "PARTS_AB", 10)).toBe(5);
  });
});

describe("unit rules", () => {
  it("a unit completes at 10 complete questions with L2, L3, L4 three times each", () => {
    expect(unitStatus(fullUnit(1), 1)).toEqual({ complete: true, completeCount: 10, draftCount: 0, bloom: { L2: 4, L3: 3, L4: 3 } });
    const lopsided = [...Array.from({ length: 8 }, () => q(1, "COMPLETE", "L2")), q(1, "COMPLETE", "L3"), q(1, "COMPLETE", "L4")];
    expect(unitStatus(lopsided, 1).complete).toBe(false);
    expect(bloomNeeds(unitStatus(lopsided, 1).bloom)).toEqual([{ level: "L2", count: 8, need: 0 }, { level: "L3", count: 1, need: 2 }, { level: "L4", count: 1, need: 2 }]);
  });

  it("parts (a) and (b) each count towards the Bloom tally; drafts don't", () => {
    const s = unitStatus([q(1, "COMPLETE", "L2", "L4"), q(1, "DRAFT", "L3")], 1);
    expect(s).toMatchObject({ completeCount: 1, draftCount: 1, bloom: { L2: 1, L3: 0, L4: 1 } });
  });

  it("units open in order", () => {
    const statuses = unitStatuses([3, 4, 5], [...fullUnit(3), q(4, "COMPLETE", "L2")]);
    expect([...unlockedUnits([3, 4, 5], statuses)]).toEqual([3, 4]);
    expect(lockReason([3, 4, 5], statuses, 5)).toBe("Opens when Unit 4 is complete");
    expect(bankTotals([3, 4, 5], statuses)).toEqual({ totalCount: 30, completeCount: 11, allComplete: false });
  });

  it("a completed unit can't be broken by a later edit", () => {
    const before = unitStatus(fullUnit(1), 1);
    const edited = fullUnit(1); edited[9] = q(1, "COMPLETE", "L2"); // an L4 becomes L2
    expect(breaksCompletedUnit(before, unitStatus(edited, 1))).toBe("This unit is complete and needs at least 3 of each Bloom level - L4 would drop to 2");
    const drafted = fullUnit(1); drafted[0] = q(1, "DRAFT", "L2");
    expect(breaksCompletedUnit(before, unitStatus(drafted, 1))).toBe("This unit is complete - a question in it can't go back to a draft");
    expect(breaksCompletedUnit(before, unitStatus(fullUnit(1), 1))).toBe("");
  });
});

import { imageKind, imageSize } from "./imageSize";
import { setupIssues } from "./setup";

describe("image size", () => {
  it("reads PNG and JPEG dimensions, rejects anything else", () => {
    const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png.set([0, 0, 2, 0x58], 16); png.set([0, 0, 1, 0x2c], 20);
    expect(imageSize(png)).toEqual({ width: 600, height: 300 });
    // SOI, APP0 (length 4), SOF0 with height 120, width 640
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x78, 0x02, 0x80, 0x03, 0, 0, 0, 0]);
    expect(imageSize(jpg)).toEqual({ width: 640, height: 120 });
    expect(imageKind(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
  });
});

describe("setup issues", () => {
  const subject = { courseName: "B.Tech", regulation: "R23" };
  const rules = { mids: { "1": [1, 2, 3], "2": [3, 4, 5] } } as never;
  it("names who must act: Exam Cell for missing rules, faculty for missing units", () => {
    expect(setupIssues(subject, 1, null, null).issues.map((i) => [i.code, i.who])).toEqual([["NO_RULES", "EXAM_CELL"], ["NO_OUTCOMES", "FACULTY"]]);
    const r = setupIssues(subject, 2, rules, { units: [{ no: 1, title: "a" }, { no: 2, title: "b" }, { no: 3, title: "c" }] });
    expect(r.units).toEqual([3, 4, 5]);
    expect(r.issues[0].message).toBe("Mid 2 covers Unit 4, 5, which the setup doesn't have yet - add the unit(s).");
    expect(setupIssues(subject, 1, rules, { units: [1, 2, 3].map((no) => ({ no, title: "t" })) }).issues).toEqual([]);
    expect(setupIssues(subject, 1, rules, { units: [1, 2, 3].map((no) => ({ no, title: "t" })), cos: [{ id: "CO1", statement: "x" }], mapping: {} }).issues[0].message)
      .toBe("Map CO1 to at least one PO or PSO (CO-PO Mapping).");
  });
});

import { deadlineError, isDeadlineLocked } from "./deadline";
import { bankIdFor, branchKey, checkSectionPick, sectionsOf, type TeachingRow } from "./sections";

describe("deadline", () => {
  it("is open through the deadline day and locked from the next day", () => {
    expect(isDeadlineLocked("2026-11-20", "2026-11-20")).toBe(false);
    expect(isDeadlineLocked("2026-11-20", "2026-11-21")).toBe(true);
  });
  it("must be a date, not past, and before the Mid starts", () => {
    expect(deadlineError("2026-11-20", "2026-11-01", "2026-11-25")).toBe("");
    expect(deadlineError("2026-10-30", "2026-11-01", null)).toBe("The deadline can't be in the past");
    expect(deadlineError("2026-11-25", "2026-11-01", "2026-11-25")).toBe("The deadline must be before the Mid starts (2026-11-25)");
    expect(deadlineError("", "2026-11-01", null)).toBe("Pick the deadline date");
  });
});

describe("sections of a bank", () => {
  const row = (sectionId: string, facultyId: string, branch = "Information Technology", subjectId = "dm"): TeachingRow =>
    ({ subjectId, subjectName: "Discrete Maths", subjectCode: "DM101", branch, sectionId, sectionName: sectionId.toUpperCase(), facultyId, facultyName: `Dr ${facultyId}` });
  const rows = [row("a", "f1"), row("b", "f2"), row("c", "f1", "CSE"), row("b", "f3")];
  const available = sectionsOf(rows, "dm", "Information Technology");

  it("lists the subject's sections in the branch with everyone teaching each", () => {
    expect(available.map((s) => [s.sectionId, s.facultyIds])).toEqual([["a", ["f1"]], ["b", ["f2", "f3"]]]);
  });
  it("accepts own + a colleague's section; refuses none of mine, a held section, a foreign section", () => {
    expect(checkSectionPick(available, ["a", "b"], "f1", new Map()).error).toBe("");
    expect(checkSectionPick(available, ["b"], "f1", new Map()).error).toBe("Include at least one section you teach");
    expect(checkSectionPick(available, ["a", "b"], "f1", new Map([["b", "Dr f2"]])).error).toBe("Section B is already in Dr f2's question bank");
    expect(checkSectionPick(available, ["c"], "f1", new Map()).error).toBe("A picked section doesn't have this subject in this branch");
    expect(checkSectionPick(available, [], "f1", new Map()).error).toBe("Pick at least one section");
  });
  it("ids are stable per branch + subject + owner", () => {
    expect(branchKey(" Information Technology ")).toBe("information-technology");
    expect(bankIdFor("d1", "dm", "Information Technology", "f1")).toBe("d1__dm__information-technology__f1");
  });
});
