// A real .xlsx workbook for a section's weekly timetable, replacing the old
// "download" that wrapped the printable HTML in a Blob with an Excel MIME type
// (which Excel opens as an HTML document, warning that the extension doesn't
// match). Built with exceljs, the same dependency lib/finance/exportExcel.ts
// already uses, so there's no second spreadsheet engine in the bundle.
//
// Same shared grid/column derivation as the on-screen table and the PDF
// (lib/timetable/gridModel.ts), so the three renderings can't drift.

import ExcelJS from "exceljs";
import type { CourseYearTiming, DayOfWeek, Department, PeriodTiming, Subject, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import { formatTime12h } from "./facultyTimetablePdf";
import { loadExcelLogo } from "./logoAsset";
import {
  buildAllocationList,
  buildTimetableColumns,
  latestEffectiveDate,
  resolveTimetableDays,
  slotShortCode, mergeCoTaughtSlots, continuousSpans,
} from "./gridModel";
import { resolveSignatureRows } from "./signatureAuthority";
import { buildTimetableHeaderLines, collegeHeading, departmentHeading, facultyClassLabel, facultyTimetableTitle, groupAllocationByType, facultyInitials, timetableTitle } from "./timetableHeader";

export interface SectionTimetableXlsxOptions {
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  /** The college's city, printed beside its name. */
  city?: string;
  phone?: string;
  /** The college's own logo; the bundled Vishnu logo is used when absent or unreachable. */
  logoUrl?: string;
  departmentName?: string;
  courseName?: string;
  sectionName?: string;
  sectionYear?: number;
  batch?: string;
  regulation?: string;
  academicYear?: string;
  semesterLabel?: string;
  classroom?: string;
  classInchargeName?: string;
  effectiveDate?: string;
  /** Show faculty/batches of one subject in a period as one entry (default true). */
  mergeCoTaught?: boolean;
  /** The college's chosen signature rows (Super Admin > Settings); empty = the default In-Charge / HOD / Principal row. */
  signatureRows?: string[][];
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
}

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

const DAY_COL_WIDTH = 13;
const PERIOD_COL_WIDTH = 16;
const BREAK_COL_WIDTH = 11;
const LINE_HEIGHT = 13;

// Drawn between two subjects sharing one period, so they never run together.
const DIVIDER = "- - - - - - - - - -";

/** Border + alignment for every cell of a merged or plain range, by index (eachCell skips empty cells). */
function styleRange(
  sheet: ExcelJS.Worksheet,
  row: number,
  fromCol: number,
  toCol: number,
  opts: { bold?: boolean; align?: "left" | "center"; size?: number } = {}
) {
  for (let c = fromCol; c <= toCol; c++) {
    const cell = sheet.getCell(row, c);
    cell.border = BORDER;
    cell.font = { bold: opts.bold ?? false, size: opts.size ?? 10 };
    cell.alignment = { horizontal: opts.align ?? "center", vertical: "middle", wrapText: true };
  }
}

/**
 * Splits `total` columns into `weights.length` contiguous groups roughly in
 * proportion to `weights`, every group at least one column wide. Lets the
 * allocation table sit under a grid of any width without touching the grid's
 * own column sizes.
 */
function splitColumns(total: number, weights: number[]): [number, number][] {
  const groups = weights.length;
  if (total < groups) return weights.map((_, i) => [i + 1, i + 1] as [number, number]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(1, Math.floor((w / sum) * total)));
  let diff = total - sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; diff > 0; i = (i + 1) % groups, diff--) sizes[i]++;
  for (let i = 0; diff < 0; i = (i + 1) % groups) {
    if (sizes[i] > 1) { sizes[i]--; diff++; }
  }
  const out: [number, number][] = [];
  let start = 1;
  for (const size of sizes) {
    out.push([start, start + size - 1]);
    start += size;
  }
  return out;
}

export async function buildSectionTimetableXlsxBuffer(opts: SectionTimetableXlsxOptions): Promise<ArrayBuffer> {
  const {
    collegeName = "",
    affiliation = "",
    city = "",
    departmentName,
    courseName,
    sectionName,
    sectionYear,
    semesterLabel,
    classInchargeName,
    periodTimings,
    slots,
    subjects = [],
    assignments = [],
    lunchBreak,
    shortBreaks,
  } = opts;

  const days = resolveTimetableDays(null, opts.days?.length ? opts.days : slots.map((s) => s.day));
  const columns = buildTimetableColumns(
    opts.timing ?? {
      numberOfPeriods: opts.periods.length,
      periods: periodTimings,
      periodDurationMinutes: 0,
      collegeStartTime: periodTimings[0]?.startTime ?? "",
      // afterPeriod 0 matches no period, so no break config yields no break column.
      lunchBreak: lunchBreak ?? { afterPeriod: 0, durationMinutes: 0 },
      shortBreaks: shortBreaks ?? [],
    },
    {}
  );
  const subjectMap = new Map(subjects.map((s) => [s.id, s]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = collegeName || "Timetable Export";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Timetable", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  const lastCol = columns.length + 1; // Day + every period/break column

  sheet.getColumn(1).width = DAY_COL_WIDTH;
  columns.forEach((col, i) => {
    sheet.getColumn(i + 2).width = col.kind === "break" ? BREAK_COL_WIDTH : PERIOD_COL_WIDTH;
  });

  // ── Letterhead: college, affiliation, department, "Time Table <year>" ────
  let r = 1;
  // Letterhead text sits to the right of the logo, which occupies the Day
  // column - so the two can never overlap, however narrow the grid is.
  const textFrom = lastCol >= 2 ? 2 : 1;
  const letterheadRows: number[] = [];
  const putAcross = (text: string, font: Partial<ExcelJS.Font>, fromCol = 1) => {
    const row = sheet.getRow(r);
    row.getCell(fromCol).value = text;
    row.getCell(fromCol).font = font;
    row.getCell(fromCol).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (lastCol > fromCol) sheet.mergeCells(r, fromCol, r, lastCol);
    // Wrapped text needs a taller row: estimate how many lines it takes across the merged width.
    const widthChars = Math.max(10, (lastCol - fromCol + 1) * 14);
    const lines = Math.max(1, Math.ceil((text.length * ((font.size ?? 10) / 10)) / widthChars));
    row.height = Math.max(16, (font.size ?? 10) * 1.6) * lines;
    if (fromCol === textFrom) letterheadRows.push(r);
    r++;
  };
  const letterheadStart = r;

  if (collegeName) putAcross(collegeHeading(collegeName, city), { bold: true, size: 14 }, textFrom);
  if (affiliation) putAcross(affiliation, { bold: true, size: 11 }, textFrom);
  const deptHeading = departmentHeading(departmentName);
  if (deptHeading) putAcross(deptHeading, { bold: true, size: 11 }, textFrom);
  putAcross(timetableTitle(opts.academicYear), { bold: true, size: 11 }, textFrom);
  // Logo: fitted inside the Day column and the letterhead rows above the title.
  const logo = await loadExcelLogo(opts.logoUrl);
  if (logo && r > letterheadStart) {
    try {
      const rowsPx = (sheet.getRows(letterheadStart, r - letterheadStart) ?? []).reduce((n, row) => n + ((row.height ?? 15) * 96) / 72, 0);
      const colPx = DAY_COL_WIDTH * 7 + 5;
      const box = Math.max(24, Math.min(rowsPx - 6, colPx - 8, 84));
      const ratio = logo.width && logo.height ? logo.width / logo.height : 1;
      const w = ratio >= 1 ? box : box * ratio;
      const h = ratio >= 1 ? box / ratio : box;
      const imageId = workbook.addImage({ base64: logo.base64, extension: logo.extension });
      const firstRowPx = (((sheet.getRow(letterheadStart).height ?? 15) * 96) / 72) || 20;
      sheet.addImage(imageId, {
        tl: { col: Math.max(0, (colPx - w) / 2 / colPx), row: letterheadStart - 1 + Math.min(0.9, Math.max(0, (rowsPx - h) / 2 / firstRowPx)) },
        ext: { width: w, height: h },
        editAs: "oneCell",
      });
    } catch {
      // A logo that can't be placed must never fail the download.
    }
  }

  r++; // spacer

  // ── Class details: year / branch / class in-charge on the left, W.E.F and room on the right ──
  const header = buildTimetableHeaderLines({
    courseName,
    year: sectionYear,
    semesterLabel,
    sectionName,
    departmentName,
    classroom: opts.classroom,
    classInchargeName,
    effectiveDate: opts.effectiveDate ?? latestEffectiveDate(slots),
  });
  const leftLines = [header.yearLine, header.branchLine, header.inchargeLine].filter(Boolean);
  const rightLines = [header.wefLine, header.roomLine].filter(Boolean);
  const split = lastCol >= 2 ? Math.ceil(lastCol / 2) : lastCol;
  for (let i = 0; i < Math.max(leftLines.length, rightLines.length); i++) {
    const row = sheet.getRow(r);
    if (leftLines[i]) {
      row.getCell(1).value = leftLines[i];
      row.getCell(1).font = { bold: true, size: 10 };
      row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
      if (split > 1) sheet.mergeCells(r, 1, r, split);
    }
    // Both right-hand lines start in the same column (W.E.F over ROOM NO), over the last three columns.
    if (rightLines[i] && lastCol > split) {
      const from = Math.max(split + 1, lastCol - 2);
      row.getCell(from).value = rightLines[i];
      row.getCell(from).font = { bold: true, size: 10 };
      row.getCell(from).alignment = { horizontal: "left", vertical: "middle" };
      if (lastCol > from) sheet.mergeCells(r, from, r, lastCol);
    }
    row.height = 16;
    r++;
  }

  r++; // spacer

  // ── Grid header, two rows like the printed sheet: PERIOD | 1 2 3 ... then DAY | clock times ──
  const periodRowIndex = r++;
  const timeRowIndex = r++;
  sheet.getCell(periodRowIndex, 1).value = "PERIOD";
  sheet.getCell(timeRowIndex, 1).value = "DAY";
  columns.forEach((col, i) => {
    const time = col.startTime && col.endTime ? `${formatTime12h(col.startTime)} - ${formatTime12h(col.endTime)}` : "";
    if (col.kind === "break") {
      sheet.getCell(periodRowIndex, i + 2).value = time;
      sheet.mergeCells(periodRowIndex, i + 2, timeRowIndex, i + 2);
    } else {
      sheet.getCell(periodRowIndex, i + 2).value = col.periodNumber;
      sheet.getCell(timeRowIndex, i + 2).value = time;
    }
  });
  styleRange(sheet, periodRowIndex, 1, lastCol, { bold: true });
  styleRange(sheet, timeRowIndex, 1, lastCol, { bold: true, size: 9 });
  sheet.getRow(periodRowIndex).height = 20;
  sheet.getRow(timeRowIndex).height = 2 * LINE_HEIGHT + 6;
  // Keep the Day column and period header on screen while scrolling, and
  // repeat the header if the sheet ever prints on more than one page.
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: timeRowIndex }];
  sheet.pageSetup.printTitlesRow = `${periodRowIndex}:${timeRowIndex}`;

  // ── Grid body: subject code with the faculty's initials in brackets, like the printed timetable ──
  const firstBodyRow = r;
  for (const day of days) {
    const row = sheet.getRow(r);
    row.getCell(1).value = day;
    let maxLines = 1;
    // Periods merged in the timetable editor (a 2-3 period lab block, one subject across back-to-back
    // periods) are one wide cell here too, exactly as on screen and in the PDF.
    const { spans, skipped } = continuousSpans(columns, (p) => slots.filter((s) => s.day === day && s.periodNumber === p));
    columns.forEach((col, i) => {
      if (col.kind === "break" || skipped.has(i)) return;
      // Faculty of one subject sharing the period print the subject once.
      const rawCell = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
      const cellSlots = opts.mergeCoTaught === false ? rawCell : mergeCoTaughtSlots(rawCell);
      if (cellSlots.length === 0) return;
      // One block per subject: the code, its faculty initials, then batch / room / cover in smaller type.
      // Two subjects in one period are told apart by a divider line between them.
      const richText: ExcelJS.RichText[] = [];
      let lines = 0;
      cellSlots.forEach((s, bi) => {
        if (bi > 0) {
          richText.push({ text: "\n" + DIVIDER + "\n", font: { size: 8, color: { argb: "FF9CA3AF" } } });
          lines += 1;
        }
        const notes = [
          s.labBatch,
          s.classroom ? (/^room/i.test(s.classroom.trim()) ? s.classroom.trim() : `ROOM NO: ${s.classroom.trim()}`) : undefined,
          s.substituteFacultyName ? `Sub: ${s.substituteFacultyName}` : undefined,
        ].filter((v): v is string => !!v);
        const initials = facultyInitials(s.facultyName);
        richText.push({ text: slotShortCode(s, subjectMap), font: { size: 10 } });
        lines += 1;
        if (initials) {
          richText.push({ text: `\n(${initials})`, font: { size: 10 } });
          lines += 1;
        }
        if (notes.length) richText.push({ text: "\n" + notes.join("\n"), font: { size: 9, color: { argb: "FF4B5563" } } });
        lines += notes.length;
      });
      const cell = row.getCell(i + 2);
      cell.value = { richText };
      maxLines = Math.max(maxLines, lines);
      const span = spans.get(i) ?? 1;
      if (span > 1) sheet.mergeCells(r, i + 2, r, i + 1 + span);
    });
    styleRange(sheet, r, 1, lastCol);
    row.getCell(1).font = { bold: true, size: 10 };
    row.height = Math.max(32, maxLines * LINE_HEIGHT + 8);
    r++;
  }
  const lastBodyRow = r - 1;

  // Break columns: vertically merged across all day rows with vertical text rotation
  columns.forEach((col, i) => {
    if (col.kind !== "break") return;
    const colIdx = i + 2;
    if (lastBodyRow >= firstBodyRow) {
      sheet.mergeCells(firstBodyRow, colIdx, lastBodyRow, colIdx);
      const cell = sheet.getCell(firstBodyRow, colIdx);
      cell.value = col.breakKind === "lunch" ? "LUNCH BREAK" : "SHORT BREAK";
      styleRange(sheet, firstBodyRow, colIdx, colIdx, { bold: true, size: 10 });
      cell.alignment = { horizontal: "center", vertical: "middle", textRotation: 90, wrapText: true };
    }
  });

  // Heavier frame round the grid and under the header, like the printed sheet.
  const heavy = (row: number, col: number, side: "top" | "left" | "bottom" | "right") => {
    const cell = sheet.getCell(row, col);
    cell.border = { ...cell.border, [side]: { style: "medium" } };
  };
  if (lastBodyRow >= firstBodyRow) {
    for (let c = 1; c <= lastCol; c++) {
      heavy(periodRowIndex, c, "top");
      heavy(timeRowIndex, c, "bottom");
      heavy(lastBodyRow, c, "bottom");
    }
    for (let rr = periodRowIndex; rr <= lastBodyRow; rr++) {
      heavy(rr, 1, "left");
      heavy(rr, 1, "right");
      heavy(rr, lastCol, "right");
    }
  }

  // ── Subject list: S.No | Subject Name | Sub Acr | Faculty, under the grid, using merged
  //    column groups so the grid's own column widths are never changed ──────
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  if (allocation.length) {
    r++; // spacer

    const headings = ["S.No", "Subject Name", "Sub Acr", "Faculty"];
    const groups = splitColumns(lastCol, [1, 4, 1.5, 3.5]);
    const mergeable = lastCol >= headings.length;

    const writeRow = (rowIndex: number, values: (string | number)[], bold: boolean) => {
      values.forEach((value, i) => {
        const [from, to] = groups[i];
        sheet.getCell(rowIndex, from).value = value;
        if (mergeable && to > from) sheet.mergeCells(rowIndex, from, rowIndex, to);
        for (let c = from; c <= to; c++) {
          const cell = sheet.getCell(rowIndex, c);
          cell.font = { bold, size: 10 };
          cell.alignment = { horizontal: i === 0 ? "center" : "left", vertical: "middle", wrapText: true };
        }
      });
    };

    writeRow(r, headings, true);
    sheet.getRow(r).height = 20;
    r++;
    for (const group of groupAllocationByType(allocation)) {
      // Theory / Practical ... heading, then that kind's subjects numbered from 1.
      sheet.getCell(r, 1).value = group.label;
      if (lastCol > 1) sheet.mergeCells(r, 1, r, lastCol);
      sheet.getCell(r, 1).font = { bold: true, size: 10 };
      sheet.getCell(r, 1).alignment = { horizontal: "left", vertical: "middle" };
      sheet.getRow(r).height = 20;
      r++;
      group.entries.forEach((a, idx) => {
        const subject = a.labBatches.length ? `${a.name} (${a.labBatches.join(", ")})` : a.name;
        writeRow(r, [idx + 1, subject, a.shortCode, a.faculty], false);
        sheet.getRow(r).height = 18;
        r++;
      });
    }
  }

  // ── Equally-spaced signature blocks, one row per chosen group ──────────────
  r += 2; // spacer
  for (const row of resolveSignatureRows(opts.signatureRows, departmentName)) {
    const sigGroups = splitColumns(lastCol, row.map(() => 1));
    row.forEach((label, i) => {
      const [from, to] = sigGroups[i];
      sheet.getCell(r, from).value = label;
      if (to > from) sheet.mergeCells(r, from, r, to);
      styleRange(sheet, r, from, to, { bold: true, align: "center" });
    });
    sheet.getRow(r).height = 24;
    r += 3; // room to sign
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** Build the workbook and save it as `filename` (should end in .xlsx). */
export async function downloadSectionTimetableXlsx(opts: SectionTimetableXlsxOptions, filename: string): Promise<void> {
  const buffer = await buildSectionTimetableXlsxBuffer(opts);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface FacultyTimetableXlsxOptions {
  facultyName: string;
  semesterLabel: string;
  weekStart: Date;
  weekEnd: Date;
  days: DayOfWeek[];
  periods: number[];
  slots: (TimetableSlot & { id: string })[];
  assignmentById: Map<string, TeachingAssignment>;
  periodTimeFor: (courseId: string | undefined, year: number | undefined, period: number) => PeriodTiming | undefined;
  courseCodeById: Map<string, string>;
  departments: Department[];
  formatDMY: (d: Date) => string;
  departmentName?: string;
  college?: { name?: string; code?: string; affiliation?: string; address?: string; city?: string; phone?: string; logoUrl?: string; teachingLoadSignatureRows?: string[][] };
}

export async function downloadFacultyTimetableXlsx(opts: FacultyTimetableXlsxOptions, filename: string): Promise<void> {
  const { facultyName, semesterLabel, days, periods, slots, assignmentById, periodTimeFor, courseCodeById } = opts;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Faculty Management System";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Faculty Timetable", {
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  const lastCol = days.length + 1; // Period column + Day columns
  sheet.getColumn(1).width = 16;
  days.forEach((_, i) => {
    sheet.getColumn(i + 2).width = 22;
  });

  let r = 1;
  const putHeader = (text: string, font: Partial<ExcelJS.Font>) => {
    const row = sheet.getRow(r);
    row.getCell(1).value = text;
    row.getCell(1).font = font;
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.mergeCells(r, 1, r, lastCol);
    row.height = (font.size ?? 11) * 1.8;
    r++;
  };

  // Letterhead like the section timetable's: logo in column 1, college details beside it.
  const c = opts.college ?? {};
  const letterheadStart = r;
  const putText = (text: string, font: Partial<ExcelJS.Font>) => {
    const row = sheet.getRow(r);
    row.getCell(2).value = text;
    row.getCell(2).font = font;
    row.getCell(2).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (lastCol > 2) sheet.mergeCells(r, 2, r, lastCol);
    row.height = Math.max(16, (font.size ?? 10) * 1.6);
    r++;
  };
  // Only the assignments the grid actually shows (the summary follows the slots).
  const shownIds = new Set(slots.map((sl) => sl.assignmentId));
  const shownAssignments = Array.from(assignmentById.values()).filter((a) => shownIds.has(a.id));
  const deptName = opts.departmentName || Array.from(new Set(shownAssignments.map((a) => a.department).filter(Boolean))).join(", ");
  if (c.name) putText(collegeHeading(c.name, c.city), { bold: true, size: 14 });
  if (c.affiliation) putText(c.affiliation, { bold: true, size: 11 });
  if (deptName) putText(departmentHeading(deptName), { bold: true, size: 11 });
  putText(facultyTimetableTitle(slots.find((sl) => sl.academicYear)?.academicYear, semesterLabel), { bold: true, size: 11 });
  const logo = await loadExcelLogo(c.logoUrl);
  if (logo && r > letterheadStart) {
    try {
      const rowsPx = (sheet.getRows(letterheadStart, r - letterheadStart) ?? []).reduce((n, row) => n + ((row.height ?? 15) * 96) / 72, 0);
      const colPx = 16 * 7 + 5;
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
  r++; // spacer
  putHeader(`Faculty: ${facultyName}`, { bold: true, size: 11 });
  r++; // spacer

  const headerRowIndex = r++;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.getCell(1).value = "Period / Day";
  headerRow.getCell(1).font = { bold: true };
  headerRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  headerRow.getCell(1).border = BORDER;

  days.forEach((d, i) => {
    const cell = headerRow.getCell(i + 2);
    cell.value = DAY_LABELS[d] ?? d;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = BORDER;
  });
  headerRow.height = 24;

  for (const period of periods) {
    const row = sheet.getRow(r);
    const rowSlots = slots.filter((s) => s.periodNumber === period && days.includes(s.day));
    const rowTimes = new Set(
      rowSlots
        .map((s) => periodTimeFor(s.courseId, s.year, period))
        .filter((t): t is PeriodTiming => !!t)
        .map((t) => `${formatTime12h(t.startTime)}–${formatTime12h(t.endTime)}`)
    );
    const timeLabel = rowTimes.size === 1 ? `\n${[...rowTimes][0]}` : "";
    row.getCell(1).value = `Period ${period}${timeLabel}`;
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    row.getCell(1).border = BORDER;

    let maxLines = 1;
    days.forEach((d, i) => {
      const cellSlots = slots.filter((s) => s.day === d && s.periodNumber === period);
      const cell = row.getCell(i + 2);
      cell.border = BORDER;
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

      if (cellSlots.length === 0) {
        cell.value = "—";
        cell.font = { color: { argb: "FF888888" } };
      } else {
        const textBlocks = cellSlots.map((slot) => {
          const assignment = assignmentById.get(slot.assignmentId);
          const courseCode = assignment?.courseId ? courseCodeById.get(assignment.courseId) : undefined;
          const classStr = [courseCode ?? assignment?.courseName, assignment?.year ? `Yr ${assignment.year}` : null, assignment?.sectionName ? `Sec ${assignment.sectionName}` : null].filter(Boolean).join(" ");
          const subjStr = assignment?.shortCode || assignment?.subjectName || slot.subjectName;
          const roomStr = slot.classroom ? (/^room/i.test(slot.classroom.trim()) ? slot.classroom.trim() : `ROOM NO: ${slot.classroom.trim()}`) : "";
          return [classStr, subjStr, roomStr].filter(Boolean).join("\n");
        });
        cell.value = textBlocks.join("\n---\n");
        cell.font = { size: 9, bold: true };
        const linesCount = textBlocks.reduce((acc, b) => acc + b.split("\n").length, 0);
        maxLines = Math.max(maxLines, linesCount);
      }
    });
    row.height = Math.max(30, maxLines * LINE_HEIGHT + 10);
    r++;
  }

  // ── Bottom: subject list (S.No | Class | Sub Acronym | Subject Name), then the signatures ──
  const classRows = new Map<string, { cls: string; acr: string; name: string }>();
  for (const a of shownAssignments) {
    const semester = slots.find((sl) => sl.assignmentId === a.id)?.semester ?? a.semester;
    const cls = facultyClassLabel({ courseName: a.courseName, year: a.year, semester, sectionName: a.sectionName });
    const acr = a.shortCode ?? a.subjectCode ?? "—";
    const name = a.subjectName ?? "—";
    classRows.set(`${cls}|${acr}|${name}`, { cls, acr, name });
  }
  if (classRows.size > 0) {
    r += 2;
    const groups = splitColumns(lastCol, [1, 3, 2, 4]);
    const mergeable = lastCol >= 4;
    const writeRow = (rowIndex: number, values: (string | number)[], bold: boolean) => {
      values.forEach((value, i) => {
        const [from, to] = groups[i];
        sheet.getCell(rowIndex, from).value = value;
        if (mergeable && to > from) sheet.mergeCells(rowIndex, from, rowIndex, to);
        for (let col = from; col <= to; col++) {
          const cell = sheet.getCell(rowIndex, col);
          cell.font = { bold, size: 10 };
          cell.alignment = { horizontal: i === 0 ? "center" : "left", vertical: "middle", wrapText: true };
        }
      });
    };
    writeRow(r, ["S.No", "Class", "Sub Acronym", "Subject Name"], true);
    sheet.getRow(r).height = 20;
    r++;
    Array.from(classRows.values()).forEach((row, i) => {
      writeRow(r, [i + 1, row.cls, row.acr, row.name], false);
      sheet.getRow(r).height = 18;
      r++;
    });
  }

  // Signature blocks, one row per group the college chose (default: In-Charge / HOD / Principal).
  r += 2;
  for (const row of resolveSignatureRows(c.teachingLoadSignatureRows, deptName)) {
    const sigGroups = splitColumns(lastCol, row.map(() => 1));
    row.forEach((label, i) => {
      const [from, to] = sigGroups[i];
      sheet.getCell(r, from).value = label;
      if (to > from) sheet.mergeCells(r, from, r, to);
      styleRange(sheet, r, from, to, { bold: true, align: "center" });
      for (let col = from; col <= to; col++) sheet.getCell(r, col).border = {};
    });
    sheet.getRow(r).height = 24;
    r += 3;
  }

  const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

