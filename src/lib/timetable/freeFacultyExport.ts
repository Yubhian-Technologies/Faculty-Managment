import ExcelJS from "exceljs";
import { escapeHtml, formatTime12h } from "./facultyTimetablePdf";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";

export interface FreeFacultyRow { employeeId: string; name: string; department: string; freeRanges?: [string, string][] }

const freeText = (f: FreeFacultyRow) => (f.freeRanges ? f.freeRanges.map(([a, b]) => `${formatTime12h(a)} - ${formatTime12h(b)}`).join(", ") : "Whole range");

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

export async function downloadFreeFacultyXlsx(rows: FreeFacultyRow[], slotLabel: string, filename: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Leisure Faculty");
  // Same layout as the on-screen list and the PDF: each department is ONE
  // heading row spanning the table, then its S.No | Employee ID | Name table
  // underneath, with a blank row between departments.
  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 40;
  sheet.getColumn(4).width = 24;
  const title = sheet.addRow([`Leisure faculty - ${slotLabel}`]);
  title.font = { bold: true, size: 13 };
  sheet.mergeCells(1, 1, 1, 4);
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  for (const [dept, list] of groupByDepartment(rows)) {
    sheet.addRow([]); // spacer
    const deptRow = sheet.addRow([`${dept} (${list.length})`]);
    sheet.mergeCells(deptRow.number, 1, deptRow.number, 4);
    deptRow.font = { bold: true, size: 12 };
    deptRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF7" } };
    const header = sheet.addRow(["S.No", "Employee ID", "Name", "Free"]);
    header.font = { bold: true };
    header.eachCell((c) => { c.border = border; });
    list.forEach((f, i) => {
      const row = sheet.addRow([i + 1, f.employeeId || "-", f.name, freeText(f)]);
      row.eachCell({ includeEmpty: true }, (c) => { c.border = border; });
      row.getCell(1).alignment = { horizontal: "left" };
    });
  }
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

export async function downloadFreeFacultyPdf(rows: FreeFacultyRow[], slotLabel: string, filename: string): Promise<void> {
  const blocks = groupByDepartment(rows).map(([dept, list]) => `
    <h3 class="subheading" style="margin:16px 0 6px">${escapeHtml(dept)} (${list.length})</h3>
    <table class="data-table" style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="border:1px solid #999;padding:5px;width:50px;text-align:left">S.No</th>
        <th style="border:1px solid #999;padding:5px;text-align:left">Employee ID</th>
        <th style="border:1px solid #999;padding:5px;text-align:left">Name</th>
        <th style="border:1px solid #999;padding:5px;text-align:left">Free</th>
      </tr></thead>
      <tbody>${list.map((f, i) => `<tr>
        <td style="border:1px solid #999;padding:5px">${i + 1}</td>
        <td style="border:1px solid #999;padding:5px">${escapeHtml(f.employeeId || "-")}</td>
        <td style="border:1px solid #999;padding:5px">${escapeHtml(f.name)}</td>
        <td style="border:1px solid #999;padding:5px">${escapeHtml(freeText(f))}</td>
      </tr>`).join("")}</tbody>
    </table>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Leisure faculty</title></head>
    <body style="font-family:Arial,sans-serif;padding:24px;color:#111">
      <h2 style="margin:0">Leisure faculty</h2>
      <p style="margin:4px 0 0;color:#555;font-size:13px">${escapeHtml(slotLabel)} &middot; ${rows.length} free</p>
      ${blocks}
    </body></html>`;
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}
