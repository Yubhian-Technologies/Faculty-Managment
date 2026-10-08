import ExcelJS from "exceljs";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildReportPdfHtml, reportCell, type ReportCollege } from "@/lib/timetable/reportPdf";
import { addReportLetterhead } from "@/lib/timetable/reportXlsx";
import { dmy, type TopicRow } from "./topicsCovered";

const HEADERS = ["S.No", "Date", "No. of Periods", "Topics"];
const cells = (r: TopicRow, i: number): (string | number)[] => [i + 1, dmy(r.date), r.periods.join(",") || "-", r.topics || "-"];

export interface TopicsReportMeta {
  subject: string;
  faculty: string;
  college?: ReportCollege;
}

const subtitle = (m: TopicsReportMeta) => `Subject : ${m.subject} · Faculty : ${m.faculty}`;

export async function downloadTopicsCoveredPdf(rows: TopicRow[], meta: TopicsReportMeta, filename: string): Promise<void> {
  const bodyHtml = `<table class="report" cellspacing="0" cellpadding="0">
    <colgroup><col style="width:8%"><col style="width:16%"><col style="width:16%"><col style="width:60%"></colgroup>
    <thead><tr>${HEADERS.map((h) => reportCell(h, { head: true })).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr>${cells(r, i).map((v, k) => reportCell(v, { left: k === 3 })).join("")}</tr>`).join("")}</tbody></table>`;
  const html = buildReportPdfHtml({ college: meta.college, title: "TOPICS COVERED", subtitle: subtitle(meta), bodyHtml });
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

export async function downloadTopicsCoveredXlsx(rows: TopicRow[], meta: TopicsReportMeta, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Topics Covered");
  [10, 14, 16, 70].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  let r = await addReportLetterhead(workbook, sheet, { college: meta.college, title: "TOPICS COVERED", subtitle: subtitle(meta), lastCol: HEADERS.length });
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
      cell.alignment = { horizontal: k === 3 ? "left" : "center", vertical: "middle", wrapText: true };
    });
  });
  // Letterhead + column header repeat at the top of every printed page.
  sheet.pageSetup = { ...sheet.pageSetup, paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `1:${headerRowIndex}` };
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
