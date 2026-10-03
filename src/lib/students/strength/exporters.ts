import type ExcelJS from "exceljs";
import { romanYear } from "./config";
import type { ProgramMatrix, StrengthReport } from "./types";

// Renders a StrengthReport (already built by query.ts's buildReport from the
// live cube) as a spreadsheet, a CSV or a printable page. Nothing here counts
// anything - it only lays out numbers that were summed from student records,
// so the export is always exactly the report on screen.

export interface ExportContext {
  collegeName: string;
  /** e.g. "2026-27" */
  session: string;
  /** Plain-language filter description, e.g. "B.Tech · IT · II Year". */
  selection: string;
  /** Plain-language status rule. */
  statusRule: string;
  generatedAt: Date;
}

const yearHeading = (y: number) => (y === 0 ? "-" : romanYear(y));
const branchName = (r: { code: string; label: string }) => r.code || r.label;

// ── Excel: the college's strength sheet, generated ─────────────────────────

/**
 * One "Strength" sheet laid out like the office's manual sheet (SL NO / BRANCH /
 * I-IV / TOTAL, one table per program, TOTAL rows, OVERALL STRENGTH) and a flat
 * "Section-wise" sheet (Course / Department / Year / Section / Students) that
 * pivots well. Pass in the ExcelJS constructor so this works in the browser
 * (dynamic import) and in Node tests alike.
 */
export function buildStrengthWorkbook(Excel: typeof ExcelJS, report: StrengthReport, ctx: ExportContext): ExcelJS.Workbook {
  const wb = new Excel.Workbook();
  wb.created = ctx.generatedAt;

  const ws = wb.addWorksheet("Strength", { views: [{ showGridLines: false }] });
  const maxYears = Math.max(2, ...report.matrices.map((m) => m.years.length));
  const lastCol = 2 + maxYears + 1; // SL NO, BRANCH, years..., TOTAL
  const border: Partial<ExcelJS.Borders> = {
    top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" },
  };

  let r = 1;
  const titleRow = (text: string, size: number, bold = true) => {
    ws.mergeCells(r, 1, r, lastCol);
    const c = ws.getCell(r, 1);
    c.value = text;
    c.font = { bold, size };
    c.alignment = { horizontal: "center", vertical: "middle" };
    r += 1;
  };
  titleRow(ctx.collegeName.toUpperCase(), 14);
  titleRow(`${ctx.session} - STUDENT STRENGTH`, 12);
  titleRow(`${ctx.selection}  |  ${ctx.statusRule}`, 10, false);
  r += 1;

  const styleRow = (row: number, from: number, to: number, opts: { bold?: boolean; fill?: string } = {}) => {
    for (let col = from; col <= to; col++) {
      const c = ws.getCell(row, col);
      c.border = border;
      if (opts.bold) c.font = { ...(c.font ?? {}), bold: true };
      if (opts.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
      c.alignment = { horizontal: col <= 2 ? "left" : "center", vertical: "middle" };
    }
  };

  for (const m of report.matrices) {
    const totalCol = 2 + m.years.length + 1;
    ws.mergeCells(r, 1, r, totalCol);
    ws.getCell(r, 1).value = m.label.toUpperCase();
    ws.getCell(r, 1).font = { bold: true, size: 12 };
    ws.getCell(r, 1).alignment = { horizontal: "center" };
    styleRow(r, 1, totalCol, { fill: "FFE7EEF7" });
    r += 1;

    ws.getCell(r, 1).value = "SL NO";
    ws.getCell(r, 2).value = "BRANCH";
    m.years.forEach((y, i) => (ws.getCell(r, 3 + i).value = yearHeading(y)));
    ws.getCell(r, totalCol).value = "TOTAL";
    styleRow(r, 1, totalCol, { bold: true, fill: "FFF3F4F6" });
    r += 1;

    m.rows.forEach((row, idx) => {
      ws.getCell(r, 1).value = idx + 1;
      ws.getCell(r, 2).value = branchName(row);
      m.years.forEach((y, i) => (ws.getCell(r, 3 + i).value = row.byYear[y] ?? 0));
      ws.getCell(r, totalCol).value = row.total;
      styleRow(r, 1, totalCol);
      ws.getCell(r, totalCol).font = { bold: true };
      r += 1;
    });

    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 1).value = "TOTAL";
    m.years.forEach((y, i) => (ws.getCell(r, 3 + i).value = m.byYear[y] ?? 0));
    ws.getCell(r, totalCol).value = m.total;
    styleRow(r, 1, totalCol, { bold: true, fill: "FFF3F4F6" });
    ws.getCell(r, 1).alignment = { horizontal: "center" };
    r += 2;
  }

  ws.mergeCells(r, 1, r, lastCol - 1);
  ws.getCell(r, 1).value = "OVERALL STRENGTH";
  ws.getCell(r, lastCol).value = report.total;
  styleRow(r, 1, lastCol, { bold: true, fill: "FFE7EEF7" });
  ws.getCell(r, 1).alignment = { horizontal: "center" };
  ws.getCell(r, 1).font = { bold: true, size: 12 };
  r += 2;
  ws.mergeCells(r, 1, r, lastCol);
  ws.getCell(r, 1).value = `Generated ${ctx.generatedAt.toLocaleString("en-IN")} from live student records.`;
  ws.getCell(r, 1).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 30;
  for (let c = 3; c <= lastCol; c++) ws.getColumn(c).width = 11;

  const sec = wb.addWorksheet("Section-wise");
  sec.columns = [
    { header: "Course", key: "program", width: 26 },
    { header: "Department", key: "dept", width: 30 },
    { header: "Year", key: "year", width: 8 },
    { header: "Section", key: "section", width: 18 },
    { header: "Students", key: "count", width: 11 },
  ];
  sec.getRow(1).font = { bold: true };
  for (const s of report.sections) {
    sec.addRow({ program: s.programLabel, dept: branchName({ code: s.branchCode, label: s.branchLabel }), year: yearHeading(s.year), section: s.sectionLabel, count: s.count });
  }
  const totalRow = sec.addRow({ program: "TOTAL", count: report.total });
  totalRow.font = { bold: true };
  sec.views = [{ state: "frozen", ySplit: 1 }];

  return wb;
}

// ── CSV: flat section-wise list ────────────────────────────────────────────

export function strengthCsvRows(report: StrengthReport): string[][] {
  const rows: string[][] = [["Course", "Department", "Year", "Section", "Students"]];
  for (const s of report.sections) {
    rows.push([s.programLabel, branchName({ code: s.branchCode, label: s.branchLabel }), yearHeading(s.year), s.sectionLabel, String(s.count)]);
  }
  rows.push(["TOTAL", "", "", "", String(report.total)]);
  return rows;
}

// ── Print: a self-contained page, independent of the app's layout ──────────

const esc = (v: unknown) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function matrixHtml(m: ProgramMatrix): string {
  const head = m.years.map((y) => `<th>${esc(yearHeading(y))}</th>`).join("");
  const body = m.rows
    .map(
      (r, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(branchName(r))}</td>${m.years.map((y) => `<td class="n">${r.byYear[y] ?? 0}</td>`).join("")}<td class="n b">${r.total}</td></tr>`
    )
    .join("");
  const foot = `<tr class="tot"><td colspan="2" class="c">TOTAL</td>${m.years.map((y) => `<td class="n">${m.byYear[y] ?? 0}</td>`).join("")}<td class="n">${m.total}</td></tr>`;
  return `<h3>${esc(m.label.toUpperCase())}</h3><table><thead><tr><th>SL NO</th><th>BRANCH</th>${head}<th>TOTAL</th></tr></thead><tbody>${body}${foot}</tbody></table>`;
}

export function buildPrintHtml(report: StrengthReport, ctx: ExportContext, opts: { includeSections?: boolean } = {}): string {
  const sections = opts.includeSections === false || report.sections.length === 0
    ? ""
    : `<h3 class="pb">SECTION-WISE</h3><table><thead><tr><th>Course</th><th>Department</th><th>Year</th><th>Section</th><th>Students</th></tr></thead><tbody>${report.sections
        .map(
          (s) =>
            `<tr><td>${esc(s.programLabel)}</td><td>${esc(branchName({ code: s.branchCode, label: s.branchLabel }))}</td><td class="c">${esc(yearHeading(s.year))}</td><td>${esc(s.sectionLabel)}</td><td class="n">${s.count}</td></tr>`
        )
        .join("")}<tr class="tot"><td colspan="4" class="c">TOTAL</td><td class="n">${report.total}</td></tr></tbody></table>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Student Strength ${esc(ctx.session)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:16px;text-align:center;margin:0}h2{font-size:13px;text-align:center;margin:4px 0 2px}
  p.sub{text-align:center;color:#555;margin:2px 0 14px;font-size:11px}
  h3{font-size:12px;text-align:center;background:#e7eef7;border:1px solid #333;border-bottom:0;margin:14px 0 0;padding:4px}
  table{border-collapse:collapse;width:100%;margin-bottom:6px}th,td{border:1px solid #333;padding:4px 8px}
  th{background:#f3f4f6}td.n{text-align:center;font-variant-numeric:tabular-nums}td.c{text-align:center}td.b{font-weight:bold}
  tr.tot td{font-weight:bold;background:#f3f4f6}
  .overall{border:1px solid #333;background:#e7eef7;font-weight:bold;font-size:14px;display:flex;justify-content:space-between;padding:6px 10px;margin-top:10px}
  .foot{color:#666;font-size:10px;margin-top:10px}
  @media print{body{margin:10mm}h3.pb{page-break-before:always}tr{page-break-inside:avoid}}
  </style></head><body>
  <h1>${esc(ctx.collegeName.toUpperCase())}</h1>
  <h2>${esc(ctx.session)} - STUDENT STRENGTH</h2>
  <p class="sub">${esc(ctx.selection)} &middot; ${esc(ctx.statusRule)}</p>
  ${report.matrices.map(matrixHtml).join("")}
  <div class="overall"><span>OVERALL STRENGTH</span><span>${report.total}</span></div>
  ${sections}
  <p class="foot">Generated ${esc(ctx.generatedAt.toLocaleString("en-IN"))} from live student records.</p>
  </body></html>`;
}

// ── Browser-only wrappers ──────────────────────────────────────────────────

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadStrengthXlsx(report: StrengthReport, ctx: ExportContext, filename: string): Promise<void> {
  const Excel = (await import("exceljs")).default;
  const wb = buildStrengthWorkbook(Excel, report, ctx);
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

/** Opens the report in a clean window and starts the browser's print dialog. Returns false if a popup blocker stopped it. */
export function printStrengthReport(report: StrengthReport, ctx: ExportContext): boolean {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.open();
  w.document.write(buildPrintHtml(report, ctx));
  w.document.close();
  w.focus();
  // Whichever fires first wins: some browsers have already fired `load` by the
  // time the handler is assigned, others never fire it for document.write.
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try { w.print(); } catch { /* window closed */ }
  };
  w.onload = go;
  setTimeout(go, 500);
  return true;
}
