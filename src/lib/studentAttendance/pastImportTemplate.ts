import type ExcelJSType from "exceljs";

// The "Download template" workbook for the past student attendance import. A real .xlsx (not a CSV: Excel turns a
// CSV's date headers into numbers and shows them as ####). Sheet one is the template to fill in, sheet two a
// completed example in the college register's own layout, sheet three the rules. Every date header and the Regd.
// No column are stored as text with explicit widths, so nothing is converted or squeezed. The upload page skips the
// Sample and How to fill sheets (see SKIPPED_SHEET there), so only sheets with real data are read.

export function buildPastAttendanceTemplate(ExcelJS: typeof ExcelJSType): ExcelJSType.Workbook {
  const wb = new ExcelJS.Workbook();

  const t = wb.addWorksheet("Template");
  t.columns = [{ width: 18 }, { width: 30 }, ...Array.from({ length: 5 }, () => ({ width: 14 }))];
  t.addRow(["Regd. No", "Name", "11-8-2026", "12-8-2026", "13-8-2026", "14-8-2026", "15-8-2026"]);
  t.getRow(1).font = { bold: true };
  t.getColumn(1).numFmt = "@";
  for (let c = 3; c <= 7; c++) t.getRow(1).getCell(c).numFmt = "@";

  const s = wb.addWorksheet("Sample");
  s.columns = [{ width: 8 }, { width: 18 }, { width: 30 }, ...Array.from({ length: 6 }, () => ({ width: 12 })), { width: 8 }, { width: 8 }, { width: 18 }];
  s.addRow(["VISHNU WOMEN'S UNIVERSITY"]);
  s.addRow(["I B.TECH. REGD.NO'S :: 2026-27"]);
  s.addRow(["CSE SECTION A"]);
  s.addRow(["S.No.", "Regd.No.", "Name of the Student", "29-8-2026", "31-8-2026", "1-9-2026", "2", "3", "5", "CC", "AC", "% of Attendance"]);
  s.addRow([1, "26BV1A05001", "EXAMPLE STUDENT ONE", "p", "p", "A", "p", "", "p", 6, 4]);
  s.addRow([2, "26BV1A05002", "EXAMPLE STUDENT TWO", "p", "p", "p", "p", "p", "A", 6, 5]);
  s.addRow([]);
  s.addRow(["", "REGISTRAR"]);
  s.addRow(["", "15.10.2026"]);
  s.getRow(4).font = { bold: true };
  s.getColumn(2).numFmt = "@";
  for (const r of [5, 6]) s.getCell(`L${r}`).value = { formula: `ROUND(K${r}/J${r}*100,1)`, result: r === 5 ? 66.7 : 83.3 };
  for (let c = 4; c <= 9; c++) s.getRow(4).getCell(c).numFmt = "@";

  const h = wb.addWorksheet("How to fill");
  h.columns = [{ width: 120 }];
  for (const line of [
    "HOW TO FILL THE PAST STUDENT ATTENDANCE SHEET",
    "",
    "1. Use one sheet per section. The Sample and How to fill sheets are ignored on upload.",
    "2. Regd. No column: the student's Regd. No, kept as text. Name is optional.",
    "3. One column per class day. Write each date in full, like 11-8-2026 (day-month-year).",
    "   In a register-style sheet, a day number (2, 3, 5 ...) is allowed straight after a full date; the month carries on from it.",
    "4. In each cell put P (present) or A (absent). Leave it blank when there is no record - that student is left out of that day.",
    "5. The day's P or A is applied to every period of that day in the section's timetable.",
    "6. Sundays, holidays and days with no timetable are skipped. A period that already has attendance is never changed.",
    "7. Extra columns such as S.No., CC, AC and % of Attendance are ignored. Rows under the last student (REGISTRAR, a date) are ignored.",
    "8. After uploading, pick the section for each sheet, press Preview all, check the day-by-day table, then Import.",
  ]) h.addRow([line]);
  h.getRow(1).font = { bold: true };

  return wb;
}
