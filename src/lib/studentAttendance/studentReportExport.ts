// Payload of GET /api/college/student/me/attendance (a loaded report) and the
// Print / Excel builders for it. The layout follows the college's existing
// printed report: letterhead, ATTENDANCE REPORT, the student block, then
// Sl.No / Subject / Held / Attend / % with a TOTAL row - short codes only.

export interface StudentReportRow {
  subjectId: string;
  /** Subject short code (falls back to the subject code when none is set). */
  code: string;
  held: number;
  attended: number;
  percent: number | null;
}

export interface StudentReportData {
  college: { name: string; address: string; phone: string; logoUrl: string };
  scope: { view: string; label: string; from: string | null; to: string | null };
  student: {
    rollNumber: string;
    name: string;
    course: string; // "B.Tech"
    branch: string; // "CSE"
    classLabel: string; // "III/IV Semester-I"
  };
  subjects: StudentReportRow[];
  total: { held: number; attended: number; percent: number | null };
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The report's two-decimal percentage, as the college prints it ("95.36", "100.00"). */
const pct = (p: number | null) => (p == null ? "-" : p.toFixed(2));

/** [label, value] lines under the letterhead. */
export function studentReportIdentity(report: StudentReportData): [string, string][] {
  const { student, scope } = report;
  return [
    ["RollNo", student.rollNumber],
    ["Student Name", student.name],
    ["Course", student.course || "-"],
    ["Branch", student.branch || "-"],
    ["Semester", student.classLabel || "-"],
    ["Period", scope.label],
  ];
}

/** The letterhead lines: college name, then address and phone when the college has them. */
export function studentReportLetterhead(report: StudentReportData): string[] {
  const { college } = report;
  return [college.name.toUpperCase(), college.address, college.phone ? `Tel : ${college.phone}` : ""].filter(Boolean);
}

export function studentReportFilename(report: StudentReportData): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return `Attendance_${safe(report.student.rollNumber) || "student"}_${safe(report.scope.label)}`;
}

export function buildStudentReportPrintHtml(report: StudentReportData, generatedAt: Date, threshold: number, logoSrc: string): string {
  const rows = report.subjects
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${esc(s.code)}</td><td>${s.held}</td><td>${s.attended}</td><td${s.percent != null && s.percent < threshold ? ' class="low"' : ""}>${pct(s.percent)}</td></tr>`
    )
    .join("");
  const [name, ...rest] = studentReportLetterhead(report);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Attendance Report ${esc(report.student.rollNumber)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
  table.head{margin:0 auto;border-collapse:collapse}table.head td{padding:2px 6px;text-align:center}
  table.head img{width:100px;height:100px;object-fit:contain}
  .name{font-size:16px;font-weight:bold}.line{font-size:13px;font-weight:bold}
  h2{font-size:14px;text-align:center;margin:14px 0 6px}
  table.id{margin:0 auto 14px;border-collapse:collapse}table.id td{padding:2px 4px}table.id td:first-child{text-align:right;font-weight:bold;width:50%}
  table.rep{border-collapse:collapse;width:100%}table.rep th,table.rep td{border:1px solid #888;padding:4px 6px;text-align:left}
  table.rep th{background:#e5e5e5}
  td.low{color:#b91c1c;font-weight:bold}tr.tot td{font-weight:bold;background:#e5e5e5}td.r{text-align:right!important}
  .foot{color:#666;font-size:10px;margin-top:10px}
  @media print{body{margin:10mm}tr{page-break-inside:avoid}}
  </style></head><body>
  <table class="head"><tr>${logoSrc ? `<td><img src="${esc(logoSrc)}" alt=""></td>` : ""}<td><div class="name">${esc(name)}</div>${rest.map((l) => `<div class="line">${esc(l)}</div>`).join("")}</td></tr></table>
  <h2>ATTENDANCE REPORT</h2>
  <table class="id">${studentReportIdentity(report).map(([k, v]) => `<tr><td>${esc(k)} :</td><td>${esc(v)}</td></tr>`).join("")}</table>
  <table class="rep"><thead><tr><th>Sl.No.</th><th>Subject</th><th>Held</th><th>Attend</th><th>%</th></tr></thead><tbody>${rows}
  <tr class="tot"><td colspan="2" class="r">TOTAL</td><td>${report.total.held}</td><td>${report.total.attended}</td><td>${pct(report.total.percent)}</td></tr></tbody></table>
  <p class="foot">Percentages below ${threshold} are in red. Generated ${esc(generatedAt.toLocaleString("en-IN"))}.</p>
  </body></html>`;
}

/** Opens the report in a clean window and starts the browser's print dialog. Returns false if a popup blocker stopped it. */
export function printStudentReport(report: StudentReportData, threshold: number): boolean {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  const logo = report.college.logoUrl || "/vishnulogo.png";
  const logoSrc = /^https?:/i.test(logo) ? logo : new URL(logo, window.location.origin).href;
  w.document.open();
  w.document.write(buildStudentReportPrintHtml(report, new Date(), threshold, logoSrc));
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
  setTimeout(go, 700);
  return true;
}

// ── Excel ───────────────────────────────────────────────────────────────────

type ExcelModule = typeof import("exceljs");

/** One worksheet laid out like the printed report. Pure - the caller supplies the exceljs module. */
export function buildStudentReportWorkbook(Excel: ExcelModule, report: StudentReportData) {
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("Attendance Report");
  ws.columns = [{ width: 9 }, { width: 28 }, { width: 11 }, { width: 11 }, { width: 11 }];
  const border = { top: { style: "thin" as const }, left: { style: "thin" as const }, bottom: { style: "thin" as const }, right: { style: "thin" as const } };
  const grey = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE5E5E5" } };

  const centered = (text: string, size: number) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, 5);
    row.getCell(1).font = { bold: true, size };
    row.getCell(1).alignment = { horizontal: "center" };
  };
  const [name, ...rest] = studentReportLetterhead(report);
  centered(name, 14);
  for (const line of rest) centered(line, 11);
  ws.addRow([]);
  centered("ATTENDANCE REPORT", 12);
  ws.addRow([]);

  for (const [label, value] of studentReportIdentity(report)) {
    const row = ws.addRow([`${label} :`, "", value]);
    ws.mergeCells(row.number, 1, row.number, 2);
    ws.mergeCells(row.number, 3, row.number, 5);
    row.getCell(1).font = { bold: true };
    row.getCell(1).alignment = { horizontal: "right" };
    row.getCell(3).alignment = { horizontal: "left" };
  }
  ws.addRow([]);

  const head = ws.addRow(["Sl.No.", "Subject", "Held", "Attend", "%"]);
  head.eachCell((c) => { c.font = { bold: true }; c.fill = grey; c.border = border; });
  report.subjects.forEach((s, i) => {
    const row = ws.addRow([i + 1, s.code, s.held, s.attended, s.percent]);
    row.eachCell((c) => { c.border = border; c.alignment = { horizontal: "left" }; });
    row.getCell(5).numFmt = "0.00";
  });
  const total = ws.addRow(["TOTAL", "", report.total.held, report.total.attended, report.total.percent]);
  ws.mergeCells(total.number, 1, total.number, 2);
  total.eachCell((c) => { c.font = { bold: true }; c.fill = grey; c.border = border; c.alignment = { horizontal: "left" }; });
  total.getCell(1).alignment = { horizontal: "right" };
  total.getCell(5).numFmt = "0.00";
  return wb;
}

/** Saves the report as an .xlsx file. exceljs is loaded on demand so it stays out of the page bundle. */
export async function downloadStudentReportXlsx(report: StudentReportData): Promise<void> {
  const Excel = (await import("exceljs")).default;
  const buffer = await buildStudentReportWorkbook(Excel as unknown as ExcelModule, report).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${studentReportFilename(report)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
