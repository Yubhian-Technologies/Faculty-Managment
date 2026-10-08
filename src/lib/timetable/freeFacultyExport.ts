import ExcelJS from "exceljs";
import { escapeHtml, formatTime12h } from "./facultyTimetablePdf";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { buildReportPdfHtml, reportCell, type ReportCollege } from "./reportPdf";
import { addReportLetterhead } from "./reportXlsx";

export interface FreeFacultyRow { employeeId: string; name: string; department: string; freeRanges?: [string, string][] }

// Free for the whole requested window has no freeRanges (see faculty-leisure's
// route) - fall back to that window itself rather than a placeholder, so the
// export always shows an actual time range.
const freeText = (f: FreeFacultyRow, wholeWindow: [string, string]) =>
  (f.freeRanges ?? [wholeWindow]).map(([a, b]) => `${formatTime12h(a)} - ${formatTime12h(b)}`).join(", ");

// Downloads for the "Show free faculty" list: one block per department with
// S.No / Employee ID / Name, matching the on-screen tables. `slotLabel` is e.g.
// "Monday, Period 3".

function groupByDepartment(rows: FreeFacultyRow[]): [string, FreeFacultyRow[]][] {
  const map = new Map<string, FreeFacultyRow[]>();
  for (const r of rows) {
    const key = r.department || "Unassigned";
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  return Array.from(map.entries());
}

export async function downloadFreeFacultyXlsx(rows: FreeFacultyRow[], slotLabel: string, filename: string, wholeWindow: [string, string], college?: ReportCollege): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Leisure Faculty");
  // Letterhead like the class timetable's, then ONE table: each department is a
  // heading row spanning it, followed by its S.No | Employee ID | Name | Free rows.
  sheet.getColumn(1).width = 10;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 40;
  sheet.getColumn(4).width = 24;
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  let r = await addReportLetterhead(workbook, sheet, { college, title: "LEISURE FACULTY", subtitle: `${slotLabel} · ${rows.length} free`, lastCol: 4 });
  const headerRowIndex = r;
  const header = sheet.getRow(r++);
  ["S.No", "Employee ID", "Name", "Free"].forEach((t, i) => {
    const cell = header.getCell(i + 1);
    cell.value = t;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = border;
  });
  for (const [dept, list] of groupByDepartment(rows)) {
    const deptRow = sheet.getRow(r);
    deptRow.getCell(1).value = `${dept} (${list.length})`;
    sheet.mergeCells(r, 1, r, 4);
    deptRow.font = { bold: true };
    deptRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } };
    deptRow.getCell(1).border = border;
    r++;
    list.forEach((f, i) => {
      const row = sheet.getRow(r++);
      [i + 1, f.employeeId || "-", f.name, freeText(f, wholeWindow)].forEach((v, k) => {
        const cell = row.getCell(k + 1);
        cell.value = v;
        cell.border = border;
        cell.alignment = { horizontal: k === 0 ? "center" : "left", vertical: "middle", wrapText: true };
      });
    });
  }
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

export async function downloadFreeFacultyPdf(rows: FreeFacultyRow[], slotLabel: string, filename: string, wholeWindow: [string, string], college?: ReportCollege): Promise<void> {
  // One table for every department (group rows inside it) so the column header
  // repeats on each continuation page along with the letterhead.
  const body = groupByDepartment(rows).map(([dept, list]) =>
    `<tr><td class="cell group-cell" colspan="4"><div class="fx fx-left">${escapeHtml(`${dept} (${list.length})`)}</div></td></tr>` +
    list.map((f, i) => `<tr>${reportCell(i + 1)}${reportCell(f.employeeId || "-", { left: true })}${reportCell(f.name, { left: true })}${reportCell(freeText(f, wholeWindow), { left: true })}</tr>`).join("")
  ).join("");
  const bodyHtml = `<table class="report" cellspacing="0" cellpadding="0">
    <colgroup><col style="width:12%"><col style="width:22%"><col style="width:36%"><col style="width:30%"></colgroup>
    <thead><tr>${reportCell("S.No", { head: true })}${reportCell("Employee ID", { head: true })}${reportCell("Name", { head: true })}${reportCell("Free", { head: true })}</tr></thead>
    <tbody>${body}</tbody></table>`;
  const html = buildReportPdfHtml({ college, title: "LEISURE FACULTY", subtitle: `${slotLabel} · ${rows.length} free`, bodyHtml });
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
