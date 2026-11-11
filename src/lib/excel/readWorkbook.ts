import ExcelJS from "exceljs";
import type { CellValue } from "exceljs";

// Server-side .xlsx reading shared by the upload routes (real Node exceljs - the browser bundle has
// proven unreliable at reading files). Every cell becomes the plain string the importers expect,
// same convention as CSV text (dates as YYYY-MM-DD).

export const MAX_EXCEL_BYTES = 10 * 1024 * 1024;

export function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join("");
    }
    if ("result" in value) return cellToString(value.result as CellValue);
    if ("text" in value) return String(value.text ?? "");
    return "";
  }
  return String(value).trim();
}

/** A sheet's non-blank rows, with each kept row's real (1-based) sheet row number alongside. */
export function readSheet(sheet: ExcelJS.Worksheet): { rows: string[][]; rowNumbers: number[] } {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) cells.push(cellToString(row.getCell(i).value));
    if (cells.some((c) => c.trim())) {
      rows.push(cells);
      rowNumbers.push(rowNumber);
    }
  });
  return { rows, rowNumbers };
}

export async function loadWorkbook(buffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}
