import type {
  CourseYearTiming,
  DayOfWeek,
  PeriodTiming,
  Section,
  Subject,
  TeachingAssignment,
  TimetableSlot,
} from "@/types";
import { DAY_LABELS } from "@/types";
import { escapeHtml, formatTime12h } from "./facultyTimetablePdf";
import {
  allocationNeedsOfficialCode,
  buildAllocationList,
  buildTimetableColumns,
  ordinalYear,
  resolveTimetableDays,
  slotFacultyName,
  slotShortCode,
} from "./gridModel";

export interface SectionTimetablePdfOptions {
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  departmentName?: string;
  academicYear?: string;
  semesterLabel?: string;
  regulation?: string;
  section?: Partial<Section> & { name?: string; department?: string; year?: number; courseName?: string };
  courseName?: string;
  classroom?: string;
  classInchargeName?: string;
  effectiveDate?: string;
  /** e.g. "2026-27" - printed as a "Valid for" line so a stale handout is recognisable. */
  sessionLabel?: string;
  days: DayOfWeek[];
  periods: number[];
  periodTimings: PeriodTiming[];
  /**
   * The owning CourseYearTiming, when the caller holds one. Used only as the
   * source for derived clock times if `periodTimings` is empty; supplying it
   * never overrides an explicit `periods` breakdown.
   */
  timing?: Pick<CourseYearTiming, "numberOfPeriods" | "periods" | "periodDurationMinutes" | "collegeStartTime" | "lunchBreak" | "shortBreaks">;
  slots: TimetableSlot[];
  subjects?: Subject[];
  assignments?: TeachingAssignment[];
  lunchBreak?: { afterPeriod: number; durationMinutes: number };
  shortBreaks?: { afterPeriod: number; durationMinutes: number }[];
  /** Show the Class In-charge / Timetable In-charge / Principal signature block. */
  showSignatures?: boolean;
  /** Name under the rightmost signature, e.g. "Principal". Defaults to "Principal". */
  signatureLabels?: { incharge?: string; principal?: string };
  title?: string;
}

/**
 * The printable / PDF form of ONE section's weekly timetable: a letterhead,
 * a plain Day x Period grid of subject codes, and an allocation table that
 * lists each code with its subject and faculty.
 *
 * Everything on the page comes from `opts` - the college's own identity, the
 * section's class line, the course-year's configured period timings and
 * breaks, and the days the college actually teaches. Nothing is invented: a
 * missing field is simply left off the page.
 */
export function buildSectionTimetablePdfHtml(opts: SectionTimetablePdfOptions): string {
  const {
    collegeName = "",
    collegeCode = "",
    affiliation = "",
    address = "",
    phone = "",
    logoUrl,
    departmentName,
    academicYear,
    semesterLabel,
    regulation,
    section,
    courseName,
    classroom,
    classInchargeName,
    periodTimings,
    slots,
    subjects = [],
    assignments = [],
    lunchBreak,
    shortBreaks,
    showSignatures = false,
    signatureLabels,
    title,
  } = opts;

  const resolvedCourse = courseName || section?.courseName || "";
  // `Section.department` holds the department NAME string (see the join-key
  // comment on POST college/departments), so it is a legitimate display
  // fallback when the caller didn't resolve a name of its own.
  const resolvedDepartment = departmentName || section?.department || "";
  const resolvedIncharge = classInchargeName ?? section?.facultyInchargeName ?? "";

  // Days: the caller's list when it gave one, otherwise the days these slots
  // actually occupy.
  const days = opts.days?.length ? resolveTimetableDays(null, opts.days) : resolveTimetableDays(null, slots.map((s) => s.day));
  const occupiedDays = new Set(slots.map((s) => s.day));
  const visibleDays = days.filter((d) => occupiedDays.has(d) || opts.days?.length);
  const gridDays = visibleDays.length > 0 ? visibleDays : days;

  // Prefer the caller's own CourseYearTiming so an unsaved `periods` breakdown
  // still yields real clock times; otherwise use the explicit periodTimings.
  const columns = buildTimetableColumns(
    opts.timing ?? {
      numberOfPeriods: opts.periods.length,
      periods: periodTimings,
      periodDurationMinutes: 0,
      collegeStartTime: periodTimings[0]?.startTime ?? "",
      // afterPeriod 0 matches no period (the loop starts at 1), so a caller
      // with no break config yields no break column rather than a fake one.
      lunchBreak: lunchBreak ?? { afterPeriod: 0, durationMinutes: 0 },
      shortBreaks: shortBreaks ?? [],
    },
    { lunchLabel: "Lunch Break" }
  );

  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  // ── Letterhead ────────────────────────────────────────────────────────────
  const identityLines = [
    affiliation,
    address,
    phone ? `Tel : ${phone}` : "",
  ]
    .filter(Boolean)
    .map((line) => `<div class="identity-line">${escapeHtml(line)}</div>`)
    .join("");

  const nameLine = collegeName
    ? `<div class="inst-name">${escapeHtml(collegeName)}${collegeCode ? ` ( Code: ${escapeHtml(collegeCode)} )` : ""}</div>`
    : "";

  // One plain line naming the class this timetable belongs to.
  const classLine = [
    resolvedCourse,
    resolvedDepartment,
    section?.year != null ? ordinalYear(section.year) : "",
    section?.name ? `Section ${section.name}` : "",
    section?.batch,
    regulation,
    semesterLabel,
    academicYear,
    classroom ? `Room ${classroom}` : "",
]
    .filter(Boolean)
    .map((v) => escapeHtml(String(v)))
    .join("  |  ");
  const inchargeLine = resolvedIncharge ? `Class In-charge: ${escapeHtml(resolvedIncharge)}` : "";

  const logoTd = logoUrl
    ? `<td class="logo-cell"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(collegeName)} logo"></td>`
    : "";

  const headerHtml = `
  <table class="letterhead" cellspacing="0" cellpadding="0">
    <tr>
      ${logoTd}
      <td class="letterhead-text">
        ${nameLine}
        ${identityLines}
      </td>
      ${logoUrl ? `<td class="logo-cell"></td>` : ""}
    </tr>
  </table>
  <div class="doc-title">${escapeHtml(title || "TIME TABLE")}</div>
  ${classLine ? `<div class="class-line">${classLine}</div>` : ""}
  ${inchargeLine ? `<div class="class-line">${inchargeLine}</div>` : ""}`;

  // ── Grid ──────────────────────────────────────────────────────────────────
  const timeStack = (start?: string, end?: string) =>
    start && end
      ? `<div class="col-time">${escapeHtml(formatTime12h(start))}</div><div class="col-time">${escapeHtml(formatTime12h(end))}</div>`
      : "";

  const colGroup = `<colgroup><col class="col-day">${columns
    .map((c) => `<col class="${c.kind === "break" ? "col-break" : "col-period"}">`)
    .join("")}</colgroup>`;

  const headerCells = columns
    .map((col) =>
      col.kind === "break"
        ? `<th class="cell break-head"><div class="head-label">${escapeHtml(col.breakKind === "lunch" ? "Lunch" : "Break")}</div>${timeStack(col.startTime, col.endTime)}</th>`
        : `<th class="cell"><div class="head-label">Period ${col.periodNumber}</div>${timeStack(col.startTime, col.endTime)}</th>`
    )
    .join("");

  const bodyRows = gridDays
    .map((day) => {
      const cells = columns
        .map((col) => {
          if (col.kind === "break") return `<td class="cell break-cell">&nbsp;</td>`;
          const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
          if (cellSlots.length === 0) return `<td class="cell">&nbsp;</td>`;
          const inner = cellSlots
            .map((s) => {
              const sub = s.substituteFacultyName;
              return `<div class="slot">
                <div class="slot-code">${escapeHtml(slotShortCode(s, subjectMap))}</div>
                ${s.labBatch ? `<div class="slot-note">${escapeHtml(s.labBatch)}</div>` : ""}
                ${sub ? `<div class="slot-note">Sub: ${escapeHtml(sub)}</div>` : ""}
              </div>`;
            })
            .join("");
          return `<td class="cell">${inner}</td>`;
        })
        .join("");
      return `<tr><th class="cell day-cell">${escapeHtml(DAY_LABELS[day] ?? day)}</th>${cells}</tr>`;
    })
    .join("");

  // Size the cell text to the longest code actually printed, so a long code
  // (e.g. "FLUTTERLAB") fits its column on one line instead of breaking
  // mid-word. Column widths mirror the .col-* rules in the stylesheet below.
  const PAGE_CONTENT_MM = 190;
  const DAY_MM = 19;
  const BREAK_MM = 13;
  const periodCols = columns.filter((c) => c.kind === "period").length || 1;
  const breakCols = columns.length - periodCols;
  const periodMm = (PAGE_CONTENT_MM - DAY_MM - breakCols * BREAK_MM) / periodCols;
  const longestCode = Math.max(1, ...slots.map((sl) => slotShortCode(sl, subjectMap).length));
  const UPPERCASE_EM_MM = 0.65 * 0.3528; // average uppercase glyph width per pt, in mm
  const slotPt = Math.max(7, Math.min(9, (periodMm * 0.92) / (longestCode * UPPERCASE_EM_MM)));

  const gridHtml = `
  <table class="grid" cellspacing="0" cellpadding="0">
    ${colGroup}
    <thead><tr><th class="cell">Day</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  // ── Allocation of subjects ────────────────────────────────────────────────
  // First column is the same code the grid prints, so every cell can be
  // matched to its subject and faculty.
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  const officialCodeCol = allocationNeedsOfficialCode(allocation);
  const allocationHtml = allocation.length
    ? `
  <div class="section-title">Allocation of Subjects</div>
  <table class="allocation" cellspacing="0" cellpadding="0">
    <thead>
      <tr>
        <th class="cell left" style="width:15%">Code</th>
        ${officialCodeCol ? `<th class="cell left" style="width:15%">Subject Code</th>` : ""}
        <th class="cell left">Subject</th>
        <th class="cell left" style="width:30%">Name of Faculty</th>
        <th class="cell left" style="width:15%">Faculty Initials</th>
      </tr>
    </thead>
    <tbody>
      ${allocation
        .map(
          (a) => `<tr>
        <td class="cell left">${escapeHtml(a.shortCode)}</td>
        ${officialCodeCol ? `<td class="cell left">${escapeHtml(a.code)}</td>` : ""}
        <td class="cell left">${escapeHtml(a.name)}${a.labBatches.length ? ` (${escapeHtml(a.labBatches.join(", "))})` : ""}</td>
        <td class="cell left">${escapeHtml(a.faculty)}</td>
        <td class="cell left">&nbsp;</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
    : "";

  // Optional - off unless a caller asks for it.
  const signatureHtml = showSignatures
    ? `
  <div class="signature-row">
    <div class="signature-block"><div class="signature-line"></div>Class In-charge</div>
    <div class="signature-block"><div class="signature-line"></div>${escapeHtml(signatureLabels?.incharge ?? "Timetable Incharge")}</div>
    <div class="signature-block"><div class="signature-line"></div>${escapeHtml(signatureLabels?.principal ?? "Principal")}</div>
  </div>`
    : "";

  const documentTitle = title || "TIME TABLE";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(documentTitle)}${section?.name ? ` - Section ${escapeHtml(section.name)}` : ""}${collegeName ? ` - ${escapeHtml(collegeName)}` : ""}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 11px; line-height: 1.3; }
    /* The PDF renderer captures .page edge to edge, so the page margin lives
       inside it as padding. */
    .page { width: 210mm; margin: 0 auto; padding: 12mm 10mm; }

    .letterhead { width: 100%; border: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 13pt; font-weight: 700; }
    .identity-line { font-size: 10pt; font-weight: 700; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 4px; }
    .class-line { text-align: center; font-size: 9pt; }
    .letterhead { margin-bottom: 0; }
    table.grid { margin-top: 8px; }

    /* Right/bottom borders on each cell plus top/left on the table: with
       border-collapse the canvas capture drew every shared edge twice. */
    table.grid, table.allocation { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 1px solid #555; border-left: 1px solid #555; }
    .cell { border-right: 1px solid #555; border-bottom: 1px solid #555; padding: 4px 3px; text-align: center; vertical-align: middle; }
    th.cell { font-weight: 700; font-size: 8.5pt; background: #fff; }
    .left { text-align: left; padding: 4px 6px; }
    .head-label { font-size: 8.5pt; font-weight: 700; }
    .col-time { font-size: 7pt; font-weight: 400; margin-top: 1px; white-space: nowrap; }
    .break-head .head-label { font-size: 7pt; }

    .col-day { width: 19mm; }
    .col-break { width: 13mm; }
    th.day-cell { font-weight: 400; text-align: left; padding-left: 5px; font-size: 8.5pt; }
    .grid td.cell { height: 28px; padding: 4px 1px; overflow-wrap: break-word; }
    .slot-code { font-size: ${slotPt.toFixed(1)}pt; white-space: nowrap; }
    .slot-note { font-size: 7pt; color: #333; }

    .section-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 22px 0 8px; }
    table.allocation td.cell, table.allocation th.cell { font-size: 9pt; overflow-wrap: anywhere; }
    table.allocation th.cell { font-weight: 700; }

    .signature-row { display: flex; justify-content: space-around; margin-top: 48px; }
    .signature-block { text-align: center; width: 26%; font-size: 9pt; }
    .signature-line { border-top: 1px solid #000; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="page">
    ${headerHtml}
    ${gridHtml}
    ${allocationHtml}
    ${signatureHtml}
  </div>
</body>
</html>`;
}
