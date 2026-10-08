import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { TimetableSlot } from "@/types";

vi.mock("./logoAsset", () => ({ loadExcelLogo: async () => null }));

import { buildSectionTimetableXlsxBuffer } from "./timetableExport";

const periodTimings = [
  { period: 1, startTime: "09:00", endTime: "09:50" },
  { period: 2, startTime: "09:50", endTime: "10:40" },
  { period: 3, startTime: "10:40", endTime: "11:30" },
  { period: 4, startTime: "11:30", endTime: "12:20" },
];

function slot(over: Partial<TimetableSlot>): TimetableSlot {
  return {
    id: `${over.day}-${over.periodNumber}-${over.assignmentId}`,
    day: "MON", periodNumber: 1, subjectId: "s1", subjectName: "Maths", assignmentId: "a1",
    facultyId: "f1", facultyName: "Faculty One", ...over,
  } as TimetableSlot;
}

async function build(slots: TimetableSlot[]) {
  const buffer = await buildSectionTimetableXlsxBuffer({
    days: ["MON", "TUE"], periods: [1, 2, 3, 4], periodTimings, slots,
    timing: { numberOfPeriods: 4, periods: periodTimings, periodDurationMinutes: 50, collegeStartTime: "09:00", lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [] },
    collegeName: "Test College", sectionName: "A",
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.getWorksheet("Timetable")!;
}

const textOf = (v: ExcelJS.CellValue): string =>
  typeof v === "object" && v && "richText" in v ? v.richText.map((r) => r.text).join("") : String(v ?? "");

describe("timetable Excel export", () => {
  it("merges a lab block flagged to continue into the next periods into one wide cell", async () => {
    const sheet = await build([
      slot({ day: "TUE", periodNumber: 3, subjectId: "lab", subjectName: "CN Lab", assignmentId: "lab1", mergeWithNext: true }),
      slot({ day: "TUE", periodNumber: 4, subjectId: "lab", subjectName: "CN Lab", assignmentId: "lab1" }),
    ]);
    // Day is column 1, Period 3 is column 4: the block fills columns 4-5 of the Tuesday row.
    const tuesday = (() => { let found = 0; sheet.eachRow((row, n) => { if (row.getCell(1).value === "Tuesday") found = n; }); return found; })();
    expect(tuesday).toBeGreaterThan(0);
    expect(sheet.getCell(tuesday, 4).isMerged).toBe(true);
    expect(sheet.getCell(tuesday, 5).isMerged).toBe(true);
    expect(sheet.getCell(tuesday, 4).address).toBe(sheet.getCell(tuesday, 5).master.address);
  });

  it("does not merge two periods that are not flagged to continue", async () => {
    const sheet = await build([
      slot({ day: "MON", periodNumber: 1 }),
      slot({ day: "MON", periodNumber: 2 }),
    ]);
    let monday = 0;
    sheet.eachRow((row, n) => { if (row.getCell(1).value === "Monday") monday = n; });
    expect(sheet.getCell(monday, 2).isMerged).toBe(false);
  });

  it("separates two different labs in the same period with a divider", async () => {
    const sheet = await build([
      slot({ day: "MON", periodNumber: 1, subjectId: "l1", subjectName: "Physics Lab", assignmentId: "x1", labBatch: "Batch 1" }),
      slot({ day: "MON", periodNumber: 1, subjectId: "l2", subjectName: "Chem Lab", assignmentId: "x2", labBatch: "Batch 2" }),
    ]);
    let monday = 0;
    sheet.eachRow((row, n) => { if (row.getCell(1).value === "Monday") monday = n; });
    const text = textOf(sheet.getCell(monday, 2).value);
    expect(text).toContain("- - - -");
    expect(text).toContain("Batch 1");
    expect(text).toContain("Batch 2");
    expect(text.indexOf("Batch 1")).toBeLessThan(text.indexOf("- - - -"));
    expect(text.indexOf("- - - -")).toBeLessThan(text.indexOf("Batch 2"));
  });
});
