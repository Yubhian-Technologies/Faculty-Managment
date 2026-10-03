import ExcelJS from "exceljs";
import { escapeHtml } from "@/lib/timetable/facultyTimetablePdf";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";

// One heading + a header row + body rows, as the Not Posted report shows them.
// `subtitle` is the filter line (department, date or range, ...) printed under
// the heading. Same exceljs / renderHtmlToPdf approach as the free-faculty
// export, so the downloads behave the same way.
export interface TableExport {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
}

export async function downloadTableXlsx({ title, subtitle, headers, rows }: TableExport, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");
  const cols = headers.length;
  const heading = sheet.addRow([title]);
  heading.font = { bold: true, size: 13 };
  sheet.mergeCells(1, 1, 1, cols);
  if (subtitle) {
    const sub = sheet.addRow([subtitle]);
    sheet.mergeCells(sub.number, 1, sub.number, cols);
  }
  sheet.addRow([]);
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const header = sheet.addRow(headers);
  header.font = { bold: true };
  header.eachCell((c) => { c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } }; });
  for (const r of rows) sheet.addRow(r).eachCell({ includeEmpty: true }, (c) => { c.border = border; });
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 8), 40);
  });
  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadTablePdf({ title, subtitle, headers, rows }: TableExport, filename: string): Promise<void> {
  const cell = "border:1px solid #999;padding:5px;text-align:left";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px;color:#111">
      <h2 style="margin:0">${escapeHtml(title)}</h2>
      ${subtitle ? `<p style="margin:4px 0 12px;color:#555;font-size:13px">${escapeHtml(subtitle)}</p>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${headers.map((h) => `<th style="${cell};background:#e8eef7">${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td style="${cell}">${escapeHtml(String(v ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </body></html>`;
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
