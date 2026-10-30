import type ExcelJS from "exceljs";
import { romanYear } from "./config";
import type { ProgramMatrix, SectionRow, StrengthReport } from "./types";

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

/** A CSS string literal (for @page margin-box content); safe inside <style>. */
const cssStr = (v: string) => `"${v.replace(/[\\"]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/</g, "\\3c ")}"`;

function matrixHtml(m: ProgramMatrix): string {
  const head = m.years.map((y) => `<th>${esc(yearHeading(y))}</th>`).join("");
  const body = m.rows
    .map(
      (r, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(branchName(r))}</td>${m.years.map((y) => `<td class="n">${r.byYear[y] ?? 0}</td>`).join("")}<td class="n b">${r.total}</td></tr>`
    )
    .join("");
  const foot = `<tr class="tot"><td colspan="2" class="c">TOTAL</td>${m.years.map((y) => `<td class="n">${m.byYear[y] ?? 0}</td>`).join("")}<td class="n">${m.total}</td></tr>`;
  return `<h3>${esc(m.label.toUpperCase())}</h3><table class="summary"><thead><tr><th>SL NO</th><th>BRANCH</th>${head}<th>TOTAL</th></tr></thead><tbody>${body}${foot}</tbody></table>`;
}

const labelCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
/** Years in order, with "year not set" (0) last. */
const byYear = (a: number, b: number) => (a || Infinity) - (b || Infinity) || 0;
/** One numeric cell. `undefined` = no students there: a light-grey en dash, never a made-up 0. */
const numCell = (n: number | undefined) => (n === undefined ? `<td class="n nil">&ndash;</td>` : `<td class="n">${n}</td>`);

/** "CSE-A" -> "A" under CSE. Only a prefix followed by a separator and something more is dropped. */
function stripDeptPrefix(label: string, prefixes: string[]): string {
  const lower = label.toLowerCase();
  for (const p of [...prefixes].filter(Boolean).sort((a, b) => b.length - a.length)) {
    if (!lower.startsWith(p.toLowerCase())) continue;
    const rest = /^[\s\-_:/.]+(.+)$/.exec(label.slice(p.length));
    if (rest && rest[1].trim()) return rest[1].trim();
  }
  return label;
}

interface DeptGroup {
  rows: SectionRow[];
  heading: string;
  name: string;
  total: number;
}

function deptHeading(r: SectionRow, total: number): string {
  const code = r.branchCode.trim();
  const label = r.branchLabel.trim();
  const both = code && label && code.toLowerCase() !== label.toLowerCase();
  return `<span>${both ? `${esc(code)} &mdash; ${esc(label)}` : esc(code || label)}</span><span class="amt">${total}</span>`;
}

/** One department: years as rows, sections as columns, a Total column and a Total row. */
function deptTableHtml(g: DeptGroup): string {
  const years = [...new Set(g.rows.map((r) => r.year))].sort(byYear);
  const first = new Map<string, SectionRow>();
  for (const r of g.rows) if (!first.has(r.section)) first.set(r.section, r);

  // Columns are keyed by the section KEY, never by its label, so two sections can never be merged.
  // If dropping the department prefix would make two labels identical, those keep their full label.
  const prefixes = [g.rows[0].branchCode, g.rows[0].branchLabel];
  const short = new Map([...first].map(([k, r]) => [k, stripDeptPrefix(r.sectionLabel, prefixes)]));
  const shortCount = new Map<string, number>();
  for (const s of short.values()) shortCount.set(s.toLowerCase(), (shortCount.get(s.toLowerCase()) ?? 0) + 1);
  const cols = [...first]
    .map(([key, r]) => ({ key, label: (shortCount.get(short.get(key)!.toLowerCase()) ?? 0) > 1 ? r.sectionLabel : short.get(key)! }))
    .sort((a, b) => labelCollator.compare(a.label, b.label) || labelCollator.compare(a.key, b.key));

  const cell = new Map<string, number>();
  for (const r of g.rows) cell.set(`${r.year}\u0001${r.section}`, (cell.get(`${r.year}\u0001${r.section}`) ?? 0) + r.count);

  const body = years
    .map((y) => {
      const rowTotal = cols.reduce((n, c) => n + (cell.get(`${y}\u0001${c.key}`) ?? 0), 0);
      return `<tr><td class="c">${esc(yearHeading(y))}</td>${cols.map((c) => numCell(cell.get(`${y}\u0001${c.key}`))).join("")}<td class="n b">${rowTotal}</td></tr>`;
    })
    .join("");
  const foot = `<tr class="tot"><td class="c">Total</td>${cols
    .map((c) => `<td class="n">${years.reduce((n, y) => n + (cell.get(`${y}\u0001${c.key}`) ?? 0), 0)}</td>`)
    .join("")}<td class="n">${g.total}</td></tr>`;
  return `<div class="dept"><h4>${deptHeading(g.rows[0], g.total)}</h4><table class="grid"><thead><tr><th>Year</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>Total</th></tr></thead><tbody>${body}${foot}</tbody></table></div>`;
}

/** Departments that have a single section: one shared Department x Year table. */
function singleSectionTableHtml(groups: DeptGroup[]): string {
  const years = [...new Set(groups.flatMap((g) => g.rows.map((r) => r.year)))].sort(byYear);
  const body = groups
    .map((g) => {
      const byY = new Map<number, number>();
      for (const r of g.rows) byY.set(r.year, (byY.get(r.year) ?? 0) + r.count);
      return `<tr><td>${esc(g.name)}</td>${years.map((y) => numCell(byY.get(y))).join("")}<td class="n b">${g.total}</td></tr>`;
    })
    .join("");
  const foot = `<tr class="tot"><td class="c">Total</td>${years
    .map((y) => `<td class="n">${groups.reduce((n, g) => n + g.rows.filter((r) => r.year === y).reduce((m, r) => m + r.count, 0), 0)}</td>`)
    .join("")}<td class="n">${groups.reduce((n, g) => n + g.total, 0)}</td></tr>`;
  return `<div class="dept"><h4><span>Departments with a single section</span></h4><table class="grid"><thead><tr><th>Department</th>${years.map((y) => `<th>${esc(yearHeading(y))}</th>`).join("")}<th>Total</th></tr></thead><tbody>${body}${foot}</tbody></table></div>`;
}

/**
 * Section-wise part of the print page: per course, per department, years x
 * sections. Sections with no students are left out. Every student in
 * `report.sections` lands in exactly one cell, so the figures still add up to
 * the report total.
 */
function sectionBlocksHtml(sections: SectionRow[]): string {
  const courses = new Map<string, { label: string; depts: Map<string, DeptGroup> }>();
  for (const s of sections) {
    if (s.count <= 0) continue;
    let course = courses.get(s.program);
    if (!course) courses.set(s.program, (course = { label: s.programLabel, depts: new Map() }));
    let dept = course.depts.get(s.branch);
    if (!dept) course.depts.set(s.branch, (dept = { rows: [], heading: "", name: branchName({ code: s.branchCode, label: s.branchLabel }), total: 0 }));
    dept.rows.push(s);
    dept.total += s.count;
  }

  return [...courses.values()]
    .map((course) => {
      const groups = [...course.depts.values()];
      // A department with exactly one section (the same one in every year it has students) joins the shared table.
      const isSingle = (g: DeptGroup) => new Set(g.rows.map((r) => r.section)).size === 1;
      const multi = groups.filter((g) => !isSingle(g));
      const single = groups.filter(isSingle);
      return `<h3 class="course">${esc(course.label.toUpperCase())}</h3><div class="depts">${multi.map(deptTableHtml).join("")}${single.length ? singleSectionTableHtml(single) : ""}</div>`;
    })
    .join("");
}

export function buildPrintHtml(report: StrengthReport, ctx: ExportContext, opts: { includeSections?: boolean } = {}): string {
  const blocks = opts.includeSections === false ? "" : sectionBlocksHtml(report.sections);
  const sections = blocks ? `<h3 class="pb">SECTION-WISE</h3>${blocks}` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>Student Strength ${esc(ctx.session)}</title><style>
  :root{--ink:#111827;--muted:#6b7280;--rule:#e5e7eb;--rule-strong:#9ca3af;--tint:#f3f4f6;--accent:#1d4ed8}
  @page{size:A4;margin:14mm 12mm;
    @bottom-left{content:${cssStr("Generated " + ctx.generatedAt.toLocaleString("en-IN") + " from live student records.")};font:9px "Segoe UI",Roboto,Arial,sans-serif;color:#6b7280}
    @bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px "Segoe UI",Roboto,Arial,sans-serif;color:#6b7280}}
  html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);margin:0;font-size:11px;line-height:1.35}
  header.hd{border-bottom:2px solid var(--accent);padding-bottom:8px;margin-bottom:14px}
  h1{font-size:22px;font-weight:700;letter-spacing:.01em;margin:0}
  h2{font-size:13px;font-weight:600;color:var(--muted);margin:3px 0 0}
  p.sub{color:var(--muted);margin:2px 0 0;font-size:10.5px}
  h3{font-size:11.5px;font-weight:700;letter-spacing:.05em;margin:16px 0 6px;padding-bottom:3px;border-bottom:1px solid var(--rule-strong);break-after:avoid;page-break-after:avoid}
  h3.pb{font-size:9.5px;font-weight:600;letter-spacing:.16em;color:var(--muted);border:0;padding:0;margin:0 0 2px}
  h3.course{margin-top:10px}
  table{border-collapse:collapse;width:100%;table-layout:fixed;margin-bottom:4px}
  th,td{padding:6px 10px;border:0;border-bottom:1px solid var(--rule);text-align:left;overflow-wrap:anywhere}
  th{background:var(--tint);color:var(--muted);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--rule-strong);text-align:right}
  th:first-child{text-align:left}
  td.n{text-align:right;font-variant-numeric:tabular-nums}
  td.nil{color:#c4c8ce}
  td.b,tr.tot td:last-child{background:var(--tint);font-weight:700}
  tbody tr:last-child td{border-bottom:0}
  tr.tot td{font-weight:700;border-top:1.5px solid var(--ink);border-bottom:0}
  table.summary th:nth-child(1){width:9%}table.summary th:nth-child(2){width:30%;text-align:left}
  table.grid th:first-child{width:24%}
  .depts{display:grid;grid-template-columns:1fr 1fr;gap:6px 22px;align-items:start}
  .dept{break-inside:avoid;page-break-inside:avoid}
  h4{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12px;font-weight:700;margin:8px 0 4px;break-after:avoid;page-break-after:avoid}
  h4 .amt{font-variant-numeric:tabular-nums;white-space:nowrap}
  .overall{display:flex;justify-content:space-between;align-items:baseline;background:var(--tint);border-top:1px solid var(--rule-strong);border-bottom:1px solid var(--rule-strong);padding:12px 14px;margin:16px 0 4px;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .overall span:last-child{font-size:34px;font-weight:700;letter-spacing:0;color:var(--accent);font-variant-numeric:tabular-nums;line-height:1}
  .foot{color:var(--muted);font-size:10px;margin-top:10px}
  tr{break-inside:avoid;page-break-inside:avoid}
  @media screen{body{max-width:210mm;margin:0 auto;padding:14mm 12mm}}
  @media print{h3.pb{page-break-before:always}.foot{display:none}}
  </style></head><body>
  <header class="hd">
  <h1>${esc(ctx.collegeName.toUpperCase())}</h1>
  <h2>${esc(ctx.session)} - STUDENT STRENGTH</h2>
  <p class="sub">${esc(ctx.selection)} &middot; ${esc(ctx.statusRule)}</p>
  </header>
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
