import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildPastAttendanceTemplate } from "./pastImportTemplate";
import { parsePastAttendanceGrid } from "./pastImportGrid";

// Build the real template, save it as an .xlsx, read it back, and run each sheet through the import parser - what a
// person who downloads the file, fills it in and uploads it will go through.
const rowsOf = (ws: ExcelJS.Worksheet) => {
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) {
      const v = row.getCell(i).value as unknown;
      cells.push(v == null ? "" : typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result) : String(v));
    }
    out.push(cells);
  });
  return out;
};
const reload = async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildPastAttendanceTemplate(ExcelJS).xlsx.writeBuffer()) as ArrayBuffer);
  return wb;
};

describe("past attendance template", () => {
  it("has the three sheets, with the template first", async () => {
    expect((await reload()).worksheets.map((w) => w.name)).toEqual(["Template", "Sample", "How to fill"]);
  });
  it("the Sample sheet imports as a register: 6 dates, 2 students, nothing ignored but the footer", async () => {
    const g = parsePastAttendanceGrid(rowsOf((await reload()).getWorksheet("Sample")!), 2026);
    expect(g.errors).toEqual([]);
    expect(g.warnings).toEqual([]); // CC / AC in the sample agree with its P marks
    expect(g.dates).toEqual(["2026-08-29", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05"]);
    expect(g.students.map((s) => s.roll)).toEqual(["26BV1A05001", "26BV1A05002"]);
  });
  it("the Template sheet's headers are text dates the parser reads, in columns wide enough to show them (no ####)", async () => {
    const ws = (await reload()).getWorksheet("Template")!;
    expect(ws.getColumn(3).width).toBeGreaterThanOrEqual(12);
    const g = parsePastAttendanceGrid([...rowsOf(ws), ["26BV1A05001", "", "P", "A", "", "", ""]], 2026);
    expect(g.errors).toEqual([]);
    expect(g.dates).toEqual(["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"]);
  });
});
