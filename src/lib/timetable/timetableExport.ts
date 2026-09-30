// A real .xlsx workbook for a section's weekly timetable, replacing the old
// "download" that wrapped the printable HTML in a Blob with an Excel MIME type
// (which Excel opens as an HTML document, warning that the extension doesn't
// match). Built with exceljs, the same dependency lib/finance/exportExcel.ts
// already uses, so there's no second spreadsheet engine in the bundle.
//
// Same shared grid/column derivation as the on-screen table and the PDF
// (lib/timetable/gridModel.ts), so the three renderings can't drift.

import ExcelJS from "exceljs";
import type { CourseYearTiming, DayOfWeek, PeriodTiming, Subject, TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";
import {
  buildAllocationList,
  buildTimetableColumns,
  ordinalYear,
  periodTimeRange,
  resolveTimetableDays,
  slotFacultyName,
  slotShortCode,
} from "./gridModel";

export interface SectionTimetableXlsxOptions {
  collegeName?: string;
  collegeCode?: string;
  affiliation?: string;
  address?: string;
  phone?: string;
  // The spreadsheet letterhead is text-only on purpose: embedding a remote
  // logo needs a CORS-permissive Storage URL and a Buffer/base64 encoder that
  // isn't guaranteed in a client bundle, and a failed embed must never take the
  // whole download down with it. The PDF export (sectionTimetablePdf.ts) does
  // render the logo.
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

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

// Styles cells 1..lastCol by index. row.eachCell skips cells that were never
// written, so empty timetable slots used to come out with no border and the
// grid looked broken wherever a period was free.
function styleHeaderRow(row: ExcelJS.Row, lastCol: number) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = HEADER_FILL;
    cell.border = BORDER;
  }
}

function styleBodyRow(row: ExcelJS.Row, lastCol: number) {
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDER;
  }
}

/** A4 portrait printable width, in Excel's ~character-width column units. */
const DAY_COL_WIDTH = 13;
const PERIOD_COL_WIDTH = 18;
const BREAK_COL_WIDTH = 9;
const LINE_HEIGHT = 13.5;

export async function buildSectionTimetableXlsxBuffer(opts: SectionTimetableXlsxOptions): Promise<ArrayBuffer> {
  const {
    collegeName = "",
    collegeCode = "",
    affiliation = "",
    address = "",
    phone = "",
    departmentName,
    courseName,
    sectionName,
    sectionYear,
    batch,
    regulation,
    academicYear,
    semesterLabel,
    classroom,
    classInchargeName,
    effectiveDate,
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
      // CourseYearTiming types these as non-optional, but a caller without the
      // real doc may have neither. afterPeriod 0 matches no period (the loop
      // starts at 1), so this yields no break column rather than a fake one.
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
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }, horizontalCentered: true },
  });

  const lastCol = columns.length + 1;

  // ── Letterhead rows ──────────────────────────────────────────────────────
  const putAcross = (rowIndex: number, text: string, font: Partial<ExcelJS.Font>, height?: number) => {
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = text;
    row.getCell(1).font = font;
    row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    sheet.mergeCells(rowIndex, 1, rowIndex, lastCol);
    row.height = height ?? Math.max(16, (font.size ?? 10) * 1.6);
  };

  const identity = [affiliation, address, phone].filter(Boolean).join("  |  ");
  let r = 1;
  if (collegeName) putAcross(r++, `${collegeName}${collegeCode ? `  (Code: ${collegeCode})` : ""}`, { bold: true, size: 14 });
  if (identity) putAcross(r++, identity, { size: 9 });
  putAcross(r++, "TIME TABLE", { bold: true, size: 13 });

  const meta = [
    departmentName,
    courseName,
    sectionYear != null ? ordinalYear(sectionYear) : undefined,
    sectionName ? `Section ${sectionName}` : undefined,
    batch,
    regulation,
    academicYear,
    semesterLabel,
    classroom ? `Room ${classroom}` : undefined,
  ].filter((v): v is string => !!v);
  if (meta.length) putAcross(r++, meta.join("  |  "), { size: 9 });

  const metaSub = [
    classInchargeName ? `Class In-charge: ${classInchargeName}` : undefined,
    effectiveDate ? `Effective from ${effectiveDate}` : undefined,
  ].filter((v): v is string => !!v);
  if (metaSub.length) putAcross(r++, metaSub.join("  |  "), { size: 9, italic: true });

  const headerRowIndex = r++;

  // ── Grid header ──────────────────────────────────────────────────────────
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.getCell(1).value = "Day";
  sheet.getColumn(1).width = DAY_COL_WIDTH;
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 2);
    // Width is a COLUMN property in exceljs - setting it on a cell is a no-op
    // (and isn't in the typings), so size the column itself.
    sheet.getColumn(i + 2).width = col.kind === "break" ? BREAK_COL_WIDTH : PERIOD_COL_WIDTH;
    if (col.kind === "break") {
      const range = periodTimeRange(col.startTime, col.endTime);
      cell.value = [col.label, range].filter(Boolean).join("\n");
    } else {
      const range = periodTimeRange(col.startTime, col.endTime);
      cell.value = [`Period ${col.periodNumber}`, range].filter(Boolean).join("\n");
    }
  });
  styleHeaderRow(headerRow, lastCol);
  headerRow.height = 32;
  // Keep the Day column and period header on screen while scrolling, and repeat
  // the header row if the sheet ever prints on more than one page.
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowIndex }];
  sheet.pageSetup.printTitlesRow = `${headerRowIndex}:${headerRowIndex}`;

  // ── Grid body ────────────────────────────────────────────────────────────
  for (const day of days) {
    const row = sheet.getRow(r++);
    row.getCell(1).value = DAY_LABELS[day] ?? day;
    let maxLines = 1;
    columns.forEach((col, i) => {
      const cell = row.getCell(i + 2);
      if (col.kind === "break") {
        cell.fill = HEADER_FILL;
        return;
      }
      const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
      if (cellSlots.length === 0) return;
      const blocks = cellSlots.map((s) =>
        [
          slotShortCode(s, subjectMap),
          s.labBatch,
          // Substitute gets its own line; the faculty line stays the timetabled one.
          s.substituteFacultyName ? s.facultyName : slotFacultyName(s),
          s.substituteFacultyName ? `Sub: ${s.substituteFacultyName}` : undefined,
          s.classroom ? `Room ${s.classroom}` : undefined,
        ].filter((v): v is string => !!v)
      );
      // Split parallel sessions (lab batches) are separated by a rule of dashes.
      const text = blocks.map((b) => b.join("\n")).join("\n──────\n");
      cell.value = text;
      maxLines = Math.max(maxLines, blocks.reduce((n, b) => n + b.length, 0) + Math.max(0, blocks.length - 1));
      if (cellSlots.some((s) => s.substituteFacultyName)) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6E5" } };
      }
    });
    styleBodyRow(row, lastCol);
    row.getCell(1).font = { bold: true, size: 10 };
    row.height = Math.max(42, maxLines * LINE_HEIGHT + 6);
  }

  // ── Allocation of subjects ───────────────────────────────────────────────
  // On its own sheet: its columns (subject name, faculty) need widths that
  // would otherwise be forced onto the period columns of the grid above.
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  if (allocation.length) {
    const alloc = workbook.addWorksheet("Allocation of Subjects", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    [7, 16, 42, 34, 12, 9].forEach((w, i) => {
      alloc.getColumn(i + 1).width = w;
    });
    const allocHeader = alloc.getRow(1);
    ["S.No", "Subject Code", "Subject", "Name of Faculty", "Type", "Hrs/Wk"].forEach((h, i) => {
      allocHeader.getCell(i + 1).value = h;
    });
    styleHeaderRow(allocHeader, 6);
    allocHeader.height = 22;
    alloc.views = [{ state: "frozen", ySplit: 1 }];

    allocation.forEach((a, i) => {
      const row = alloc.getRow(i + 2);
      row.getCell(1).value = i + 1;
      row.getCell(2).value = a.code;
      row.getCell(3).value = a.labBatches.length ? `${a.name} (${a.labBatches.join(", ")})` : a.name;
      row.getCell(4).value = a.faculty;
      row.getCell(5).value = a.subjectType === "PRACTICAL" ? "Practical" : a.subjectType === "THEORY" ? "Theory" : "—";
      row.getCell(6).value = a.hoursPerWeek ?? "—";
      styleBodyRow(row, 6);
      row.getCell(3).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      row.getCell(4).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      row.height = 20;
    });
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
