import { describe, expect, it } from "vitest";
import { checkRows, layoutFromUpload, parseUploadSheet, sameLayout } from "./midMarksUploadRows";

const file = [
  ["Regd. No", "Name", "Section", "Absent", "Q1", "Q2", "Q3"],
  ["Max Marks", "", "", "", 5, 5, 10],
  ["Paper Max", 15],
  ["23a01", "Asha", "A", "", 4, 3.5, ""],
  ["23A02", "Bala", "A", "AB", "", "", ""],
  ["23A03", "Chitra", "B", "", 5, 5, 10],
  ["23A04", "Dev", "B", "AB", 2, "", ""],
  ["23A01", "Asha again", "A", "", 1, "", ""],
  ["99X99", "Who", "C", "", 1, "", ""],
  ["23A05", "Esha", "B", "", "", "", ""],
];

describe("Exam Cell Mid marks sheet", () => {
  it("reads the questions, max marks, paper max and rows", () => {
    const p = parseUploadSheet(file);
    if ("error" in p) throw new Error(p.error);
    expect(p.layoutRaw).toEqual({ questions: [{ label: "Q1", max: 5 }, { label: "Q2", max: 5 }, { label: "Q3", max: 10 }], paperMax: 15 });
    expect(p.rows[0]).toEqual({ rowNo: 4, roll: "23A01", absent: false, values: { Q1: 4, Q2: 3.5, Q3: null } });
    expect(p.rows[1].absent).toBe(true);
  });

  it("checks each row: unknown, repeated, absent with marks, above the paper max, nothing entered", () => {
    const p = parseUploadSheet(file) as Exclude<ReturnType<typeof parseUploadSheet>, { error: string }>;
    const { layout } = layoutFromUpload(p) as { layout: never };
    const known = new Set(["23A01", "23A02", "23A03", "23A04", "23A05"]);
    const c = checkRows(layout, p.rows, known);
    expect(c.map((x) => x.error ? "E" : x.total)).toEqual([7.5, 0, "E", "E", "E", "E", "E"]);
    expect(c[2].error).toMatch(/paper max/);
    expect(c[3].error).toMatch(/Absent/);
    expect(c[4].error).toMatch(/more than once/);
    expect(c[5].error).toMatch(/not found/);
    expect(c[6].error).toMatch(/No marks/);
  });

  it("refuses a sheet without its headings / Max Marks row; compares layouts", () => {
    expect(parseUploadSheet([["Roll", "Name"]])).toHaveProperty("error");
    expect(parseUploadSheet([["Regd. No", "Name", "Section", "Absent", "Q1"], ["23A01", "x", "A", "", 1]])).toHaveProperty("error");
    const a = { questions: [{ label: "Q1", max: 5 }], paperMax: 5 };
    expect(sameLayout(a, { ...a })).toBe(true);
    expect(sameLayout(a, { questions: [{ label: "Q1", max: 6 }], paperMax: 6 })).toBe(false);
  });
});
