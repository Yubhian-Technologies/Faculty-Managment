import ExcelJS from "exceljs";
import { escapeHtml } from "@/lib/timetable/facultyTimetablePdf";
import { loadExcelLogo, resolveLogoUrl } from "@/lib/timetable/logoAsset";
import { renderHtmlToPdf } from "@/lib/pdf/htmlToPdf";
import { formatClassColumn, type TeachingLoadGroups, type TeachingLoadRow } from "@/lib/teaching/buildTeachingLoadRows";
import { formatPassPercentage, PREVIOUS_TEACHING_SOURCE_LABELS } from "@/lib/faculty/previousTeaching";
import type { PreviousTeachingAssignment } from "@/types";

// Downloads of the Teaching Load tables shown on the faculty profile. They are
// laid out exactly like the timetable downloads (lib/timetable/sectionTimetablePdf.ts
// and timetableExport.ts): college letterhead with logo, centred title and
// sub-line, then bordered tables - the Current / Previous blocks and columns
// are the same as on screen.

export interface TeachingLoadCollege {
  name?: string;
  code?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
}

export interface TeachingLoadExportInput {
  groups: TeachingLoadGroups;
  previous?: PreviousTeachingAssignment[];
  facultyName?: string;
  department?: string;
  college?: TeachingLoadCollege;
}

type Table = { heading: string; headers: string[]; rows: (string | number)[][]; left: number[] };

const loadRow = (r: TeachingLoadRow, past: boolean): (string | number)[] => [
  r.academicYear || "-",
  formatClassColumn(r) || "-",
  r.subject || "-",
  r.hoursPerWeek ?? "-",
  ...(past ? [r.passPercentage != null ? `${r.passPercentage}%` : "-", r.studentFeedback != null ? `${r.studentFeedback}%` : "-"] : []),
];

function buildTables({ groups, previous = [] }: TeachingLoadExportInput): Table[] {
  const tables: Table[] = [];
  const base = ["Academic Year", "Year / Branch / Semester / Section", "Subject", "Hours Per Week"];
  if (groups.current.length > 0) {
    tables.push({ heading: "Current Teaching Assignments", headers: ["S.No", ...base], rows: groups.current.map((r, i) => [i + 1, ...loadRow(r, false)]), left: [2, 3] });
  }
  if (previous.length > 0) {
    tables.push({
      heading: "Previous Teaching Assignments",
      headers: ["S.No", "Internal / External", "Academic Year", "Course", "Year", "Semester", "Subject", "Passing %"],
      rows: previous.map((r, i) => [
        i + 1,
        `${PREVIOUS_TEACHING_SOURCE_LABELS[r.source]}${r.source === "EXTERNAL" && r.collegeName ? ` - ${r.collegeName}` : ""}`,
        r.academicYear || "-", r.course || "-", r.year || "-", r.semester || "-", r.subject || "-", formatPassPercentage(r.passPercentage) || "-",
      ]),
      left: [1, 6],
    });
  }
  if (groups.past.length > 0) {
    tables.push({
      heading: previous.length > 0 ? "Previous Teaching Assignments (Structured Records)" : "Previous Teaching Assignments",
      headers: ["S.No", ...base, "Student Pass %", "Student Feedback %"],
      rows: groups.past.map((r, i) => [i + 1, ...loadRow(r, true)]),
      left: [2, 3],
    });
  }
  return tables;
}

const subLine = (i: TeachingLoadExportInput) => [i.facultyName, i.department].filter(Boolean).join("  |  ");

// ── PDF ──────────────────────────────────────────────────────────────────────
export async function downloadTeachingLoadPdf(input: TeachingLoadExportInput, filename: string): Promise<void> {
  const c = input.college ?? {};
  const identity = [c.affiliation, c.address, c.phone ? `Tel : ${c.phone}` : ""]
    .filter(Boolean)
    .map((l) => `<div class="identity-line">${escapeHtml(l as string)}</div>`)
    .join("");
  const name = c.name ? `<div class="inst-name">${escapeHtml(c.name)}${c.code ? ` ( Code: ${escapeHtml(c.code)} )` : ""}</div>` : "";
  const logo = `<td class="logo-cell"><img src="${escapeHtml(resolveLogoUrl(c.logoUrl))}" alt="${escapeHtml(c.name ?? "")} logo"></td>`;
  const sub = subLine(input);

  const blocks = buildTables(input).map((t) => `
  <div class="section">
  <div class="section-title">${escapeHtml(t.heading)}</div>
  <table class="grid" cellspacing="0" cellpadding="0">
    <colgroup>${t.headers.map((_, i) => `<col style="width:${i === 0 ? "9mm" : "auto"}">`).join("")}</colgroup>
    <thead><tr>${t.headers.map((h, i) => `<th class="cell${t.left.includes(i) ? " left" : ""}"><div class="fx">${escapeHtml(h)}</div></th>`).join("")}</tr></thead>
    <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => `<td class="cell"><div class="fx${t.left.includes(i) ? " fx-left" : ""}">${escapeHtml(String(v))}</div></td>`).join("")}</tr>`).join("")}</tbody>
  </table>
  </div>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Teaching Load${input.facultyName ? ` - ${escapeHtml(input.facultyName)}` : ""}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    .page { width: 210mm; margin: 0 auto; padding: 12mm 10mm; }
    .letterhead { width: 100%; border: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 10pt; font-weight: 700; overflow-wrap: anywhere; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 4px; }
    .class-line { text-align: center; font-size: 9pt; overflow-wrap: anywhere; }
    table.grid { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 1px solid #555; border-left: 1px solid #555; }
    .cell { border-right: 1px solid #555; border-bottom: 1px solid #555; padding: 0; text-align: center; vertical-align: middle; line-height: 1.2; overflow-wrap: anywhere; }
    .fx { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 22px; padding: 0 4px; font-size: 8.5pt; }
    .fx-left { align-items: flex-start; text-align: left; padding: 0 6px; }
    th.cell { font-weight: 700; font-size: 8.5pt; background: #fff; }
    th.cell > .fx { min-height: 28px; font-size: 8.5pt; font-weight: 700; }
    .section-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 20px 0 8px; }
  </style>
</head>
<body>
  <div class="page">
    <table class="letterhead" cellspacing="0" cellpadding="0">
      <tr>${logo}<td class="letterhead-text">${name}${identity}</td><td class="logo-cell"></td></tr>
    </table>
    <div class="doc-title">TEACHING LOAD</div>
    ${sub ? `<div class="class-line" style="font-weight:600;">${escapeHtml(sub)}</div>` : ""}
    ${blocks}
  </div>
</body>
</html>`;
  await renderHtmlToPdf(html, filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// ── Excel ────────────────────────────────────────────────────────────────────
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
};
const WIDTHS = [8, 18, 34, 38, 16, 18, 20, 16];
const LOGO_COL_WIDTH = 13;

export async function downloadTeachingLoadXlsx(input: TeachingLoadExportInput, filename: string): Promise<void> {
  const c = input.college ?? {};
  const tables = buildTables(input);
  const lastCol = Math.max(3, ...tables.map((t) => t.headers.length));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = c.name || "Teaching Load Export";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Teaching Load", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  for (let i = 1; i <= lastCol; i++) sheet.getColumn(i).width = i === 1 ? Math.max(WIDTHS[0], LOGO_COL_WIDTH) : WIDTHS[i - 1] ?? 16;

  let r = 1;
  const textFrom = 2; // the logo sits in column 1, the letterhead text to its right
  const putAcross = (text: string, font: Partial<ExcelJS.Font>, fromCol = 1) => {
    const row = sheet.getRow(r);
    row.getCell(fromCol).value = text;
    row.getCell(fromCol).font = font;
    row.getCell(fromCol).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (lastCol > fromCol) sheet.mergeCells(r, fromCol, r, lastCol);
    const widthChars = Math.max(10, (lastCol - fromCol + 1) * 14);
    row.height = Math.max(16, (font.size ?? 10) * 1.6) * Math.max(1, Math.ceil((text.length * ((font.size ?? 10) / 10)) / widthChars));
    r++;
  };
  const letterheadStart = r;
  if (c.name) putAcross(`${c.name}${c.code ? ` ( Code: ${c.code} )` : ""}`, { bold: true, size: 14 }, textFrom);
  if (c.affiliation) putAcross(c.affiliation, { bold: true, size: 10 }, textFrom);
  if (c.address) putAcross(c.address, { bold: true, size: 10 }, textFrom);
  if (c.phone) putAcross(`Tel : ${c.phone}`, { bold: true, size: 10 }, textFrom);
  const logo = await loadExcelLogo(c.logoUrl);
  if (logo && r > letterheadStart) {
    try {
      const rowsPx = (sheet.getRows(letterheadStart, r - letterheadStart) ?? []).reduce((n, row) => n + ((row.height ?? 15) * 96) / 72, 0);
      const colPx = (sheet.getColumn(1).width ?? LOGO_COL_WIDTH) * 7 + 5;
      const box = Math.max(24, Math.min(rowsPx - 6, colPx - 8, 84));
      const ratio = logo.width && logo.height ? logo.width / logo.height : 1;
      const w = ratio >= 1 ? box : box * ratio;
      const h = ratio >= 1 ? box / ratio : box;
      const firstRowPx = (((sheet.getRow(letterheadStart).height ?? 15) * 96) / 72) || 20;
      sheet.addImage(workbook.addImage({ base64: logo.base64, extension: logo.extension }), {
        tl: { col: Math.max(0, (colPx - w) / 2 / colPx), row: letterheadStart - 1 + Math.min(0.9, Math.max(0, (rowsPx - h) / 2 / firstRowPx)) },
        ext: { width: w, height: h },
        editAs: "oneCell",
      });
    } catch {
      // A logo that can't be placed must never fail the download.
    }
  }

  putAcross("TEACHING LOAD", { bold: true, size: 13 });
  const sub = subLine(input);
  if (sub) putAcross(sub, { bold: true, size: 10 });

  for (const t of tables) {
    r++; // spacer
    putAcross(t.heading, { bold: true, size: 12 });
    const head = sheet.getRow(r++);
    t.headers.forEach((h, i) => {
      const cell = head.getCell(i + 1);
      cell.value = h;
      cell.border = BORDER;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    head.height = 30;
    for (const values of t.rows) {
      const row = sheet.getRow(r++);
      values.forEach((v, i) => {
        const cell = row.getCell(i + 1);
        cell.value = v;
        cell.border = BORDER;
        cell.font = { size: 10 };
        cell.alignment = { horizontal: t.left.includes(i) ? "left" : "center", vertical: "middle", wrapText: true };
      });
      row.height = 20;
    }
  }

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
