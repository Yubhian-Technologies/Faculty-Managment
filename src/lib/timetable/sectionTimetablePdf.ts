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
 * The printable / PDF / print-window form of ONE section's weekly timetable.
 *
 * Everything on the page is derived from `opts` - the college's own identity
 * block, the section's real department/course/year/batch/regulation, the
 * course-year's configured period timings and breaks, and the days the college
 * actually teaches. The previous version destructured only a third of its own
 * declared options, so the printed sheet never stated which class it belonged
 * to, and substituted literal clock times, a literal "College Name" and a
 * fabricated Section document for anything it hadn't been given.
 */
export function buildSectionTimetablePdfHtml(opts: SectionTimetablePdfOptions): string {
  const {
    collegeName = "",
    collegeCode = "",
    affiliation = "",
    address = "",
    phone = "",
    email = "",
    logoUrl,
    departmentName,
    academicYear,
    semesterLabel,
    regulation,
    section,
    courseName,
    classroom,
    classInchargeName,
    effectiveDate,
    sessionLabel,
    periodTimings,
    slots,
    subjects = [],
    assignments = [],
    lunchBreak,
    shortBreaks,
    showSignatures = true,
    signatureLabels,
    title,
  } = opts;

  const sectionName = section?.name;
  const sectionYear = section?.year;
  const sectionBatch = section?.batch;
  // `Section.department` holds the department NAME string, not a doc id - see
  // the join-key comment on POST college/departments ("sections/students store
  // the department as that name string"), so it is a legitimate display
  // fallback when the caller didn't resolve a name of its own.
  const resolvedDepartment = departmentName || section?.department || "";

  // Optional passthrough of the owning CourseYearTiming, so a caller that has
  // the real doc can supply collegeStartTime/periodDurationMinutes and get
  // derived timings when it hasn't saved an explicit `periods` breakdown.
  const columnTiming = opts.timing;
  const resolvedCourse = courseName || section?.courseName || "";
  const resolvedIncharge = classInchargeName ?? section?.facultyInchargeName ?? "";

  // Days: the caller's list when it gave one, otherwise the days these slots
  // actually occupy - never a hardcoded Mon-Sat.
  const days = opts.days?.length ? resolveTimetableDays(null, opts.days) : resolveTimetableDays(null, slots.map((s) => s.day));
  const occupiedDays = new Set(slots.map((s) => s.day));
  const visibleDays = days.filter((d) => occupiedDays.has(d) || opts.days?.length);
  const gridDays = visibleDays.length > 0 ? visibleDays : days;

  // Prefer the caller's own CourseYearTiming so an unsaved/omitted
  // `periods` breakdown still yields real clock times; otherwise fall back to
  // the explicit periodTimings list alone. Either way no time is invented.
  const columns = buildTimetableColumns(
    columnTiming ?? {
      numberOfPeriods: opts.periods.length,
      periods: periodTimings,
      periodDurationMinutes: 0,
      collegeStartTime: periodTimings[0]?.startTime ?? "",
      // CourseYearTiming types these as non-optional, but a caller without the
      // real doc may have neither. afterPeriod 0 matches no period (the loop
      // starts at 1), so this yields no break column rather than a fake one.
      lunchBreak: lunchBreak ?? { afterPeriod: 0, durationMinutes: 0 },
      shortBreaks: shortBreaks ?? [],
    },
    { lunchLabel: "Lunch Break" }
  );

  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  // ── Header ────────────────────────────────────────────────────────────────
  const documentTitle = title || "TIME TABLE";
  const identityLines = [affiliation, address, [phone, email].filter(Boolean).join("  |  ")]
    .filter(Boolean)
    .map((line) => `<div class="identity-line">${escapeHtml(line)}</div>`)
    .join("");

  const metaPills = [
    sectionYear != null ? ordinalYear(sectionYear) : undefined,
    sectionName ? `Section ${sectionName}` : undefined,
    sectionBatch,
    resolvedCourse,
    resolvedDepartment,
    academicYear,
    semesterLabel,
    regulation,
    classroom ? `Room ${classroom}` : undefined,
  ].filter((v): v is string => !!v);

  const inchargePill = resolvedIncharge ? `Class In-charge: ${resolvedIncharge}` : "";
  const effectivePill = effectiveDate ? `Effective from ${effectiveDate}` : "";
  const sessionPill = sessionLabel ? `Session ${sessionLabel}` : "";

  const logoTd = logoUrl
    ? `<td class="logo-cell"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(collegeName)} logo"></td>`
    : "";

  const headerHtml = `
  <table class="letterhead" cellspacing="0" cellpadding="0">
    <tr>
      ${logoTd}
      <td class="letterhead-text">
        ${collegeName ? `<div class="inst-name">${escapeHtml(collegeName)}${collegeCode ? ` <span class="inst-code">(Code: ${escapeHtml(collegeCode)})</span>` : ""}</div>` : ""}
        ${identityLines}
        <div class="doc-title">${escapeHtml(documentTitle)}</div>
        ${metaPills.length ? `<div class="meta-line">${metaPills.map((p) => escapeHtml(p)).join('<span class="meta-sep">&nbsp;|&nbsp;</span>')}</div>` : ""}
        ${inchargePill || effectivePill || sessionPill
          ? `<div class="meta-line meta-sub">${[inchargePill, effectivePill, sessionPill].filter(Boolean).map((p) => escapeHtml(p)).join('<span class="meta-sep">&nbsp;|&nbsp;</span>')}</div>`
          : ""}
      </td>
    </tr>
  </table>`;

  // ── Grid ──────────────────────────────────────────────────────────────────
  // Start and end go on their own lines: a single "9:00 AM - 9:50 AM" string is
  // wider than a period column on A4 portrait and spilled into its neighbours.
  const timeStack = (start?: string, end?: string) =>
    start && end
      ? `<div class="col-time">${escapeHtml(formatTime12h(start))}</div><div class="col-time">${escapeHtml(formatTime12h(end))}</div>`
      : "";
  const colGroup = `<colgroup><col class="col-day">${columns
    .map((c) => `<col class="${c.kind === "break" ? "col-break" : "col-period"}">`)
    .join("")}</colgroup>`;
  const dayHeader = `<th class="cellBorder day-head">Day</th>`;
  const periodHeaders = columns
    .map((col) => {
      if (col.kind === "break") {
        return `<th class="cellBorder break-head">
          <div class="break-label">${escapeHtml(col.breakKind === "lunch" ? "Lunch" : "Break")}</div>
          ${timeStack(col.startTime, col.endTime)}
        </th>`;
      }
      return `<th class="cellBorder period-head">
        <div class="period-label">Period ${col.periodNumber}</div>
        ${timeStack(col.startTime, col.endTime)}
      </th>`;
    })
    .join("");

  const bodyRows = gridDays
    .map((day) => {
      const cells = columns
        .map((col) => {
          if (col.kind === "break") return `<td class="cellBorder break-cell">&nbsp;</td>`;
          const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
          if (cellSlots.length === 0) return `<td class="cellBorder">&nbsp;</td>`;
          const inner = cellSlots
            .map((s) => {
              const code = escapeHtml(slotShortCode(s, subjectMap));
              // With a substitute, the line under the code stays the timetabled
              // faculty and the substitute gets its own "Sub:" line - showing the
              // substitute in both places printed their name twice.
              const sub = s.substituteFacultyName;
              const faculty = sub ? s.facultyName : slotFacultyName(s);
              const batch = s.labBatch ? escapeHtml(s.labBatch) : "";
              const isLab = !!s.labBatch || subjectMap.get(s.subjectId)?.type === "PRACTICAL";
              return `<div class="cell${sub ? " cell-sub" : isLab ? " cell-lab" : ""}">
                <div class="cell-code">${code}</div>
                ${batch ? `<div class="cell-batch">${batch}</div>` : ""}
                ${faculty ? `<div class="cell-faculty">${escapeHtml(faculty)}</div>` : ""}
                ${sub ? `<div class="cell-subnote">Sub: ${escapeHtml(sub)}</div>` : ""}
                ${s.classroom ? `<div class="cell-room">Room ${escapeHtml(s.classroom)}</div>` : ""}
              </div>`;
            })
            .join("");
          return `<td class="cellBorder">${inner}</td>`;
        })
        .join("");
      return `<tr><th class="cellBorder day-cell">${escapeHtml(DAY_LABELS[day] ?? day)}</th>${cells}</tr>`;
    })
    .join("");

  const gridHtml = `
  <table class="timetable-grid" cellspacing="0" cellpadding="0">
    ${colGroup}
    <thead><tr>${dayHeader}${periodHeaders}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;

  // ── Allocation of subjects ────────────────────────────────────────────────
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  const allocationHtml = allocation.length
    ? `
  <div class="section-title">Allocation of Subjects</div>
  <table class="allocation-table" cellspacing="0" cellpadding="0">
    <thead>
      <tr>
        <th class="cellBorder" style="width:8%">S.No</th>
        <th class="cellBorder" style="width:14%">Subject Code</th>
        <th class="cellBorder">Subject</th>
        <th class="cellBorder" style="width:20%">Name of Faculty</th>
        <th class="cellBorder" style="width:10%">Type</th>
        <th class="cellBorder" style="width:8%">Hrs/Wk</th>
      </tr>
    </thead>
    <tbody>
      ${allocation
        .map(
          (a, i) => `<tr>
        <td class="cellBorder center">${i + 1}</td>
        <td class="cellBorder center strong">${escapeHtml(a.code)}</td>
        <td class="cellBorder">${escapeHtml(a.name)}${a.labBatches.length ? `<span class="muted"> (${escapeHtml(a.labBatches.join(", "))})</span>` : ""}</td>
        <td class="cellBorder">${escapeHtml(a.faculty)}</td>
        <td class="cellBorder center">${escapeHtml(a.subjectType === "PRACTICAL" ? "Practical" : a.subjectType === "THEORY" ? "Theory" : "—")}</td>
        <td class="cellBorder center">${a.hoursPerWeek != null ? a.hoursPerWeek : "—"}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>`
    : "";

  // ── Signature block ───────────────────────────────────────────────────────
  const signatureHtml = showSignatures
    ? `
  <div class="signature-row">
    <div class="signature-block"><div class="signature-line"></div><div class="signature-title">Class In-charge</div></div>
    <div class="signature-block"><div class="signature-line"></div><div class="signature-title">${escapeHtml(signatureLabels?.incharge ?? "Timetable Incharge")}</div></div>
    <div class="signature-block"><div class="signature-line"></div><div class="signature-title">${escapeHtml(signatureLabels?.principal ?? "Principal")}</div></div>
  </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(documentTitle)}${sectionName ? ` - Section ${escapeHtml(sectionName)}` : ""}${collegeName ? ` - ${escapeHtml(collegeName)}` : ""}</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; font-size: 11px; line-height: 1.3; }
    /* The PDF renderer captures .page edge to edge, so the page margin has to
       live inside it as padding - a margin outside .page never reaches the file. */
    .page { width: 210mm; margin: 0 auto; padding: 10mm 10mm 12mm; }

    .letterhead { width: 100%; margin-bottom: 10px; border: 0; }
    .logo-cell { width: 90px; padding-right: 8px; vertical-align: middle; text-align: center; }
    .logo-cell img { max-width: 80px; max-height: 72px; object-fit: contain; }
    .letterhead-text { vertical-align: middle; text-align: center; }
    .inst-name { font-size: 16pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px; color: #1e3a5f; }
    .inst-code { font-size: 9pt; font-weight: 700; }
    .identity-line { font-size: 8.5pt; font-weight: 600; color: #374151; }
    .doc-title { font-size: 12pt; font-weight: 800; letter-spacing: 2px; margin: 8px 0 6px; padding: 5px 0; background: #1e3a5f; color: #fff; }
    .meta-line { margin-top: 3px; font-size: 8.5pt; font-weight: 700; color: #111827; }
    .meta-sub { font-weight: 600; color: #4b5563; font-size: 8pt; }
    .meta-sep { color: #9ca3af; font-weight: 400; }
    .muted { color: #6b7280; }

    /* Borders on right/bottom of each cell plus top/left on the table: with
       border-collapse the canvas capture drew every shared edge twice, so inner
       lines looked twice as heavy as the outer ones. */
    table { border-collapse: separate; border-spacing: 0; border-top: 1px solid #6b7280; border-left: 1px solid #6b7280; }
    .cellBorder { border-right: 1px solid #6b7280; border-bottom: 1px solid #6b7280; padding: 4px 3px; text-align: center; vertical-align: middle; }
    th.cellBorder { font-weight: 800; font-size: 8.5pt; background: #e8eef6; color: #1e3a5f; }
    .col-time { font-size: 6.5pt; font-weight: 500; color: #4b5563; margin-top: 1px; white-space: nowrap; }
    .period-label { font-size: 8pt; }
    .break-label { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; }
    .col-day { width: 21mm; }
    .col-break { width: 14mm; }
    .day-head, .day-cell { font-size: 7pt; text-transform: uppercase; overflow: hidden; }
    .day-cell { background: #e8eef6; color: #1e3a5f; font-weight: 800; }

    .timetable-grid { width: 100%; table-layout: fixed; }
    .timetable-grid td { height: 38px; font-size: 8pt; overflow: hidden; word-break: break-word; }
    .break-cell { background: #f1f3f6; }
    .cell { line-height: 1.2; padding: 1px 0; }
    .cell-code { font-size: 9.5pt; font-weight: 800; text-transform: uppercase; }
    .cell-faculty { font-size: 7pt; font-weight: 600; color: #374151; }
    .cell-batch { font-size: 6.5pt; font-weight: 700; color: #4b5563; }
    .cell-room { font-size: 6.5pt; font-weight: 600; color: #6b7280; }
    .cell-lab { background: #e9f6ec; }
    .cell-sub { background: #fff3d6; }
    .cell-subnote { font-size: 6.5pt; font-weight: 700; color: #7a5200; }

    .section-title { font-size: 10.5pt; font-weight: 800; text-transform: uppercase; text-align: center; margin: 16px 0 6px; color: #1e3a5f; letter-spacing: 0.5px; }
    .allocation-table { width: 100%; table-layout: fixed; }
    .allocation-table td, .allocation-table th { font-size: 8.5pt; padding: 4px 6px; }
    .center { text-align: center; }
    .strong { font-weight: 800; }

    .signature-row { display: flex; justify-content: space-around; margin-top: 48px; }
    .signature-block { text-align: center; width: 26%; }
    .signature-line { border-top: 1px solid #111827; margin-bottom: 4px; }
    .signature-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; padding-bottom: 2px; }
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
