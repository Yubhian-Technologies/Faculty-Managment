import type { Department, DayOfWeek, PeriodTiming, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { resolveLogoUrl } from "./logoAsset";
import { facultySpans } from "./facultySpans";

// Shared by hod/teaching and panel/teaching's own "Download"/"Print" buttons -
// both pages lay a faculty member's own slots out identically and, until this
// was extracted, kept two independently-edited copies of the exact same
// PDF-building code.
//
// Laid out Day rows x Period columns, bordered the same way as a section's
// own printed timetable (sectionTimetablePdf.ts) - same page, same grid
// borders and cell spacing - so the two documents read as one family. Unlike
// a section's grid, every cell here can belong to a DIFFERENT course-year (a
// faculty's week isn't pinned to one timing), so there is no single lunch/
// break column: each cell resolves its own clock time from its own slot. The
// on-screen "Teaching Load" grid still shows a subject's chosen colour; the
// PDF never does - a colour picked for the screen means nothing to someone
// reading a printed page days later, and dropping it keeps every faculty
// member's PDF reading the same plain black-and-white way.

// A custom subject's generated code ("CUS-AB12C") reads as its typed name instead.
const readable = (code: string | undefined, name: string | undefined) =>
  code && /^CUS-[A-Z0-9]{5}$/.test(code) ? (name || code) : code;

/** "09:00" -> "9:00 AM" - display only. */
export function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** A subject/section/classroom name containing "&", "<" etc. would otherwise render as broken markup in the PDF. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ROMAN_YEARS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
/** 2 -> "II" - falls back to the plain number past the table (a course longer than 8 years). */
export function romanYear(year: number): string {
  return ROMAN_YEARS[year - 1] ?? String(year);
}

const EN_DASH = "–";

export interface FacultyTimetablePdfOptions {
  facultyName: string;
  departmentName?: string;
  /** e.g. "3", "2, 4" (spans more than one course-year's semester), or "—" (none configured). */
  semesterLabel: string;
  weekStart: Date;
  weekEnd: Date;
  days: DayOfWeek[];
  periods: number[];
  /** Already filtered to the "standing" set the download represents - see each page's own downloadPdf() comment for why (drops synthetic substitute_* entries and same-week-only substitution annotations). */
  slots: (TimetableSlot & { id: string })[];
  assignmentById: Map<string, TeachingAssignment>;
  periodTimeFor: (courseId: string | undefined, year: number | undefined, period: number) => PeriodTiming | undefined;
  /** Periods a lunch/short break follows, for a slot's own course-year - same as the on-screen grid, a merged cell is cut there. */
  breakAfter: (slot: TimetableSlot) => Set<number>;
  /** courseId -> Course.code (Course Catalog's short code) - falls back to the full courseName when a course isn't found (e.g. a legacy assignment). */
  courseCodeById: Map<string, string>;
  departments: Department[];
  formatDMY: (d: Date) => string;
  /** College letterhead (name, logo ...) - printed like the section timetable's. */
  college?: { name?: string; code?: string; affiliation?: string; address?: string; phone?: string; logoUrl?: string };
  /** Defaults to "FACULTY TEACHING LOAD & TIMETABLE". */
  title?: string;
}

export function buildFacultyTimetablePdfHtml(opts: FacultyTimetablePdfOptions): string {
  const { facultyName, departmentName, semesterLabel, weekStart, weekEnd, days, periods, slots, assignmentById, periodTimeFor, breakAfter, courseCodeById, departments, formatDMY, title } = opts;

  // ── Letterhead ────────────────────────────────────────────────────────────
  const identityLines = [opts.college?.affiliation, opts.college?.address, opts.college?.phone ? `Tel : ${opts.college.phone}` : ""]
    .filter(Boolean)
    .map((line) => `<div class="identity-line">${escapeHtml(line as string)}</div>`)
    .join("");
  const nameLine = opts.college?.name
    ? `<div class="inst-name">${escapeHtml(opts.college.name)}${opts.college.code ? ` ( Code: ${escapeHtml(opts.college.code)} )` : ""}</div>`
    : "";
  const resolvedLogo = resolveLogoUrl(opts.college?.logoUrl);

  // Scoped to what the grid actually shows: `assignmentById` is whatever the
  // caller holds (can include non-teaching load already dropped from `slots`
  // upstream), so the summary follows the slots, not the whole map.
  const workloadAssignmentIds = new Set(slots.map((s) => s.assignmentId));
  const uniqueAssignments = Array.from(assignmentById.values()).filter((a) => workloadAssignmentIds.has(a.id));
  const resolvedDept = departmentName || Array.from(new Set(uniqueAssignments.map((a) => a.department).filter(Boolean))).join(", ");

  const headerHtml = `
  <table class="letterhead" cellspacing="0" cellpadding="0">
    <tr>
      <td class="logo-cell"><img src="${escapeHtml(resolvedLogo)}" alt="logo"></td>
      <td class="letterhead-text">
        ${nameLine}
        ${identityLines}
      </td>
      <td class="logo-cell"></td>
    </tr>
  </table>
  <div class="doc-title">${escapeHtml(title || "FACULTY TEACHING LOAD & TIMETABLE")}</div>

  <table class="meta-header-table" style="width:100%;border-collapse:collapse;margin-bottom:2px;font-size:9.5pt;font-weight:600;">
    <tr>
      <td style="text-align:left;padding:0;font-weight:700;">Faculty: ${escapeHtml(facultyName)}</td>
      <td style="text-align:right;padding:0;font-weight:700;">Department: ${escapeHtml(resolvedDept || "—")}</td>
    </tr>
    <tr>
      <td style="text-align:left;padding-top:2px;font-weight:600;" colspan="2">Semester: ${escapeHtml(semesterLabel)} &nbsp;&middot;&nbsp; Academic Period: ${escapeHtml(formatDMY(weekStart))} &ndash; ${escapeHtml(formatDMY(weekEnd))}</td>
    </tr>
  </table>`;

  // ── Grid: Day rows x Period columns ─────────────────────────────────────
  // The header just names the period - a faculty's periods can come from
  // different course-years with different timings, so there's no single
  // "true" time for a whole column. Each occupied cell prints its OWN clock
  // time instead (resolved from its own slot's course/year), same as the
  // on-screen Teaching Load grid.
  const headerCells = periods
    .map((period) => `<th class="cell"><div class="fx"><div class="head-label">Period ${period}</div></div></th>`)
    .join("");

  const DAY_MM = 24;
  const periodMm = periods.length > 0 ? (190 - DAY_MM) / periods.length : 20;
  // A code sized to its cell's actual width (merged cells get the combined
  // width of every period they span) so "NSS/SPORTS" fits on one line
  // instead of wrapping mid-word - same formula sectionTimetablePdf.ts uses.
  const UPPERCASE_EM_MM = 0.65 * 0.3528;
  const codeFontSize = (code: string, widthMm: number) =>
    Math.max(6, Math.min(8, (widthMm * 0.92) / (Math.max(1, code.length) * UPPERCASE_EM_MM)));

  const bodyRows = days.map((day) => {
    // Cells merged in the class timetable editor (a lab spanning several
    // consecutive periods) print as one wide cell here too, same rule as the
    // on-screen Teaching Load grid (facultySpans) - a merge never crosses a
    // lunch/short break, and only continues while each period is flagged
    // `mergeWithNext`.
    const { spans, skipped } = facultySpans(
      periods,
      (p) => slots.filter((s) => s.day === day && s.periodNumber === p),
      breakAfter
    );
    const cells = periods.map((period, pi) => {
      if (skipped.has(pi)) return "";
      const span = spans.get(pi) ?? 1;
      const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === period);
      if (cellSlots.length === 0) {
        return `<td class="cell"><div class="fx"><span class="empty-dash">${EN_DASH}</span></div></td>`;
      }
      const inner = cellSlots.map((slot, i) => {
        const assignment = assignmentById.get(slot.assignmentId);
        const courseCode = assignment?.courseId ? courseCodeById.get(assignment.courseId) : undefined;
        const sectionLabel = assignment?.sectionName
          ? sectionDisplayLabel({ department: assignment.department, name: assignment.sectionName, secondaryDepartments: [] }, departments)
          : null;
        const subline = [courseCode ?? assignment?.courseName, assignment?.year ? romanYear(assignment.year) : null, sectionLabel]
          .filter(Boolean)
          .join(" · ");
        const subjectDisplay = readable(assignment?.shortCode, assignment?.subjectName) || readable(assignment?.subjectCode, assignment?.subjectName) || slot.subjectName || "—";
        const room = slot.classroom ? `Room: ${slot.classroom}` : null;
        const sub = slot.substituteFacultyName ? `Sub: ${slot.substituteFacultyName}` : null;
        const time = periodTimeFor(slot.courseId, slot.year, period);
        const lastTime = span > 1 ? periodTimeFor(slot.courseId, slot.year, periods[pi + span - 1]) : undefined;
        const timeLine = time ? `<div class="slot-time">${escapeHtml(formatTime12h(time.startTime))}&ndash;${escapeHtml(formatTime12h((lastTime ?? time).endTime))}</div>` : "";
        const codePt = codeFontSize(subjectDisplay, periodMm * span);
        return `<div class="slot"${i > 0 ? ' style="border-top:1px dashed #999;margin-top:3px;padding-top:3px;"' : ""}>
          ${timeLine}
          ${subline ? `<div class="slot-class">${escapeHtml(subline)}</div>` : ""}
          <div class="slot-code" style="font-size:${codePt.toFixed(1)}pt;white-space:nowrap;">${escapeHtml(subjectDisplay)}</div>
          ${room ? `<div class="slot-note">${escapeHtml(room)}</div>` : ""}
          ${sub ? `<div class="slot-note">${escapeHtml(sub)}</div>` : ""}
        </div>`;
      }).join("");
      return `<td class="cell"${span > 1 ? ` colspan="${span}"` : ""}><div class="fx">${inner}</div></td>`;
    }).join("");
    return `<tr><th class="cell day-cell"><div class="fx fx-left">${escapeHtml(DAY_LABELS[day] ?? day)}</div></th>${cells}</tr>`;
  }).join("");

  const gridHtml = `
  <table class="grid" cellspacing="0" cellpadding="0">
    <colgroup><col class="col-day">${periods.map(() => `<col style="width:${periodMm}mm">`).join("")}</colgroup>
    <thead><tr><th class="cell"><div class="fx">Day</div></th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  // ── Teaching workload & subject summary ──────────────────────────────────
  const workloadRows = uniqueAssignments.map((a, i) => {
    const courseCode = a.courseId ? courseCodeById.get(a.courseId) : undefined;
    const classStr = [courseCode ?? a.courseName, a.year ? romanYear(a.year) : null, a.sectionName].filter(Boolean).join(" ");
    return `<tr>
      <td class="cell"><div class="fx">${i + 1}</div></td>
      <td class="cell left"><div class="fx fx-left">${escapeHtml(classStr)}</div></td>
      <td class="cell left"><div class="fx fx-left">${escapeHtml(readable(a.subjectCode, a.subjectName) ?? "—")}</div></td>
      <td class="cell left"><div class="fx fx-left">${escapeHtml(a.subjectName ?? "—")}</div></td>
      <td class="cell"><div class="fx">${escapeHtml(readable(a.shortCode, a.subjectName) ?? readable(a.subjectCode, a.subjectName) ?? "—")}</div></td>
      <td class="cell"><div class="fx">${escapeHtml(a.subjectType ?? "THEORY")}</div></td>
      <td class="cell"><div class="fx">${a.hoursPerWeek ?? "—"}</div></td>
    </tr>`;
  }).join("");

  const totalHours = uniqueAssignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);

  const workloadHtml = uniqueAssignments.length > 0 ? `
  <div class="section">
  <div class="section-title">Teaching Workload &amp; Subject Summary</div>
  <table class="allocation workload" cellspacing="0" cellpadding="0">
    <thead>
      <tr>
        <th class="cell" style="width:6%"><div class="fx">S.No</div></th>
        <th class="cell left" style="width:20%"><div class="fx fx-left">Course &amp; Section</div></th>
        <th class="cell left" style="width:14%"><div class="fx fx-left">Subject Code</div></th>
        <th class="cell left" style="width:32%"><div class="fx fx-left">Subject Name</div></th>
        <th class="cell" style="width:10%"><div class="fx">Short Code</div></th>
        <th class="cell" style="width:9%"><div class="fx">Type</div></th>
        <th class="cell" style="width:9%"><div class="fx">Hours/Wk</div></th>
      </tr>
    </thead>
    <tbody>
      ${workloadRows}
      <tr>
        <td class="cell left" colspan="6"><div class="fx fx-left" style="font-weight:700;">TOTAL TEACHING WORKLOAD</div></td>
        <td class="cell"><div class="fx" style="font-weight:700;">${totalHours}</div></td>
      </tr>
    </tbody>
  </table>
  </div>` : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Faculty Teaching Load & Timetable - ${escapeHtml(facultyName)}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    .page { width: 210mm; margin: 0 auto; padding: 10mm 10mm 14mm; }

    .letterhead { width: 100%; border: 0; margin-bottom: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 10pt; font-weight: 700; overflow-wrap: anywhere; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 6px; }

    table.grid, table.allocation { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 1px solid #555; border-left: 1px solid #555; margin-top: 8px; }
    .cell { border-right: 1px solid #555; border-bottom: 1px solid #555; padding: 0; text-align: center; vertical-align: middle; line-height: 1.2; overflow-wrap: anywhere; }
    .fx { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 36px; padding: 2px 3px; }
    .fx-left { align-items: flex-start; text-align: left; padding: 2px 6px; }
    th.cell { font-weight: 700; font-size: 8.5pt; background: #fff; }
    th.cell > .fx { min-height: 30px; }
    .head-label { font-size: 8.5pt; font-weight: 700; }

    .col-day { width: 24mm; }
    th.day-cell { font-weight: 700; font-size: 8.5pt; }
    th.day-cell > .fx { min-height: 36px; padding-left: 5px; }

    .empty-dash { color: #999; font-weight: 700; font-size: 10pt; }
    .slot { text-align: center; }
    .slot-time { font-size: 6.5pt; font-weight: 600; color: #333; white-space: nowrap; line-height: 1.2; }
    .slot-class { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; color: #333; overflow-wrap: anywhere; line-height: 1.2; }
    .slot-code { font-size: 8pt; font-weight: 800; margin-top: 1px; overflow-wrap: anywhere; line-height: 1.2; }
    .slot-note { font-size: 6.5pt; color: #333; margin-top: 1px; overflow-wrap: anywhere; line-height: 1.2; }

    .section { margin-top: 10px; }
    .section-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 18px 0 8px; }
    table.workload td.cell, table.workload th.cell { font-size: 8.5pt; }
    table.allocation .fx { min-height: 24px; }
    table.allocation th.cell > .fx { min-height: 26px; }
  </style>
</head>
<body>
  <div class="page">
    ${headerHtml}
    ${gridHtml}
    ${workloadHtml}
  </div>
</body>
</html>`;
}
