// Exports of the staff Student Attendance report (components/attendance/StudentAttendanceReportView.tsx): the
// detailed subject-wise report (Excel + print), the shortage list, one sheet per subject, the date-wise register and
// a flat CSV table. Everything is built in the browser from what the report already loaded - the same numbers the
// screen shows. Layout follows the college's printed report (studentReportExport.ts): letterhead, title, the
// class block, the table, then the signature line.

import { dayCellText, registerTotals, type DayCell } from "./dayRegister";

export interface ExportSubject { subjectId: string; subjectName: string; subjectCode: string; shortCode?: string }
export interface ExportTally { held: number; attended: number; percentage: number | null }
export interface ExportRow {
  studentId: string;
  rollNumber: string;
  name: string;
  labBatch?: string;
  absentDays?: number;
  bySubject: Record<string, ExportTally>;
  /** Over the subjects shown (the report's subject filter) - the "Total" columns. */
  shown: ExportTally;
}
export interface ExportSection { name: string; batch?: string; subjects: ExportSubject[]; rows: ExportRow[] }
export interface ExportCollege { name: string; address: string; phone: string; logoUrl: string }
export interface ExportMeta {
  college: ExportCollege;
  course: string;
  department: string;
  semester: string;
  period: string;
  filters: string[];
  generatedBy: string;
  generatedAt: Date;
  threshold: number;
}
export interface RegisterSection {
  name: string;
  dates: string[];
  students: { studentId: string; rollNumber: string; name: string; labBatch?: string; days: Record<string, DayCell> }[];
}

export const SIGNATURES = ["Class In-charge", "HOD", "Principal"];

/** The college prints percentages with two decimals ("95.36"). */
export const pct2 = (p: number | null | undefined): string => (p == null ? "-" : p.toFixed(2));
/** A subject column's heading: its short name (Subject Acronym), else its code, else its name. */
export const subjectLabel = (s: ExportSubject): string => s.shortCode || s.subjectCode || s.subjectName;
const below = (p: number | null | undefined, threshold: number) => p != null && p < threshold;

/**
 * Further classes a student must attend (with none missed) to reach `threshold`%: the smallest n with
 * (attended + n) / (held + n) >= threshold / 100. 0 when already there or nothing was held; null when the
 * threshold is 100% (unreachable after any absence).
 */
export function classesNeeded(attended: number, held: number, threshold: number): number | null {
  if (held <= 0 || attended * 100 >= threshold * held) return 0;
  if (threshold >= 100) return null;
  return Math.ceil((threshold * held - 100 * attended) / (100 - threshold));
}

/** Per subject of a section: classes held (the most any student had), the class average % and how many are below. */
export function subjectStats(section: ExportSection, threshold: number): Record<string, { held: number; average: number | null; below: number }> {
  const out: Record<string, { held: number; average: number | null; below: number }> = {};
  for (const s of section.subjects) {
    let held = 0, sum = 0, n = 0, low = 0;
    for (const r of section.rows) {
      const t = r.bySubject[s.subjectId];
      if (!t) continue;
      held = Math.max(held, t.held);
      if (t.percentage != null) { sum += t.percentage; n += 1; if (t.percentage < threshold) low += 1; }
    }
    out[s.subjectId] = { held, average: n ? sum / n : null, below: low };
  }
  return out;
}

export interface ShortageEntry {
  section: string; rollNumber: string; name: string; held: number; attended: number; percentage: number | null;
  needed: number | null; shortSubjects: string;
}

/** Students whose overall % is below the threshold, with the subjects they are short in. */
export function shortageList(sections: ExportSection[], threshold: number): ShortageEntry[] {
  const out: ShortageEntry[] = [];
  for (const sec of sections) {
    for (const r of sec.rows) {
      if (!below(r.shown.percentage, threshold)) continue;
      const short = sec.subjects
        .filter((s) => below(r.bySubject[s.subjectId]?.percentage, threshold))
        .map((s) => `${subjectLabel(s)} (${pct2(r.bySubject[s.subjectId].percentage)})`);
      out.push({
        section: sec.name, rollNumber: r.rollNumber, name: r.name, held: r.shown.held, attended: r.shown.attended,
        percentage: r.shown.percentage, needed: classesNeeded(r.shown.attended, r.shown.held, threshold), shortSubjects: short.join(", "),
      });
    }
  }
  return out;
}

/** The class block printed under the title. */
export function metaLines(meta: ExportMeta, sectionNames: string): [string, string][] {
  return [
    ["Course", meta.course || "-"],
    ["Department", meta.department || "-"],
    ["Semester", meta.semester || "-"],
    ["Section", sectionNames || "-"],
    ["Period", meta.period],
    ...(meta.filters.length ? [["Filters", meta.filters.join("; ")] as [string, string]] : []),
    ["Generated", `${meta.generatedAt.toLocaleString("en-IN")}${meta.generatedBy ? ` by ${meta.generatedBy}` : ""}`],
  ];
}

const letterheadLines = (c: ExportCollege) => [c.name.toUpperCase(), c.address, c.phone ? `Tel : ${c.phone}` : ""].filter(Boolean);

/** One flat table (one header row) of a section - the CSV, and the "All Sections" summary uses the totals part. */
export function detailedFlatTable(section: ExportSection, threshold: number, withBatch: boolean): { headers: string[]; rows: (string | number)[][] } {
  const headers = [
    "S.No", "Section", ...(withBatch ? ["Batch"] : []), "Regd. No", "Name",
    ...section.subjects.flatMap((s) => [`${subjectLabel(s)} Held`, `${subjectLabel(s)} Attended`, `${subjectLabel(s)} %`]),
    "Total Held", "Total Attended", "Overall %", "Absent Periods", "Days Absent", `Classes to Reach ${threshold}%`,
  ];
  const rows = section.rows.map((r, i) => [
    i + 1, section.name, ...(withBatch ? [r.labBatch || "Not assigned"] : []), r.rollNumber, r.name,
    ...section.subjects.flatMap((s) => {
      const t = r.bySubject[s.subjectId];
      return t ? [t.held, t.attended, pct2(t.percentage)] : ["-", "-", "-"];
    }),
    r.shown.held, r.shown.attended, pct2(r.shown.percentage), r.shown.held - r.shown.attended, r.absentDays ?? 0,
    classesNeeded(r.shown.attended, r.shown.held, threshold) ?? "-",
  ]);
  return { headers, rows };
}

// ── Excel ───────────────────────────────────────────────────────────────────

type ExcelModule = typeof import("exceljs");
type Workbook = InstanceType<ExcelModule["Workbook"]>;
type Worksheet = ReturnType<Workbook["addWorksheet"]>;

const thin = { style: "thin" as const };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E5E5" } };
const RED = { color: { argb: "FFB91C1C" }, bold: true };

/** Excel sheet names: <= 31 characters, none of []:*?/\, unique in the workbook. */
export function sheetName(wanted: string, used: Set<string>): string {
  const base = (wanted.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 31);
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** Letterhead, title and class block across `width` columns. Returns the next free row number. */
function sheetHeading(ws: Worksheet, width: number, meta: ExportMeta, title: string, sectionNames: string) {
  const centered = (text: string, size: number, bold = true) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, Math.max(width, 1));
    row.getCell(1).font = { bold, size };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  const [name, ...rest] = letterheadLines(meta.college);
  if (name) centered(name, 14);
  for (const line of rest) centered(line, 11, false);
  centered(title, 12);
  for (const [k, v] of metaLines(meta, sectionNames)) {
    const row = ws.addRow([`${k} : ${v}`]);
    ws.mergeCells(row.number, 1, row.number, Math.max(width, 1));
  }
  ws.addRow([]);
}

function signatureRows(ws: Worksheet, width: number) {
  ws.addRow([]);
  ws.addRow([]);
  const row = ws.addRow([]);
  const step = Math.max(1, Math.floor(width / SIGNATURES.length));
  SIGNATURES.forEach((label, i) => { const c = row.getCell(1 + i * step); c.value = label; c.font = { bold: true }; });
}

function styleHeader(row: { eachCell: (fn: (c: { font: unknown; fill: unknown; border: unknown; alignment: unknown }) => void) => void }) {
  row.eachCell((c) => { c.font = { bold: true }; c.fill = HEAD_FILL; c.border = BORDER; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
}

/** The detailed report: a sheet per section (subject Held / Attended / % under each subject), plus "All Sections". */
export function buildDetailedWorkbook(Excel: ExcelModule, meta: ExportMeta, sections: ExportSection[], withBatch: boolean): Workbook {
  const wb = new Excel.Workbook();
  const used = new Set<string>();
  const t = meta.threshold;
  for (const sec of sections) {
    const ws = wb.addWorksheet(sheetName(sec.name, used));
    const lead = withBatch ? 4 : 3; // S.No, Regd. No, Name (+ Batch)
    const width = lead + sec.subjects.length * 3 + 6;
    sheetHeading(ws, width, meta, "STUDENT ATTENDANCE REPORT", sec.name + (sec.batch ? ` (${sec.batch})` : ""));

    const top = ws.addRow([
      "S.No", ...(withBatch ? ["Batch"] : []), "Regd. No", "Name",
      ...sec.subjects.flatMap((s) => [subjectLabel(s), "", ""]),
      "Total", "", "", "Absent Periods", "Days Absent", `Classes to Reach ${t}%`,
    ]);
    const sub = ws.addRow([
      ...Array(lead).fill(""), ...sec.subjects.flatMap(() => ["Held", "Att", "%"]), "Held", "Att", "%", "", "", "",
    ]);
    for (let c = 1; c <= lead; c++) ws.mergeCells(top.number, c, sub.number, c);
    sec.subjects.forEach((_, i) => ws.mergeCells(top.number, lead + 1 + i * 3, top.number, lead + 3 + i * 3));
    const totalCol = lead + sec.subjects.length * 3 + 1;
    ws.mergeCells(top.number, totalCol, top.number, totalCol + 2);
    for (let c = totalCol + 3; c <= totalCol + 5; c++) ws.mergeCells(top.number, c, sub.number, c);
    styleHeader(top);
    styleHeader(sub);

    sec.rows.forEach((r, i) => {
      const cells: (string | number | null)[] = [i + 1, ...(withBatch ? [r.labBatch || "Not assigned"] : []), r.rollNumber, r.name];
      const lowCols: number[] = [];
      for (const s of sec.subjects) {
        const v = r.bySubject[s.subjectId];
        cells.push(v ? v.held : null, v ? v.attended : null, v?.percentage ?? null);
        if (below(v?.percentage, t)) lowCols.push(cells.length);
      }
      cells.push(r.shown.held, r.shown.attended, r.shown.percentage);
      if (below(r.shown.percentage, t)) lowCols.push(cells.length);
      cells.push(r.shown.held - r.shown.attended, r.absentDays ?? 0, classesNeeded(r.shown.attended, r.shown.held, t));
      const row = ws.addRow(cells);
      row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; });
      for (let k = 0; k < sec.subjects.length + 1; k++) row.getCell(lead + 3 + k * 3).numFmt = "0.00";
      for (const col of lowCols) row.getCell(col).font = RED;
      if (below(r.shown.percentage, t)) row.getCell(withBatch ? 4 : 3).font = RED;
    });

    const stats = subjectStats(sec, t);
    const footer = (label: string, value: (id: string) => string | number | null, total: (string | number | null)[]) => {
      const cells: (string | number | null)[] = [label, ...Array(lead - 1).fill("")];
      for (const s of sec.subjects) cells.push(value(s.subjectId), "", "");
      cells.push(...total);
      const row = ws.addRow(cells);
      ws.mergeCells(row.number, 1, row.number, lead);
      sec.subjects.forEach((_, i) => ws.mergeCells(row.number, lead + 1 + i * 3, row.number, lead + 3 + i * 3));
      row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; c.font = { bold: true }; c.fill = HEAD_FILL; c.alignment = { horizontal: "center" }; });
      row.getCell(1).alignment = { horizontal: "right" };
    };
    const shownHeld = Math.max(0, ...sec.rows.map((r) => r.shown.held));
    const shownPcts = sec.rows.map((r) => r.shown.percentage).filter((p): p is number => p != null);
    footer("Classes Held", (id) => stats[id].held, [shownHeld, "", ""]);
    footer("Class Average %", (id) => pct2(stats[id].average), ["", "", shownPcts.length ? pct2(shownPcts.reduce((a, b) => a + b, 0) / shownPcts.length) : "-"]);
    footer(`Students Below ${t}%`, (id) => stats[id].below, ["", "", shownPcts.filter((p) => p < t).length]);

    signatureRows(ws, width);
    ws.getColumn(1).width = 6;
    if (withBatch) ws.getColumn(2).width = 12;
    ws.getColumn(lead - 1).width = 15;
    ws.getColumn(lead).width = 28;
    for (let c = lead + 1; c <= width; c++) ws.getColumn(c).width = 7;
    for (let c = totalCol + 3; c <= totalCol + 5; c++) ws.getColumn(c).width = 11;
    ws.views = [{ state: "frozen", xSplit: lead, ySplit: sub.number }];
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }

  if (sections.length > 1) {
    const ws = wb.addWorksheet(sheetName("All Sections", used));
    const headers = ["S.No", "Section", ...(withBatch ? ["Batch"] : []), "Regd. No", "Name", "Held", "Attended", "Overall %", "Days Absent", `Classes to Reach ${t}%`];
    sheetHeading(ws, headers.length, meta, "STUDENT ATTENDANCE REPORT - ALL SECTIONS", sections.map((s) => s.name).join(", "));
    styleHeader(ws.addRow(headers));
    let n = 0;
    for (const sec of sections) for (const r of sec.rows) {
      const row = ws.addRow([
        ++n, sec.name, ...(withBatch ? [r.labBatch || "Not assigned"] : []), r.rollNumber, r.name,
        r.shown.held, r.shown.attended, r.shown.percentage, r.absentDays ?? 0, classesNeeded(r.shown.attended, r.shown.held, t),
      ]);
      row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; });
      const pctCell = row.getCell(withBatch ? 8 : 7);
      pctCell.numFmt = "0.00";
      if (below(r.shown.percentage, t)) pctCell.font = RED;
    }
    signatureRows(ws, headers.length);
    headers.forEach((h, i) => { ws.getColumn(i + 1).width = h === "Name" ? 28 : h === "Regd. No" ? 15 : 11; });
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return wb;
}

/** Students below the threshold, the subjects they are short in and the classes they need. */
export function buildShortageWorkbook(Excel: ExcelModule, meta: ExportMeta, sections: ExportSection[]): Workbook {
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("Shortage List");
  const t = meta.threshold;
  const headers = ["S.No", "Section", "Regd. No", "Name", "Held", "Attended", "Overall %", `Classes to Reach ${t}%`, `Subjects Below ${t}%`];
  sheetHeading(ws, headers.length, meta, `ATTENDANCE SHORTAGE LIST (BELOW ${t}%)`, sections.map((s) => s.name).join(", "));
  styleHeader(ws.addRow(headers));
  shortageList(sections, t).forEach((e, i) => {
    const row = ws.addRow([i + 1, e.section, e.rollNumber, e.name, e.held, e.attended, e.percentage, e.needed ?? "-", e.shortSubjects]);
    row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; c.alignment = { vertical: "top", wrapText: true }; });
    row.getCell(7).numFmt = "0.00";
    row.getCell(7).font = RED;
  });
  signatureRows(ws, headers.length);
  [6, 10, 15, 28, 8, 9, 10, 12, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return wb;
}

/** One sheet per subject (every section that has it): each student's held / attended / %. */
export function buildSubjectWorkbook(Excel: ExcelModule, meta: ExportMeta, sections: ExportSection[]): Workbook {
  const wb = new Excel.Workbook();
  const used = new Set<string>();
  const t = meta.threshold;
  const subjects = new Map<string, ExportSubject>();
  for (const sec of sections) for (const s of sec.subjects) if (!subjects.has(s.subjectId)) subjects.set(s.subjectId, s);
  for (const s of subjects.values()) {
    const ws = wb.addWorksheet(sheetName(subjectLabel(s), used));
    const headers = ["S.No", "Section", "Regd. No", "Name", "Held", "Attended", "%"];
    sheetHeading(ws, headers.length, meta, `SUBJECT ATTENDANCE - ${s.subjectName}${s.subjectCode ? ` (${s.subjectCode})` : ""}`, sections.filter((x) => x.subjects.some((y) => y.subjectId === s.subjectId)).map((x) => x.name).join(", "));
    styleHeader(ws.addRow(headers));
    let n = 0;
    for (const sec of sections) {
      if (!sec.subjects.some((y) => y.subjectId === s.subjectId)) continue;
      for (const r of sec.rows) {
        const v = r.bySubject[s.subjectId];
        const row = ws.addRow([++n, sec.name, r.rollNumber, r.name, v?.held ?? null, v?.attended ?? null, v?.percentage ?? null]);
        row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; });
        row.getCell(7).numFmt = "0.00";
        if (below(v?.percentage, t)) row.getCell(7).font = RED;
      }
    }
    signatureRows(ws, headers.length);
    [6, 10, 15, 28, 9, 9, 9].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
  return wb;
}

/** "18-11" for a column heading. */
export const shortDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;

/** Students down the side, each date across: periods present / held that day, "A" absent all day, "OD" on duty. */
export function buildRegisterWorkbook(Excel: ExcelModule, meta: ExportMeta, sections: RegisterSection[]): Workbook {
  const wb = new Excel.Workbook();
  const used = new Set<string>();
  const t = meta.threshold;
  for (const sec of sections) {
    const ws = wb.addWorksheet(sheetName(sec.name, used));
    const headers = ["S.No", "Regd. No", "Name", ...sec.dates.map(shortDate), "Held", "Present", "%", "Days Absent"];
    sheetHeading(ws, headers.length, meta, "DATE-WISE ATTENDANCE REGISTER", sec.name);
    const headRow = ws.addRow(headers);
    styleHeader(headRow);
    sec.students.forEach((s, i) => {
      const tot = registerTotals(s.days);
      const p = tot.held ? (tot.present * 100) / tot.held : null;
      const row = ws.addRow([i + 1, s.rollNumber, s.name, ...sec.dates.map((d) => dayCellText(s.days[d])), tot.held, tot.present, p, tot.absentDays]);
      row.eachCell({ includeEmpty: true }, (c) => { c.border = BORDER; c.alignment = { horizontal: "center" }; });
      row.getCell(3).alignment = { horizontal: "left" };
      sec.dates.forEach((d, k) => { if (dayCellText(s.days[d]) === "A") row.getCell(4 + k).font = RED; });
      const pc = row.getCell(4 + sec.dates.length + 2);
      pc.numFmt = "0.00";
      if (below(p, t)) pc.font = RED;
    });
    ws.addRow([]);
    ws.addRow(["Each date: periods present / periods held. A = absent all day, OD = on duty (not counted)."]);
    signatureRows(ws, headers.length);
    ws.getColumn(1).width = 6;
    ws.getColumn(2).width = 15;
    ws.getColumn(3).width = 26;
    for (let c = 4; c <= headers.length; c++) ws.getColumn(c).width = 6.5;
    ws.views = [{ state: "frozen", xSplit: 3, ySplit: headRow.number }];
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  }
  return wb;
}

// ── Print (the browser's print dialog, which also saves as PDF) ─────────────

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PRINT_CSS = `
  @page{size:A4 landscape;margin:10mm}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:10px}
  .page{page-break-after:always}.page:last-child{page-break-after:auto}
  table.head{margin:0 auto;border-collapse:collapse}table.head td{padding:2px 6px;text-align:center}
  table.head img{width:64px;height:64px;object-fit:contain}
  .name{font-size:15px;font-weight:bold}.line{font-size:11px}
  h2{font-size:13px;text-align:center;margin:8px 0 4px}
  .meta{display:flex;flex-wrap:wrap;gap:2px 18px;justify-content:center;margin:0 0 8px;font-size:10px}
  .meta b{font-weight:bold}
  table.rep{border-collapse:collapse;width:100%}table.rep th,table.rep td{border:1px solid #888;padding:2px 3px;text-align:center}
  table.rep th{background:#e5e5e5}table.rep td.l{text-align:left}
  .low{color:#b91c1c;font-weight:bold}tr.foot td{font-weight:bold;background:#f0f0f0}
  tr{page-break-inside:avoid}thead{display:table-header-group}
  .sign{display:flex;justify-content:space-between;margin:40px 30px 0;font-weight:bold}
  .note{color:#555;margin-top:6px}`;

function printHeading(meta: ExportMeta, logoSrc: string, title: string, sectionNames: string): string {
  const [name, ...rest] = letterheadLines(meta.college);
  return `<table class="head"><tr>${logoSrc ? `<td><img src="${esc(logoSrc)}" alt=""></td>` : ""}<td><div class="name">${esc(name ?? "")}</div>${rest.map((l) => `<div class="line">${esc(l)}</div>`).join("")}</td></tr></table>
  <h2>${esc(title)}</h2>
  <div class="meta">${metaLines(meta, sectionNames).map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("")}</div>`;
}
const signLine = () => `<div class="sign">${SIGNATURES.map((s) => `<span>${esc(s)}</span>`).join("")}</div>`;
const doc = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;

export function detailedPrintHtml(meta: ExportMeta, sections: ExportSection[], withBatch: boolean, logoSrc: string): string {
  const t = meta.threshold;
  const pages = sections.map((sec) => {
    const stats = subjectStats(sec, t);
    const lead = withBatch ? 4 : 3;
    const head1 = `<tr><th rowspan="2">S.No</th>${withBatch ? "<th rowspan=\"2\">Batch</th>" : ""}<th rowspan="2">Regd. No</th><th rowspan="2">Name</th>${sec.subjects.map((s) => `<th colspan="3" title="${esc(s.subjectName)}">${esc(subjectLabel(s))}</th>`).join("")}<th colspan="3">Total</th><th rowspan="2">Days Absent</th><th rowspan="2">To ${t}%</th></tr>`;
    const head2 = `<tr>${sec.subjects.map(() => "<th>H</th><th>A</th><th>%</th>").join("")}<th>H</th><th>A</th><th>%</th></tr>`;
    const body = sec.rows.map((r, i) => {
      const cells = sec.subjects.map((s) => {
        const v = r.bySubject[s.subjectId];
        return v ? `<td>${v.held}</td><td>${v.attended}</td><td${below(v.percentage, t) ? ' class="low"' : ""}>${pct2(v.percentage)}</td>` : "<td>-</td><td>-</td><td>-</td>";
      }).join("");
      const low = below(r.shown.percentage, t);
      return `<tr><td>${i + 1}</td>${withBatch ? `<td>${esc(r.labBatch || "-")}</td>` : ""}<td>${esc(r.rollNumber)}</td><td class="l${low ? " low" : ""}">${esc(r.name)}</td>${cells}<td>${r.shown.held}</td><td>${r.shown.attended}</td><td${low ? ' class="low"' : ""}>${pct2(r.shown.percentage)}</td><td>${r.absentDays ?? 0}</td><td>${classesNeeded(r.shown.attended, r.shown.held, t) ?? "-"}</td></tr>`;
    }).join("");
    const foot = (label: string, f: (id: string) => string | number) =>
      `<tr class="foot"><td colspan="${lead}" style="text-align:right">${esc(label)}</td>${sec.subjects.map((s) => `<td colspan="3">${esc(f(s.subjectId))}</td>`).join("")}<td colspan="5"></td></tr>`;
    return `<div class="page">${printHeading(meta, logoSrc, "STUDENT ATTENDANCE REPORT", sec.name + (sec.batch ? ` (${sec.batch})` : ""))}
      <table class="rep"><thead>${head1}${head2}</thead><tbody>${body}
      ${foot("Classes Held", (id) => stats[id].held)}${foot("Class Average %", (id) => pct2(stats[id].average))}${foot(`Below ${t}%`, (id) => stats[id].below)}</tbody></table>
      <p class="note">H = classes held, A = attended. Percentages below ${t} are in red. "To ${t}%" = further classes to attend, missing none, to reach ${t}%.</p>${signLine()}</div>`;
  }).join("");
  return doc("Student Attendance Report", pages);
}

export function shortagePrintHtml(meta: ExportMeta, sections: ExportSection[], logoSrc: string): string {
  const t = meta.threshold;
  const rows = shortageList(sections, t).map((e, i) =>
    `<tr><td>${i + 1}</td><td>${esc(e.section)}</td><td>${esc(e.rollNumber)}</td><td class="l">${esc(e.name)}</td><td>${e.held}</td><td>${e.attended}</td><td class="low">${pct2(e.percentage)}</td><td>${e.needed ?? "-"}</td><td class="l">${esc(e.shortSubjects)}</td></tr>`).join("");
  return doc("Attendance Shortage List", `<div class="page">${printHeading(meta, logoSrc, `ATTENDANCE SHORTAGE LIST (BELOW ${t}%)`, sections.map((s) => s.name).join(", "))}
    <table class="rep"><thead><tr><th>S.No</th><th>Section</th><th>Regd. No</th><th>Name</th><th>Held</th><th>Attended</th><th>Overall %</th><th>Classes to Reach ${t}%</th><th>Subjects Below ${t}%</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="9">No student is below ${t}%.</td></tr>`}</tbody></table>${signLine()}</div>`);
}

export function registerPrintHtml(meta: ExportMeta, sections: RegisterSection[], logoSrc: string): string {
  const t = meta.threshold;
  const pages = sections.map((sec) => {
    const body = sec.students.map((s, i) => {
      const tot = registerTotals(s.days);
      const p = tot.held ? (tot.present * 100) / tot.held : null;
      return `<tr><td>${i + 1}</td><td>${esc(s.rollNumber)}</td><td class="l">${esc(s.name)}</td>${sec.dates.map((d) => {
        const txt = dayCellText(s.days[d]);
        return `<td${txt === "A" ? ' class="low"' : ""}>${esc(txt)}</td>`;
      }).join("")}<td>${tot.held}</td><td>${tot.present}</td><td${below(p, t) ? ' class="low"' : ""}>${pct2(p)}</td><td>${tot.absentDays}</td></tr>`;
    }).join("");
    return `<div class="page">${printHeading(meta, logoSrc, "DATE-WISE ATTENDANCE REGISTER", sec.name)}
      <table class="rep"><thead><tr><th>S.No</th><th>Regd. No</th><th>Name</th>${sec.dates.map((d) => `<th>${esc(shortDate(d))}</th>`).join("")}<th>Held</th><th>Present</th><th>%</th><th>Days Absent</th></tr></thead>
      <tbody>${body}</tbody></table>
      <p class="note">Each date: periods present / periods held. A = absent all day, OD = on duty (not counted).</p>${signLine()}</div>`;
  }).join("");
  return doc("Date-wise Attendance Register", pages);
}

// ── Browser helpers ─────────────────────────────────────────────────────────

/** The logo as an absolute URL (a print window has no base URL of its own). */
export function logoSrcOf(college: ExportCollege): string {
  const logo = college.logoUrl || "/vishnulogo.png";
  return /^https?:/i.test(logo) ? logo : new URL(logo, window.location.origin).href;
}

/** Opens the HTML in a clean window and starts the print dialog (which can also save as PDF). False when a popup blocker stopped it. */
export function printHtml(html: string): boolean {
  const w = window.open("", "_blank", "width=1200,height=900");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try { w.print(); } catch { /* window closed */ }
  };
  w.onload = go;
  setTimeout(go, 800);
  return true;
}

/** Builds a workbook with exceljs (loaded on demand) and saves it. */
export async function saveWorkbook(build: (Excel: ExcelModule) => Workbook, filename: string): Promise<void> {
  const Excel = (await import("exceljs")).default as unknown as ExcelModule;
  const buffer = await build(Excel).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** A safe file name piece. */
export const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "report";
