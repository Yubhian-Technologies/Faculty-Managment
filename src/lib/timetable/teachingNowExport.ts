import ExcelJS from "exceljs";
import { escapeHtml } from "./facultyTimetablePdf";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";

export interface TeachingNowRow { classroom: string; classLabel: string; subject: string; faculty: string }

// Downloads for the "Teaching at this time" list, with the same columns as the
// on-screen table. `asOfLabel` is e.g. "Wed, 07 Oct 2026, 10:42 AM IST".

const HEADERS = ["S.No", "Class Room No", "Year - Dept - Section", "Subject", "Faculty"];
const cells = (r: TeachingNowRow, i: number): (string | number)[] => [i + 1, r.classroom || "-", r.classLabel, r.subject, r.faculty || "-"];

export async function downloadTeachingNowXlsx(rows: TeachingNowRow[], asOfLabel: string, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Teaching Now");
  [8, 16, 34, 36, 30].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  const title = sheet.addRow([`Teaching at this time - ${asOfLabel}`]);
  title.font = { bold: true, size: 13 };
  sheet.mergeCells(1, 1, 1, HEADERS.length);
  sheet.addRow([]);
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const header = sheet.addRow(HEADERS);
  header.font = { bold: true };
  header.eachCell((c) => { c.border = border; });
  rows.forEach((r, i) => {
    const row = sheet.addRow(cells(r, i));
    row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
    row.getCell(1).alignment = { horizontal: "left" };
  });
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

export async function downloadTeachingNowPdf(rows: TeachingNowRow[], asOfLabel: string, filename: string): Promise<void> {
  const th = (t: string, w?: string) => `<th style="border:1px solid #999;padding:5px;text-align:left${w ? `;width:${w}` : ""}">${t}</th>`;
  const td = (t: string | number) => `<td style="border:1px solid #999;padding:5px">${escapeHtml(String(t))}</td>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Teaching at this time</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px;color:#111">
      <h2 style="margin:0">Teaching at this time</h2>
      <p style="margin:4px 0 12px;color:#555;font-size:13px">${escapeHtml(asOfLabel)} &middot; ${rows.length} in session</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${th(HEADERS[0], "50px")}${HEADERS.slice(1).map((h) => th(h)).join("")}</tr></thead>
        <tbody>${rows.map((r, i) => `<tr>${cells(r, i).map(td).join("")}</tr>`).join("")}</tbody>
      </table>
    </body></html>`;
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
