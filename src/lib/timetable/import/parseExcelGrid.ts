import ExcelJS from "exceljs";
import type { GridCell, ParsedGrid } from "@/lib/timetable/import/gridTypes";

function colLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** "B2" -> { row: 2, col: 2 } (1-indexed, matching ExcelJS's own addressing). */
function parseAddress(address: string): { row: number; col: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) throw new Error(`Unrecognized cell address: ${address}`);
  return { row: Number(match[2]), col: colLettersToNumber(match[1].toUpperCase()) };
}

function cellValueToText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if ("result" in value) return String((value as { result: unknown }).result ?? "");
  }
  return String(value);
}

/**
 * Converts the first worksheet of a .xlsx buffer into a virtual grid,
 * expanding merged ranges the same way parseWordTable expands rowspan/colspan,
 * so a merged lab-block cell in Excel is handled identically downstream.
 */
export async function parseExcelGrid(data: ArrayBuffer): Promise<ParsedGrid> {
  const workbook = new ExcelJS.Workbook();
  // Matches src/app/api/college/parse-excel/route.ts's own working call -
  // exceljs's Buffer type declaration collides with @types/node's newer
  // generic Buffer<ArrayBufferLike>, so the plain ArrayBuffer from
  // File.arrayBuffer() is what actually type-checks here, not Buffer.from(...).
  await workbook.xlsx.load(data);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The workbook has no sheets.");

  // Merge ranges look like "B2:C2" - map each one's top-left address to its
  // span, and mark every OTHER address it covers so those don't also become
  // their own (empty) grid cell.
  const spanByTopLeft = new Map<string, { rowSpan: number; colSpan: number }>();
  const coveredNonAnchor = new Set<string>();
  for (const range of worksheet.model.merges ?? []) {
    const [startAddr, endAddr] = range.split(":");
    const start = parseAddress(startAddr);
    const end = parseAddress(endAddr ?? startAddr);
    spanByTopLeft.set(`${start.row}:${start.col}`, {
      rowSpan: end.row - start.row + 1,
      colSpan: end.col - start.col + 1,
    });
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        if (r === start.row && c === start.col) continue;
        coveredNonAnchor.add(`${r}:${c}`);
      }
    }
  }

  const rowCount = worksheet.rowCount;
  const colCount = worksheet.columnCount;
  const cells: GridCell[] = [];
  for (let r = 1; r <= rowCount; r++) {
    for (let c = 1; c <= colCount; c++) {
      const key = `${r}:${c}`;
      if (coveredNonAnchor.has(key)) continue;
      const span = spanByTopLeft.get(key) ?? { rowSpan: 1, colSpan: 1 };
      const text = cellValueToText(worksheet.getCell(r, c).value).trim();
      cells.push({ row: r - 1, col: c - 1, rowSpan: span.rowSpan, colSpan: span.colSpan, text });
    }
  }

  return { rowCount, colCount, cells };
}
