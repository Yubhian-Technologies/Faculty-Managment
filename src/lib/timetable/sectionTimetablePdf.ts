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
import { resolveLogoUrl } from "./logoAsset";
import {
  buildAllocationList,
  buildTimetableColumns,
  timetableClassLine,
  buildClassTimetableSubtitle,
  getHodSignatureLabel,
  continuousSpans,
  isLabSlot,
  latestEffectiveDate,
  resolveTimetableDays,
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
  /** Draw back-to-back periods with the same subject as one wide cell. */
  mergeContinuous?: boolean;
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
  const resolvedRoom = opts.classroom || section?.classroomNumber || (section as { classroom?: string })?.classroom;
  const classLine = escapeHtml(timetableClassLine({
    courseName: resolvedCourse,
    year: section?.year,
    semesterLabel,
    sectionName: section?.name,
    departmentName: resolvedDepartment,
    classroom: resolvedRoom,
  }));
  const inchargeLine = resolvedIncharge ? `Class In-charge: ${escapeHtml(resolvedIncharge)}` : "";

  // Always a logo: the college's own, else the bundled Vishnu logo.
  const resolvedLogo = resolveLogoUrl(logoUrl);
  const logoTd = `<td class="logo-cell"><img src="${escapeHtml(resolvedLogo)}" alt="${escapeHtml(collegeName)} logo"></td>`;

  const subtitleText = buildClassTimetableSubtitle({
    academicYear: opts.academicYear,
    semesterLabel,
    effectiveDate: opts.effectiveDate ?? latestEffectiveDate(slots),
  });

  const headerHtml = `
  <table class="letterhead" cellspacing="0" cellpadding="0">
    <tr>
      ${logoTd}
      <td class="letterhead-text">
        ${nameLine}
        ${identityLines}
      </td>
      <td class="logo-cell"></td>
    </tr>
  </table>
  <div class="doc-title">${escapeHtml(title || "TIME TABLE")}</div>
  <div class="class-line" style="font-size:9.5pt;font-weight:600;margin-bottom:2px;">${escapeHtml(subtitleText)}</div>
  ${classLine ? `<div class="class-line">${classLine}</div>` : ""}
  ${inchargeLine ? `<div class="class-line" style="font-weight:600;color:#1e3a8a;">${inchargeLine}</div>` : ""}`;

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
        ? `<th class="cell break-head"><div class="fx">${timeStack(col.startTime, col.endTime)}</div></th>`
        : `<th class="cell"><div class="fx"><div class="head-label">Period ${col.periodNumber}</div>${timeStack(col.startTime, col.endTime)}</div></th>`
    )
    .join("");

  const bodyRows = gridDays
    .map((day, dayIndex) => {
      const { spans, skipped } = opts.mergeContinuous
        ? continuousSpans(columns, (p) => slots.filter((s) => s.day === day && s.periodNumber === p))
        : { spans: new Map<number, number>(), skipped: new Set<number>() };
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
          const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
          if (cellSlots.length === 0) return `<td class="cell"><div class="fx">&nbsp;</div></td>`;
          const inner = cellSlots
            .map((s) => {
              const sub = s.substituteFacultyName;
              const room = s.classroom ? (/^room/i.test(s.classroom.trim()) ? s.classroom.trim() : `Room: ${s.classroom.trim()}`) : null;
              return `<div class="slot${isLabSlot(s, subjectMap) ? " slot-lab" : ""}">
                <div class="slot-code">${escapeHtml(slotShortCode(s, subjectMap))}</div>
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
      return `<tr><th class="cell day-cell"><div class="fx fx-left">${escapeHtml(DAY_LABELS[day] ?? day)}</div></th>${cells}</tr>`;
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
    <thead><tr><th class="cell"><div class="fx">Day</div></th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  // ── Allocation of subjects ────────────────────────────────────────────────
  // First column is the same code the grid prints, so every cell can be
  // matched to its subject and faculty.
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  const allocationHtml = allocation.length
    ? `
  <div class="section">
  <div class="section-title">Allocation of Subjects</div>
  <table class="allocation" cellspacing="0" cellpadding="0">
    <thead>
      <tr>
        <th class="cell left"><div class="fx fx-left">Subject</div></th>
        <th class="cell left" style="width:40%"><div class="fx fx-left">Name of Faculty</div></th>
      </tr>
    </thead>
    <tbody>
      ${allocation
        .map(
          (a) => `<tr>
        <td class="cell left"><div class="fx fx-left">${escapeHtml(a.name)}${a.labBatches.length ? ` (${escapeHtml(a.labBatches.join(", "))})` : ""}</div></td>
        <td class="cell left"><div class="fx fx-left">${escapeHtml(a.faculty)}</div></td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>
  </div>`
    : "";

  // HOD-<short code of the section's own (managed) department>, never the
  // managing sub-department's - a CSE section signs as HOD-CSE even when
  // Basic Science - Chemistry runs it.
  const hodLabel = getHodSignatureLabel(section?.department || resolvedDepartment);
  const signatureHtml = `
  <div class="signature-row" style="margin-top:24px;display:flex;justify-content:space-between;align-items:flex-end;">
    <div class="signature-block" style="flex:1;text-align:center;">TimeTable In-Charge</div>
    <div class="signature-block" style="flex:1;text-align:center;">${escapeHtml(hodLabel)}</div>
    <div class="signature-block" style="flex:1;text-align:center;">PRINCIPAL</div>
  </div>`;

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
    .inst-name { font-size: 13pt; font-weight: 700; overflow-wrap: anywhere; }
    .identity-line { font-size: 10pt; font-weight: 700; overflow-wrap: anywhere; }
    .doc-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 12px 0 4px; }
    .class-line { text-align: center; font-size: 9pt; overflow-wrap: anywhere; }
    .letterhead { margin-bottom: 0; }
    table.grid { margin-top: 8px; }

    /* Right/bottom borders on each cell plus top/left on the table: with
       border-collapse the canvas capture drew every shared edge twice. */
    table.grid, table.allocation { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border-top: 1px solid #555; border-left: 1px solid #555; }
    /* Every cell's content sits in a flex box (.fx) that supplies the row
       height and centres vertically. html2canvas paints text a few px low
       whenever a plain table cell has vertical padding / margin / loose
       line-height (the text ended up on the bottom border); flex centring is
       geometric, so it lands where the layout puts it. The td itself carries
       no vertical padding. A cell with more lines just grows past min-height. */
    .cell { border-right: 1px solid #555; border-bottom: 1px solid #555; padding: 0; text-align: center; vertical-align: middle; line-height: 1.2; overflow-wrap: anywhere; }
    .fx { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 32px; padding: 0 3px; }
    .fx-left { align-items: flex-start; text-align: left; padding: 0 6px; }
    th.cell { font-weight: 700; font-size: 8.5pt; background: #fff; }
    th.cell > .fx { min-height: 44px; }
    .head-label { font-size: 8.5pt; font-weight: 700; }
    .col-time { font-size: 7pt; font-weight: 400; white-space: nowrap; }
    .break-head .head-label { font-size: 7pt; }
    /* Vertical title, rotated rather than writing-mode: html2canvas (the
       in-app PDF path) does not implement writing-mode but does draw
       transforms. Absolutely centred so the rotation never widens the cell. */
    td.break-cell { position: relative; background: #f3f3f3; }
    .vtext { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-90deg); white-space: nowrap; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.2em; }

    .col-day { width: 19mm; }
    .col-break { width: 13mm; }
    th.day-cell { font-weight: 400; font-size: 8.5pt; }
    th.day-cell > .fx { min-height: 32px; padding-left: 5px; }
    .grid td.cell > .fx { padding: 0 1px; }
    /* Font is sized so the longest code fits its column; if even the smallest
       size can't hold a code it wraps inside the cell instead of spilling into
       the neighbouring one. */
    .slot { text-align: center; }
    .slot + .slot { margin-top: 3px; }
    /* Lab / practical periods are tinted so they stand out from theory. */
    .slot-lab { background: #ede9fe; -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 2px 3px; border-radius: 2px; }
    .slot-code { font-size: ${slotPt.toFixed(1)}pt; overflow-wrap: anywhere; word-break: break-word; line-height: 1.2; }
    .slot-note { font-size: 7pt; color: #333; overflow-wrap: anywhere; line-height: 1.2; }

    .section-title { text-align: center; font-size: 12pt; font-weight: 700; margin: 22px 0 8px; }
    table.allocation td.cell, table.allocation th.cell { font-size: 9pt; overflow-wrap: anywhere; }
    table.allocation .fx { min-height: 26px; }
    table.allocation th.cell { font-weight: 700; }
    table.allocation th.cell > .fx { min-height: 28px; }


    .signature-row { display: flex; justify-content: space-around; margin-top: 48px; }
    .signature-block { text-align: center; width: 26%; font-size: 9pt; }
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
