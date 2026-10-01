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
import { formatTime12h } from "./facultyTimetablePdf";
import { loadExcelLogo } from "./logoAsset";
import {
  allocationNeedsOfficialCode,
  buildAllocationList,
  buildTimetableColumns,
  ordinalYear,
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

  // ── Letterhead: college, affiliation, address, phone, title, class line ───
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

  if (collegeName) putAcross(`${collegeName}${collegeCode ? ` ( Code: ${collegeCode} )` : ""}`, { bold: true, size: 14 }, textFrom);
  if (affiliation) putAcross(affiliation, { bold: true, size: 10 }, textFrom);
  if (address) putAcross(address, { bold: true, size: 10 }, textFrom);
  if (phone) putAcross(`Tel : ${phone}`, { bold: true, size: 10 }, textFrom);
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

  putAcross("TIME TABLE", { bold: true, size: 13 });

  const classLine = [
    courseName,
    departmentName,
    sectionYear != null ? ordinalYear(sectionYear) : undefined,
    sectionName ? `Section ${sectionName}` : undefined,
    batch,
    regulation,
    semesterLabel,
    academicYear,
    classroom ? `Room ${classroom}` : undefined,
    classInchargeName ? `Class In-charge: ${classInchargeName}` : undefined,
  ].filter((v): v is string => !!v);
  if (classLine.length) putAcross(classLine.join("  |  "), { size: 10 });

  r++; // spacer

  // ── Grid header: Day | Period N + start/end | break + start/end ──────────
  const headerRowIndex = r++;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.getCell(1).value = "Day";
  let maxHeaderLines = 1;
  columns.forEach((col, i) => {
    const time = col.startTime && col.endTime
      ? [formatTime12h(col.startTime), formatTime12h(col.endTime)]
      : [];
    const label = col.kind === "break" ? (col.breakKind === "lunch" ? "Lunch" : "Break") : `Period ${col.periodNumber}`;
    const lines = [label, ...time];
    headerRow.getCell(i + 2).value = lines.join("\n");
    maxHeaderLines = Math.max(maxHeaderLines, lines.length);
  });
  styleRange(sheet, headerRowIndex, 1, lastCol, { bold: true });
  headerRow.height = maxHeaderLines * LINE_HEIGHT + 6;
  // Keep the Day column and period header on screen while scrolling, and
  // repeat the header if the sheet ever prints on more than one page.
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowIndex }];
  sheet.pageSetup.printTitlesRow = `${headerRowIndex}:${headerRowIndex}`;

  // ── Grid body: the subject code only, like the printed timetable ─────────
  for (const day of days) {
    const row = sheet.getRow(r);
    row.getCell(1).value = DAY_LABELS[day] ?? day;
    let maxLines = 1;
    columns.forEach((col, i) => {
      if (col.kind === "break") return;
      const cellSlots = slots.filter((s) => s.day === day && s.periodNumber === col.periodNumber);
      if (cellSlots.length === 0) return;
      const blocks = cellSlots.map((s) =>
        [
          slotShortCode(s, subjectMap),
          s.labBatch,
          s.substituteFacultyName ? `Sub: ${s.substituteFacultyName}` : undefined,
        ].filter((v): v is string => !!v)
      );
      row.getCell(i + 2).value = blocks.map((b) => b.join("\n")).join("\n");
      maxLines = Math.max(maxLines, blocks.reduce((n, b) => n + b.length, 0));
    });
    styleRange(sheet, r, 1, lastCol);
    row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    row.height = Math.max(28, maxLines * LINE_HEIGHT + 6);
    r++;
  }

  // ── Allocation of subjects, under the grid, using merged column groups so the
  //    grid's own column widths are never changed ──────────────────────────
  const allocation = buildAllocationList(slots, { subjects: subjectMap, assignments });
  if (allocation.length) {
    r++; // spacer
    putAcross("Allocation of Subjects", { bold: true, size: 12 });

    const officialCodeCol = allocationNeedsOfficialCode(allocation);
    const headings = officialCodeCol
      ? ["Code", "Subject Code", "Subject", "Name of Faculty", "Faculty Initials"]
      : ["Code", "Subject", "Name of Faculty", "Faculty Initials"];
    const weights = officialCodeCol ? [2, 2, 4, 3, 2] : [2, 4, 3, 2];
    const groups = splitColumns(lastCol, weights);
    const mergeable = lastCol >= headings.length;

    const writeRow = (rowIndex: number, values: string[], bold: boolean) => {
      values.forEach((value, i) => {
        const [from, to] = groups[i];
        sheet.getCell(rowIndex, from).value = value;
        if (mergeable && to > from) sheet.mergeCells(rowIndex, from, rowIndex, to);
        styleRange(sheet, rowIndex, from, to, { bold, align: "left" });
      });
    };

    writeRow(r, headings, true);
    sheet.getRow(r).height = 22;
    r++;
    for (const a of allocation) {
      const subject = a.labBatches.length ? `${a.name} (${a.labBatches.join(", ")})` : a.name;
      const values = officialCodeCol
        ? [a.shortCode, a.code, subject, a.faculty, ""]
        : [a.shortCode, subject, a.faculty, ""];
      writeRow(r, values, false);
      sheet.getRow(r).height = 20;
      r++;
    }
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
