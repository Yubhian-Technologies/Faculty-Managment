import type {
  CourseYearTiming,
  DayOfWeek,
  PeriodTiming,
  Section,
  Subject,
  TeachingAssignment,
  TimetableSlot,
} from "@/types";
import { escapeHtml, formatTime12h } from "./facultyTimetablePdf";
import { resolveLogoUrl } from "./logoAsset";
import {
  buildAllocationList,
  buildTimetableColumns,
  getHodSignatureLabel,
  continuousSpans,
  latestEffectiveDate,
  resolveTimetableDays,
  slotShortCode, mergeCoTaughtSlots,} from "./gridModel";
import { resolveSignatureRows } from "./signatureAuthority";
import { buildTimetableHeaderLines, collegeHeading, groupAllocationByType, departmentHeading, facultyInitials, timetableTitle } from "./timetableHeader";

export interface SectionTimetablePdfOptions {
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  /** The college's city, printed beside its name. */
  city?: string;
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
  /** Show faculty/batches of one subject in a period as one entry (default true); false lists each separately. */
  mergeCoTaught?: boolean;
  /** Show the Class In-charge / Timetable In-charge / Principal signature block. */
  showSignatures?: boolean;
  /** Name under the rightmost signature, e.g. "Principal". Defaults to "Principal". */
  signatureLabels?: { incharge?: string; principal?: string };
  /** The college's chosen signature rows (Super Admin > Settings); empty = the default In-Charge / HOD / Principal row. */
  signatureRows?: string[][];
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
    affiliation = "",
    city = "",
    logoUrl,
    departmentName,
    semesterLabel,
    section,
    courseName,
    classInchargeName,
    periodTimings,
    slots,
    subjects = [],
    assignments = [],
    lunchBreak,
    shortBreaks,
    showSignatures = false,
    signatureLabels,
    signatureRows,
    title,
  } = opts;

  const resolvedCourse = courseName || section?.courseName || "";
  // `Section.department` holds the department NAME string (see the join-key
  // comment on POST college/departments), so it is a legitimate display
  // fallback when the caller didn't resolve a name of its own.
  const resolvedDepartment = departmentName || section?.department || "";
  const resolvedIncharge = classInchargeName?.trim() || section?.facultyInchargeName || "";

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

  // ── Letterhead: college, affiliation, department, "Time Table <year>" ────
  const nameLine = collegeName ? `<div class="inst-name">${escapeHtml(collegeHeading(collegeName, city))}</div>` : "";
  const affiliationLine = affiliation ? `<div class="identity-line">${escapeHtml(affiliation)}</div>` : "";
  const deptHeading = departmentHeading(resolvedDepartment);
  const deptLine = deptHeading ? `<div class="dept-line">${escapeHtml(deptHeading)}</div>` : "";

  const resolvedRoom = opts.classroom || section?.classroomNumber || (section as { classroom?: string })?.classroom;
  const header = buildTimetableHeaderLines({
    courseName: resolvedCourse,
    year: section?.year,
    semesterLabel,
    sectionName: section?.name,
    departmentName: resolvedDepartment,
    classroom: resolvedRoom,
    classInchargeName: resolvedIncharge,
    effectiveDate: opts.effectiveDate ?? latestEffectiveDate(slots),
  });

  // Always a logo: the college's own, else the bundled Vishnu logo.
  const resolvedLogo = resolveLogoUrl(logoUrl);
  const logoTd = `<td class="logo-cell"><img src="${escapeHtml(resolvedLogo)}" alt="${escapeHtml(collegeName)} logo"></td>`;

  const metaLines = (lines: string[]) => lines.filter(Boolean).map((l) => `<div>${escapeHtml(l)}</div>`).join("");
  const headerHtml = `
  <table class="letterhead" cellspacing="0" cellpadding="0">
    <tr>
      ${logoTd}
      <td class="letterhead-text">
        ${nameLine}
        ${affiliationLine}
        ${deptLine}
        <div class="doc-title">${escapeHtml(title || timetableTitle(opts.academicYear || opts.sessionLabel))}</div>
      </td>
      <td class="logo-cell"></td>
    </tr>
  </table>

  <table class="meta-header-table" cellspacing="0" cellpadding="0">
    <tr>
      <td class="meta-left">${metaLines([header.yearLine, header.branchLine])}</td>
      <td class="meta-right"><div class="meta-block">${metaLines([header.wefLine, header.roomLine])}</div></td>
    </tr>
  </table>${header.inchargeLine ? `
  <div class="incharge-line">${escapeHtml(header.inchargeLine)}</div>` : ""}`;

  // ── Grid ──────────────────────────────────────────────────────────────────
  // Two header rows, like the printed timetable: PERIOD | 1 2 3 ... and DAY | clock times.
  const timeRange = (start?: string, end?: string) =>
    start && end ? `${escapeHtml(formatTime12h(start))} - ${escapeHtml(formatTime12h(end))}` : "";

  const colGroup = `<colgroup><col class="col-day">${columns
    .map((c) => `<col class="${c.kind === "break" ? "col-break" : "col-period"}">`)
    .join("")}</colgroup>`;

  const periodHeadCells = columns
    .map((col) =>
      col.kind === "break"
        ? `<th class="cell break-head" rowspan="2"><div class="fx"><div class="col-time">${timeRange(col.startTime, col.endTime)}</div></div></th>`
        : `<th class="cell"><div class="fx"><div class="head-label">${col.periodNumber}</div></div></th>`
    )
    .join("");
  const timeHeadCells = columns
    .map((col) =>
      col.kind === "break"
        ? ""
        : `<th class="cell"><div class="fx"><div class="col-time">${timeRange(col.startTime, col.endTime)}</div></div></th>`
    )
    .join("");

  const bodyRows = gridDays
    .map((day, dayIndex) => {
      // Cells merged in the timetable editor print as one wide cell.
      const { spans, skipped } = continuousSpans(columns, (p) => slots.filter((s) => s.day === day && s.periodNumber === p));
      const cells = columns
        .map((col, colIdx) => {
          if (skipped.has(colIdx)) return "";
          // One tall cell spanning every day row (no horizontal rules inside
          // it), titled vertically - emitted on the first row only.
          if (col.kind === "break") {
            if (dayIndex > 0) return "";
            const title = col.breakKind === "lunch" ? "LUNCH BREAK" : "SHORT BREAK";
            return `<td class="cell break-cell" rowspan="${gridDays.length}"><div class="vtext">${title}</div></td>`;
          }
          // Faculty of one subject sharing the period print the subject once.
          const rawCell = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
          const cellSlots = opts.mergeCoTaught === false ? rawCell : mergeCoTaughtSlots(rawCell);
          if (cellSlots.length === 0) return `<td class="cell"><div class="fx">&nbsp;</div></td>`;
          const inner = cellSlots
            .map((s) => {
              const sub = s.substituteFacultyName;
              const room = s.classroom ? `ROOM NO: ${s.classroom.trim().replace(/^room\s*(no:?)?\s*/i, "").trim()}` : null;
              const initials = facultyInitials(s.facultyName);
              return `<div class="slot">
                <div class="slot-code">${escapeHtml(slotShortCode(s, subjectMap))}</div>
                ${initials ? `<div class="slot-code">(${escapeHtml(initials)})</div>` : ""}
                ${s.labBatch ? `<div class="slot-note">${escapeHtml(s.labBatch)}</div>` : ""}
                ${room ? `<div class="slot-note">${escapeHtml(room)}</div>` : ""}
                ${sub ? `<div class="slot-note">Sub: ${escapeHtml(sub)}</div>` : ""}
              </div>`;
            })
            .join("");
          const span = spans.get(colIdx);
          return `<td class="cell"${span ? ` colspan="${span}"` : ""}><div class="fx">${inner}</div></td>`;
        })
        .join("");
      return `<tr><th class="cell day-cell"><div class="fx">${escapeHtml(day)}</div></th>${cells}</tr>`;
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
    <thead>
      <tr class="head-row"><th class="cell"><div class="fx"><div class="head-label">PERIOD</div></div></th>${periodHeadCells}</tr>
      <tr class="head-row head-row-last"><th class="cell"><div class="fx"><div class="head-label">DAY</div></div></th>${timeHeadCells}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  // ── Subject list: S.No | Subject Name | Sub Acr | Faculty ────────────────
  // The acronym is the same code the grid prints, so every cell can be
  // matched to its subject and faculty.
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  const allocationHtml = allocation.length
    ? `
  <table class="allocation" cellspacing="0" cellpadding="0">
    <colgroup><col style="width:6%"><col style="width:30%"><col style="width:10%"><col style="width:25%"><col style="width:29%"></colgroup>
    <thead>
      <tr><th class="num">S.No</th><th>Subject Name</th><th>Sub Acr</th><th>Subject Code</th><th>Faculty</th></tr>
    </thead>
    <tbody>
      ${groupAllocationByType(allocation)
        .map(
          (g) => `<tr><td class="grp" colspan="5">${escapeHtml(g.label)}</td></tr>${g.entries
            .map(
              (a, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(a.name)}${a.labBatches.length ? ` (${escapeHtml(a.labBatches.join(", "))})` : ""}</td>
        <td>${escapeHtml(a.shortCode)}</td>
        <td>${escapeHtml(a.code)}</td>
        <td>${escapeHtml(a.faculty)}</td>
      </tr>`
            )
            .join("")}`
        )
        .join("")}
    </tbody>
  </table>`
    : "";

  // HOD-<short code of the section's own (managed) department>, never the
  // managing sub-department's - a CSE section signs as HOD-CSE even when
  // Basic Science - Chemistry runs it.
  const hodLabel = getHodSignatureLabel(section?.department || resolvedDepartment);
  const rows = signatureRows?.length
    ? resolveSignatureRows(signatureRows, section?.department || resolvedDepartment)
    : [[signatureLabels?.incharge || "TimeTable In-Charge", hodLabel, signatureLabels?.principal || "PRINCIPAL"]];
  const signatureHtml = rows
    .map(
      (row) => `
  <div class="signature-row" style="margin-top:44px;margin-bottom:6px;padding-top:0;display:flex;justify-content:space-between;align-items:flex-end;width:100%;page-break-inside:avoid;">
    ${row.map((label) => `<div class="signature-block" style="flex:1;text-align:center;font-weight:700;font-size:9.5pt;">${escapeHtml(label)}</div>`).join("\n    ")}
  </div>`
    )
    .join("");

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
    /* The PDF renderer captures .page edge to edge, so the page margin lives inside it as padding. */
    .page { width: 210mm; margin: 0 auto; padding: 8mm 6mm 8mm; }
    .content-area { width: 100%; }

    .letterhead { width: 100%; border: 0; margin-bottom: 0; }
    .logo-cell { width: 26mm; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 24mm; max-height: 24mm; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 11pt; font-weight: 700; overflow-wrap: anywhere; }
    .dept-line { font-size: 11pt; font-weight: 700; overflow-wrap: anywhere; margin-top: 2px; }
    .doc-title { font-size: 11pt; font-weight: 700; margin-top: 2px; }

    .meta-header-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 9.5pt; font-weight: 700; }
    .meta-left { text-align: left; vertical-align: top; padding: 0; }
    /* The block sits at the right edge, but its lines start at one left edge (W.E.F over ROOM NO). */
    .meta-right { text-align: right; vertical-align: top; padding: 0; white-space: nowrap; }
    .meta-block { display: inline-block; text-align: left; }
    .meta-left > div, .meta-right > div { margin-bottom: 2px; overflow-wrap: anywhere; }
    table.grid { margin-top: 8px; }

    /* Right/bottom borders on each cell plus top/left on the table: with
       border-collapse the canvas capture drew every shared edge twice. The
       outer frame and the line under the header are heavier, like the printed sheet. */
    table.grid { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 2px solid #000; border-left: 2px solid #000; border-right: 1px solid #000; }
    table.grid .cell { border-right: 1px solid #000; border-bottom: 1px solid #000; }
    table.grid tbody tr:last-child .cell { border-bottom: 2px solid #000; }
    table.grid .head-row-last .cell { border-bottom: 2px solid #000; }
    table.grid thead tr .cell:first-child, table.grid tbody th.cell { border-right: 2px solid #000; }
    table.grid .break-head { border-bottom: 2px solid #000; }
    table.grid td.break-cell { border-left: 2px solid #000; border-right: 2px solid #000; }
    /* Every cell's content sits in a flex box (.fx) that supplies the row
       height and centres vertically. html2canvas paints text a few px low
       whenever a plain table cell has vertical padding / margin / loose
       line-height (the text ended up on the bottom border); flex centring is
       geometric, so it lands where the layout puts it. The td itself carries
       no vertical padding. A cell with more lines just grows past min-height. */
    .cell { padding: 0; text-align: center; vertical-align: middle; line-height: 1.2; overflow-wrap: anywhere; }
    .fx { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 30px; padding: 0 3px; }
    th.cell { font-weight: 700; font-size: 8.5pt; background: #fff; }
    th.cell > .fx { min-height: 22px; }
    .head-label { font-size: 9pt; font-weight: 700; }
    .col-time { font-size: 7pt; font-weight: 700; text-align: center; }
    /* Vertical title, rotated rather than writing-mode: html2canvas (the
       in-app PDF path) does not implement writing-mode but does draw
       transforms. Absolutely centred so the rotation never widens the cell. */
    td.break-cell { position: relative; background: #fff; }
    .vtext { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-90deg); white-space: nowrap; font-size: 9pt; font-weight: 700; letter-spacing: 0.2em; }

    .col-day { width: 15mm; }
    .col-break { width: 11mm; }
    th.day-cell { font-size: 9pt; }
    .grid td.cell > .fx { padding: 0 1px; }
    /* Font is sized so the longest code fits its column; if even the smallest
       size can't hold a code it wraps inside the cell instead of spilling into
       the neighbouring one. */
    .slot { text-align: center; }
    .slot + .slot { margin-top: 3px; }
    .slot-code { font-size: ${slotPt.toFixed(1)}pt; overflow-wrap: anywhere; word-break: break-word; line-height: 1.2; }
    .slot-note { font-size: 7pt; color: #333; overflow-wrap: anywhere; line-height: 1.2; }

    .incharge-line { text-align: center; font-weight: 700; margin-top: 2px; }
    table.allocation { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 10px; font-size: 9pt; }
    table.allocation th { font-weight: 700; text-align: left; padding: 2px 4px; }
    table.allocation th.num { text-align: center; }
    table.allocation td { text-align: left; padding: 1px 4px; overflow-wrap: anywhere; line-height: 1.2; }
    table.allocation td.num { text-align: center; }
    table.allocation td.grp { font-weight: 700; padding-top: 6px; }

    .signature-row { display: flex; justify-content: space-between; margin-top: 48px; margin-bottom: 16px; padding-top: 16px; width: 100%; page-break-inside: avoid; }
    .signature-block { text-align: center; width: 30%; font-size: 9.5pt; font-weight: 700; }
  </style>
</head>
<body>
  <div class="page">
    <div class="content-area">
      ${headerHtml}
      ${gridHtml}
      ${allocationHtml}
    </div>
    ${signatureHtml}
  </div>
</body>
</html>`;
}
