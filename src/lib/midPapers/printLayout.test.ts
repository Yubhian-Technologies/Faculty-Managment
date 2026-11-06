import { describe, expect, it } from "vitest";
import { cleanPrintLayout, defaultPartHeaders } from "./printLayout";
import { getMidPaperSetHTML } from "@/lib/pdf/midPaperSetTemplate";
import type { MidPaperQuestion, PaperPartDef } from "@/types";

const partA: PaperPartDef = { id: "A", label: "Part A", title: "Objective", kind: "MCQ", questions: 2, marksEach: 1, choice: { kind: "ALL" }, options: 4 };
const partB: PaperPartDef = { id: "B", label: "Part B", title: "Descriptive", kind: "DESCRIPTIVE", questions: 2, marksEach: 10, choice: { kind: "OR_PAIRS" } };

describe("print layout", () => {
  it("defaults each part's header to the paper's time and the part's own max", () => {
    expect(defaultPartHeaders([partA, partB], 90)).toEqual([{ partId: "A", durationMinutes: 90, maxMarks: 2 }, { partId: "B", durationMinutes: 90, maxMarks: 10 }]);
  });
  it("one paper unless asked; one part can't be split", () => {
    expect(cleanPrintLayout({}, [partA, partB], 90).value).toEqual({ separateParts: false });
    expect(cleanPrintLayout({ separateParts: true }, [partB], 90).value).toEqual({ separateParts: false });
  });
  it("separate parts: given values, else defaults; bad values refused", () => {
    const ok = cleanPrintLayout({ separateParts: true, parts: [{ partId: "A", durationMinutes: 20, maxMarks: 10 }] }, [partA, partB], 90);
    expect(ok.errors).toEqual([]);
    expect(ok.value.parts).toEqual([{ partId: "A", durationMinutes: 20, maxMarks: 10 }, { partId: "B", durationMinutes: 90, maxMarks: 10 }]);
    const bad = cleanPrintLayout({ separateParts: true, parts: [{ partId: "A", durationMinutes: 0, maxMarks: 2.5 }] }, [partA, partB], 90);
    expect(bad.errors).toHaveLength(2);
  });
});

describe("one part on its own sheet", () => {
  const q = (partId: string, no: number, text: string, extra: Partial<MidPaperQuestion> = {}) =>
    ({ id: `1_${partId}_${no}`, set: 1, partId, no, text, cos: [], bloom: "", state: "COMPLETE", ...extra }) as unknown as MidPaperQuestion;
  const data = {
    college: { name: "VIT" }, exam: { courseName: "B.Tech", year: 2, semester: 3, midNumber: 1, date: "2026-11-10" },
    subject: { name: "Maths", code: "MA201", regulation: "R23" }, branch: "CSE", sections: ["A"],
    pattern: { parts: [partA, partB], durationMinutes: 90, instruction: "", regdBoxes: 10 }, set: 1,
    questions: [q("A", 1, "ALPHA", { options: ["1", "2", "3", "4"] }), q("A", 2, "BETA", { options: ["1", "2", "3", "4"] }), q("B", 1, "GAMMA"), q("B", 2, "DELTA")],
    outcomes: { cos: false, poMapping: false, bloom: false },
  };
  it("prints only that part, keeps its numbers, and its own time / max marks", () => {
    const html = getMidPaperSetHTML({ ...data, onlyPartId: "B", partHeader: { durationMinutes: 60, maxMarks: 20 } });
    expect(html).toContain("GAMMA");
    expect(html).not.toContain("ALPHA");
    expect(html).toContain("<b>PART B</b>");
    expect(html).toContain("60 Mins.");
    expect(html).toContain("Max. Marks: <b>20</b>");
    // Part A had 2 questions, so Part B starts at 3 as on the full paper.
    expect(html).toContain('<td class="no">3</td>');
    expect(html).toContain("Regd. No:");
  });
  it("the full paper is unchanged", () => {
    const html = getMidPaperSetHTML(data);
    expect(html).toContain("ALPHA");
    expect(html).toContain("GAMMA");
    expect(html).toContain("90 Mins.");
    expect(html).not.toContain("<b>PART B</b>");
  });
});
