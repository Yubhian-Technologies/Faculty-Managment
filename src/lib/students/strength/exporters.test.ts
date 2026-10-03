import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildStrengthCube } from "./aggregate";
import { buildPrintHtml, buildStrengthWorkbook, strengthCsvRows, type ExportContext } from "./exporters";
import { buildReport } from "./query";
import type { StrengthRow } from "./types";

let n = 0;
const many = (count: number, over: Partial<StrengthRow>): StrengthRow[] =>
  Array.from({ length: count }, () => ({ id: `e${++n}`, department: "IT", course: "B.Tech", year: 1, section: "A", status: "REGULAR", ...over }));

const rows = [
  ...many(59, { department: "CIVIL", year: 1 }),
  ...many(64, { department: "CIVIL", year: 2 }),
  ...many(256, { department: "IT", year: 1, section: "A" }),
  ...many(12, { department: "AMFS", course: "M.Tech", year: 1, section: "M" }),
  ...many(7, { department: "AMFS", course: "M.Tech", year: 2, section: "M" }),
  ...many(3, { department: 'R&D <script>alert(1)</script>', course: "B.Tech", year: 1 }),
];
const { cells, meta } = buildStrengthCube(rows, { courses: [{ id: "b", name: "B.Tech", durationYears: 2 }, { id: "m", name: "M.Tech", durationYears: 2 }], departments: [], sections: [] });
const report = buildReport(cells, meta, { status: "ENROLLED" });
const ctx: ExportContext = {
  collegeName: "Vishnu Institute of Technology",
  session: "2026-27",
  selection: "Whole college",
  statusRule: "Enrolled students",
  generatedAt: new Date("2026-09-30T10:00:00Z"),
};

describe("Excel export", () => {
  it("lays out the sheet like the office's manual sheet, and every number reads back correctly", async () => {
    const wb = buildStrengthWorkbook(ExcelJS, report, ctx);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);

    const ws = back.getWorksheet("Strength")!;
    const grid: (string | number | null)[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => grid.push((row.values as (string | number | null)[]).slice(1)));
    const find = (label: string) => grid.find((r) => r.includes(label))!;

    expect(grid[0][0]).toBe("VISHNU INSTITUTE OF TECHNOLOGY");
    expect(grid[1][0]).toBe("2026-27 - STUDENT STRENGTH");
    const civil = find("CIVIL");
    expect(civil.filter((v) => typeof v === "number")).toEqual([1, 59, 64, 123]); // SL, I, II, TOTAL (2-year fixture)
    const it = find("IT");
    expect(it.filter((v) => typeof v === "number")).toEqual([2, 256, 0, 256]);
    const overall = find("OVERALL STRENGTH");
    expect(overall[overall.length - 1]).toBe(report.total);
    expect(report.total).toBe(59 + 64 + 256 + 12 + 7 + 3);

    const sec = back.getWorksheet("Section-wise")!;
    expect(sec.getRow(1).values).toEqual([undefined, "Course", "Department", "Year", "Section", "Students"]);
    const last = sec.getRow(sec.rowCount).values as (string | number)[];
    expect(last[1]).toBe("TOTAL");
    expect(last[5]).toBe(report.total);
    // section rows add up to the total
    let sum = 0;
    for (let i = 2; i < sec.rowCount; i++) sum += Number(sec.getRow(i).getCell(5).value);
    expect(sum).toBe(report.total);
  });
});

describe("CSV export", () => {
  it("emits one row per program/department/year/section plus a TOTAL that matches", () => {
    const csv = strengthCsvRows(report);
    expect(csv[0]).toEqual(["Course", "Department", "Year", "Section", "Students"]);
    expect(csv.slice(1, -1).reduce((s, r) => s + Number(r[4]), 0)).toBe(report.total);
    expect(csv[csv.length - 1]).toEqual(["TOTAL", "", "", "", String(report.total)]);
    expect(csv).toContainEqual(["M.Tech", "AMFS", "II", "M", "7"]);
  });
});

describe("print page", () => {
  const html = buildPrintHtml(report, ctx);
  it("includes the totals", () => {
    expect(html).toContain("OVERALL STRENGTH");
    expect(html).toContain(`<span>${report.total}</span>`);
    expect(html).toContain("B.TECH");
    expect(html).toContain("M.TECH");
  });
  it("escapes department names - no markup injection from student data", () => {
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("R&amp;D &lt;script&gt;");
  });
});
