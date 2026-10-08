import ExcelJS from "exceljs";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildReportPdfHtml, reportCell, type ReportCollege } from "./reportPdf";
import { addReportLetterhead } from "./reportXlsx";

export interface TeachingNowRow { classroom: string; classLabel: string; year?: string; deptSection?: string; subject: string; faculty: string }

// Downloads for the "Teaching at this time" list, with the same columns as the
// on-screen table. `asOfLabel` is e.g. "Wed, 07 Oct 2026, 10:42 AM IST".

const HEADERS = ["S.No", "Room No", "Year", "Dept - Sec", "Subject", "Faculty"];
const cells = (r: TeachingNowRow, i: number): (string | number)[] => [i + 1, r.classroom || "-", r.year ?? r.classLabel, r.deptSection ?? "-", r.subject, r.faculty || "-"];

export async function downloadTeachingNowXlsx(rows: TeachingNowRow[], asOfLabel: string, filename: string, college?: ReportCollege): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Teaching Now");
  [10, 14, 12, 20, 36, 30].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  let r = await addReportLetterhead(workbook, sheet, { college, title: "TEACHING AT THIS TIME", subtitle: `${asOfLabel} · ${rows.length} in session`, lastCol: HEADERS.length });
  const headerRowIndex = r;
  const header = sheet.getRow(r++);
  HEADERS.forEach((t, i) => {
    const cell = header.getCell(i + 1);
    cell.value = t;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
  });
  rows.forEach((row, i) => {
    const xr = sheet.getRow(r++);
    cells(row, i).forEach((v, k) => {
      const cell = xr.getCell(k + 1);
      cell.value = v;
      cell.border = border;
      cell.alignment = { horizontal: k === 0 ? "center" : "left", vertical: "middle", wrapText: true };
    });
  });
  // Letterhead + column header repeat at the top of every printed page.
  sheet.pageSetup = { ...sheet.pageSetup, paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${headerRowIndex}` };
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadTeachingNowPdf(rows: TeachingNowRow[], asOfLabel: string, filename: string, college?: ReportCollege): Promise<void> {
  const widths = ["7%", "11%", "10%", "17%", "30%", "25%"];
  const bodyHtml = `<table class="report" cellspacing="0" cellpadding="0">
    <colgroup>${widths.map((w) => `<col style="width:${w}">`).join("")}</colgroup>
    <thead><tr>${HEADERS.map((h) => reportCell(h, { head: true })).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr>${cells(r, i).map((v, k) => reportCell(v, { left: k > 0 })).join("")}</tr>`).join("")}</tbody></table>`;
  const html = buildReportPdfHtml({ college, title: "TEACHING AT THIS TIME", subtitle: `${asOfLabel} · ${rows.length} in session`, bodyHtml });
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
