import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseExcelGrid } from "./parseExcelGrid";

async function buildWorkbookBuffer(fill: (ws: ExcelJS.Worksheet) => void): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Timetable");
  fill(worksheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

describe("parseExcelGrid", () => {
  it("reads plain cells into a 0-indexed grid", async () => {
    const data = await buildWorkbookBuffer((ws) => {
      ws.getCell("A1").value = "";
      ws.getCell("B1").value = "Monday";
      ws.getCell("A2").value = "Period 1";
      ws.getCell("B2").value = "CS201 / Dr. Rao";
    });
    const grid = await parseExcelGrid(data);
    expect(grid.rowCount).toBe(2);
    expect(grid.colCount).toBe(2);
    const cellB2 = grid.cells.find((c) => c.row === 1 && c.col === 1)!;
    expect(cellB2).toMatchObject({ rowSpan: 1, colSpan: 1, text: "CS201 / Dr. Rao" });
  });

  it("expands a merged range into one cell spanning it, and skips the covered positions", async () => {
    const data = await buildWorkbookBuffer((ws) => {
      ws.getCell("A1").value = "";
      ws.getCell("B1").value = "Monday";
      ws.getCell("A2").value = "Period 1";
      ws.getCell("A3").value = "Period 2";
      ws.mergeCells("B2:B3"); // a 2-period lab block
      ws.getCell("B2").value = "CS301 (Lab) / Kiran";
    });
    const grid = await parseExcelGrid(data);
    const anchor = grid.cells.find((c) => c.row === 1 && c.col === 1)!;
    expect(anchor).toMatchObject({ rowSpan: 2, colSpan: 1, text: "CS301 (Lab) / Kiran" });
    // The covered (non-anchor) position must not also appear as its own cell.
    expect(grid.cells.some((c) => c.row === 2 && c.col === 1)).toBe(false);
  });

  it("normalizes rich-text cell values to plain strings", async () => {
    const data = await buildWorkbookBuffer((ws) => {
      ws.getCell("A1").value = { richText: [{ text: "CS201 " }, { text: "/ Dr. Rao" }] };
    });
    const grid = await parseExcelGrid(data);
    expect(grid.cells.find((c) => c.row === 0 && c.col === 0)?.text).toBe("CS201 / Dr. Rao");
  });
});
