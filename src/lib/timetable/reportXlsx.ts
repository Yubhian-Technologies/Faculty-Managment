import type ExcelJS from "exceljs";
import { loadExcelLogo } from "./logoAsset";
import type { ReportCollege } from "./reportPdf";

/**
 * Writes the class-timetable style letterhead (logo in column 1, college
 * details beside it, then the title and subtitle) at the top of `sheet` and
 * returns the next free row. The caller adds its column-header row next and
 * passes the rows up to it to setPrintTitles, so every printed page of a long
 * sheet starts with the same header.
 */
export async function addReportLetterhead(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  opts: { college?: ReportCollege; title: string; subtitle?: string; lastCol: number },
): Promise<number> {
  const { college: c = {}, title, subtitle, lastCol } = opts;
  let r = 1;
  const textRow = (text: string, font: Partial<ExcelJS.Font>, fromCol: number) => {
    const row = sheet.getRow(r);
    row.getCell(fromCol).value = text;
    row.getCell(fromCol).font = font;
    row.getCell(fromCol).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (lastCol > fromCol) sheet.mergeCells(r, fromCol, r, lastCol);
    row.height = Math.max(16, (font.size ?? 10) * 1.6);
    r++;
  };
  const start = r;
  if (c.name) textRow(`${c.name}${c.code ? ` ( Code: ${c.code} )` : ""}`, { bold: true, size: 14 }, 2);
  if (c.affiliation) textRow(c.affiliation, { bold: true, size: 10 }, 2);
  if (c.address) textRow(c.address, { bold: true, size: 10 }, 2);
  if (c.phone) textRow(`Tel : ${c.phone}`, { bold: true, size: 10 }, 2);
  const logo = await loadExcelLogo(c.logoUrl);
  if (logo && r > start) {
    try {
      const rowsPx = (sheet.getRows(start, r - start) ?? []).reduce((n, row) => n + ((row.height ?? 15) * 96) / 72, 0);
      const colPx = (sheet.getColumn(1).width ?? 8) * 7 + 5;
      const box = Math.max(24, Math.min(rowsPx - 6, colPx - 8, 84));
      const ratio = logo.width && logo.height ? logo.width / logo.height : 1;
      const w = ratio >= 1 ? box : box * ratio;
      const h = ratio >= 1 ? box / ratio : box;
      const firstRowPx = (((sheet.getRow(start).height ?? 15) * 96) / 72) || 20;
      sheet.addImage(workbook.addImage({ base64: logo.base64, extension: logo.extension }), {
        tl: { col: Math.max(0, (colPx - w) / 2 / colPx), row: start - 1 + Math.min(0.9, Math.max(0, (rowsPx - h) / 2 / firstRowPx)) },
        ext: { width: w, height: h },
        editAs: "oneCell",
      });
    } catch {
      // A logo that can't be placed must never fail the download.
    }
  }
  textRow(title, { bold: true, size: 13 }, 1);
  if (subtitle) textRow(subtitle, { bold: true, size: 10 }, 1);
  return r;
}
