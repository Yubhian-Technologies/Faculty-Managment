import { describe, expect, it } from "vitest";
import { normalizeHeldOn, parseCieCell, planCieUpload, type UploadUnit } from "./upload";

const students = [
  { studentId: "s1", rollNumber: "26BV1A0701", name: "A" },
  { studentId: "s2", rollNumber: "26BV1A0702", name: "B" },
];
const units: UploadUnit[] = [
  { unit: 1, when: "CLASS", unitMarks: 10, status: null },
  { unit: 2, when: "MID1", unitMarks: 10, status: "DRAFT" },
  { unit: 3, when: "CLASS", unitMarks: 10, status: "SUBMITTED", heldOn: "2026-10-01" },
];

describe("CIE marks upload", () => {
  it("reads a cell: blank, AB, halves, out of range", () => {
    expect(parseCieCell("", 10)).toEqual({ kind: "blank" });
    expect(parseCieCell(" ab ", 10)).toEqual({ kind: "absent" });
    expect(parseCieCell("7.5", 10)).toEqual({ kind: "marks", n: 7.5 });
    expect(parseCieCell(10, 10)).toEqual({ kind: "marks", n: 10 });
    expect(parseCieCell("7.3", 10).kind).toBe("bad");
    expect(parseCieCell("11", 10).kind).toBe("bad");
    expect(parseCieCell("x", 10).kind).toBe("bad");
  });

  it("reads the date held in DD/MM/YYYY or YYYY-MM-DD", () => {
    expect(normalizeHeldOn("05/10/2026")).toBe("2026-10-05");
    expect(normalizeHeldOn("2026-10-05")).toBe("2026-10-05");
    expect(normalizeHeldOn("")).toBe("");
    expect(normalizeHeldOn("31/02/2026")).toBeNull();
  });

  it("plans every unit at once - with-Mid needs no date, submitted units are left alone", () => {
    const p = planCieUpload({
      units, students, today: "2026-11-21",
      heldOn: { "1": "05/10/2026" },
      rows: [
        { roll: "26bv1a0701", marks: { "1": "8", "2": "9.5", "3": "6" } },
        { roll: "26BV1A0702", marks: { "1": "AB", "2": "" } },
      ],
    });
    expect(p.errors).toEqual([]);
    expect(p.unknownRolls).toEqual([]);
    expect(p.skippedSubmitted).toEqual([3]);
    expect(p.changes).toEqual([
      { unit: 1, heldOn: "2026-10-05", values: [{ studentId: "s1", marks: 8 }, { studentId: "s2", marks: 0, absent: true }] },
      { unit: 2, values: [{ studentId: "s1", marks: 9.5 }] },
    ]);
  });

  it("reports every problem and saves nothing", () => {
    const p = planCieUpload({
      units, students, today: "2026-11-21",
      rows: [
        { roll: "26BV1A0701", marks: { "1": "8" } },
        { roll: "26BV1A0701", marks: { "1": "8" } },
        { roll: "26BV1A0799", marks: { "1": "8" } },
        { roll: "26BV1A0702", marks: { "2": "12" } },
      ],
    });
    expect(p.unknownRolls).toEqual(["26BV1A0799"]);
    expect(p.errors.some((e) => /listed twice/.test(e))).toBe(true);
    expect(p.errors.some((e) => /Unit 2: "12"/.test(e))).toBe(true);
    expect(p.errors.some((e) => /Unit 1 is held in class - give its Date Held/.test(e))).toBe(true);
  });

  it("refuses a future date held and an empty file", () => {
    expect(planCieUpload({ units, students, today: "2026-11-21", heldOn: { "1": "01/12/2026" }, rows: [{ roll: "26BV1A0701", marks: { "1": "5" } }] }).errors)
      .toContain("Unit 1: the Date Held can't be in the future");
    expect(planCieUpload({ units, students, rows: [{ roll: "26BV1A0701", marks: {} }] }).errors).toContain("The file has no marks to upload.");
  });
});
