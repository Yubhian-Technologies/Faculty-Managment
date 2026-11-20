import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { indexSessions } from "./counting";
import { buildDayRegister, dayCellText, daysInRange, registerTotals, studentPeriodMarks } from "./dayRegister";
import {
  buildDetailedWorkbook, buildRegisterWorkbook, buildShortageWorkbook, buildSubjectWorkbook, classesNeeded, detailedFlatTable,
  detailedPrintHtml, registerPrintHtml, sheetName, shortageList, shortagePrintHtml, subjectStats,
  type ExportMeta, type ExportSection,
} from "./sectionReportExport";

type Excel = typeof import("exceljs");
const X = ExcelJS as unknown as Excel;

const meta: ExportMeta = {
  college: { name: "Test College", address: "Bhimavaram", phone: "123", logoUrl: "" },
  course: "B.Tech", department: "CSE", semester: "III-I", period: "Till now", filters: [],
  generatedBy: "Office", generatedAt: new Date("2026-11-19T10:00:00Z"), threshold: 75,
};

const t = (attended: number, held: number) => ({ held, attended, percentage: held ? (attended * 100) / held : null });
const section: ExportSection = {
  name: "A",
  subjects: [
    { subjectId: "s1", subjectName: "Data Structures", subjectCode: "DS" },
    { subjectId: "s2", subjectName: "Mathematics", subjectCode: "" },
  ],
  rows: [
    { studentId: "a", rollNumber: "R1", name: "Anu", absentDays: 0, bySubject: { s1: t(10, 10), s2: t(9, 10) }, shown: t(19, 20) },
    { studentId: "b", rollNumber: "R2", name: "Bala", absentDays: 2, bySubject: { s1: t(5, 10), s2: t(8, 10) }, shown: t(13, 20) },
  ],
};

describe("classes needed to reach the shortage line", () => {
  it("is the smallest n with (a+n)/(h+n) >= threshold", () => {
    expect(classesNeeded(13, 20, 75)).toBe(8); // (13+8)/(28) = 75%
    expect((13 + 7) / (20 + 7)).toBeLessThan(0.75);
    expect(classesNeeded(19, 20, 75)).toBe(0);
    expect(classesNeeded(15, 20, 75)).toBe(0); // exactly 75%
    expect(classesNeeded(0, 0, 75)).toBe(0);
    expect(classesNeeded(9, 10, 100)).toBeNull();
  });
});

describe("section figures", () => {
  it("per-subject held, average and how many are below", () => {
    const s = subjectStats(section, 75);
    expect(s.s1).toEqual({ held: 10, average: 75, below: 1 });
    expect(s.s2.below).toBe(0);
  });

  it("the shortage list names the subjects a student is short in", () => {
    const list = shortageList([section], 75);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ rollNumber: "R2", held: 20, attended: 13, needed: 8, shortSubjects: "DS (50.00)" });
  });

  it("the flat table (CSV) has every column, a subject without a code uses its name", () => {
    const { headers, rows } = detailedFlatTable(section, 75, false);
    expect(headers).toContain("Mathematics %");
    expect(headers.slice(-3)).toEqual(["Absent Periods", "Days Absent", "Classes to Reach 75%"]);
    expect(rows[1].slice(-6)).toEqual([20, 13, "65.00", 7, 2, 8]);
  });

  it("sheet names are legal and unique", () => {
    const used = new Set<string>();
    expect(sheetName("CSE/A: [x]", used)).toBe("CSE A   x");
    expect(sheetName("A", used)).toBe("A");
    expect(sheetName("a", used)).toBe("a 2");
    expect(sheetName("x".repeat(40), used)).toHaveLength(31);
  });
});

describe("workbooks and print pages", () => {
  it("detailed workbook: a sheet per section plus All Sections, shortage in red", async () => {
    const wb = buildDetailedWorkbook(X, meta, [section, { ...section, name: "B" }], false);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["A", "B", "All Sections"]);
    const ws = wb.getWorksheet("A")!;
    let balaRow = 0;
    ws.eachRow((row, n) => { if (row.getCell(2).value === "R2") balaRow = n; });
    expect(balaRow).toBeGreaterThan(0);
    const row = ws.getRow(balaRow);
    // S.No, Regd. No, Name, DS (H, A, %), Maths (H, A, %), Total (H, A, %), Absent Periods, Days Absent, To 75%
    expect([row.getCell(4).value, row.getCell(5).value, row.getCell(6).value]).toEqual([10, 5, 50]);
    expect((row.getCell(6).font as { bold?: boolean })?.bold).toBe(true);
    expect([row.getCell(13).value, row.getCell(14).value, row.getCell(15).value]).toEqual([7, 2, 8]);
    expect((await wb.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("shortage and subject workbooks", () => {
    expect(buildShortageWorkbook(X, meta, [section]).getWorksheet("Shortage List")!.rowCount).toBeGreaterThan(5);
    expect(buildSubjectWorkbook(X, meta, [section]).worksheets.map((w) => w.name)).toEqual(["DS", "Mathematics"]);
  });

  it("print pages carry the letterhead, the class block and the signature line", () => {
    const html = detailedPrintHtml(meta, [section], false, "https://x/logo.png");
    expect(html).toContain("TEST COLLEGE");
    expect(html).toContain("Class In-charge");
    expect(html).toContain("size:A4 landscape");
    expect(html).toContain('class="low">50.00');
    expect(shortagePrintHtml(meta, [section], "")).toContain("R2");
    expect(shortagePrintHtml(meta, [{ ...section, rows: [section.rows[0]] }], "")).toContain("No student is below 75%");
  });
});

describe("date-wise register", () => {
  const sessions = indexSessions([
    { subjectId: "s1", subjectName: "DS", subjectCode: "DS", date: "2026-11-02", periodNumber: 2, entries: [{ studentId: "a", status: "PRESENT" }, { studentId: "b", status: "ABSENT" }] },
    { subjectId: "s2", subjectName: "M", subjectCode: "M", date: "2026-11-02", periodNumber: 1, entries: [{ studentId: "a", status: "ABSENT" }, { studentId: "b", status: "ABSENT" }] },
    { subjectId: "s1", subjectName: "DS", subjectCode: "DS", date: "2026-11-03", periodNumber: 1, entries: [{ studentId: "a", status: "ON_DUTY" }, { studentId: "b", status: "PRESENT" }] },
    // Before b joined: never counted for them.
    { subjectId: "s1", subjectName: "DS", subjectCode: "DS", date: "2026-10-30", periodNumber: 1, entries: [{ studentId: "b", status: "ABSENT" }] },
  ]);

  it("cells: present/held, A for a whole day absent, OD for only on duty; joining date respected", () => {
    const a = buildDayRegister(sessions, "a");
    const b = buildDayRegister(sessions, "b", "2026-11-01");
    expect(dayCellText(a["2026-11-02"])).toBe("1/2");
    expect(dayCellText(a["2026-11-03"])).toBe("OD");
    expect(dayCellText(b["2026-11-02"])).toBe("A");
    expect(b["2026-10-30"]).toBeUndefined();
    expect(registerTotals(b)).toEqual({ held: 3, present: 1, onDuty: 0, absentDays: 1 });
    expect(dayCellText(undefined)).toBe("");
  });

  it("one student's periods, oldest first, by period number", () => {
    expect(studentPeriodMarks(sessions, "a").map((p) => `${p.date} P${p.periodNumber} ${p.mark}`)).toEqual([
      "2026-11-02 P1 ABSENT", "2026-11-02 P2 PRESENT", "2026-11-03 P1 ON_DUTY",
    ]);
  });

  it("range length and the workbook / print page", () => {
    expect(daysInRange("2026-11-01", "2026-11-30")).toBe(30);
    expect(daysInRange("2026-11-01", "2026-11-01")).toBe(1);
    const reg = [{ name: "A", dates: ["2026-11-02", "2026-11-03"], students: [{ studentId: "b", rollNumber: "R2", name: "Bala", days: buildDayRegister(sessions, "b", "2026-11-01") }] }];
    const ws = buildRegisterWorkbook(X, meta, reg).getWorksheet("A")!;
    let found = 0;
    ws.eachRow((row) => { if (row.getCell(2).value === "R2") { found += 1; expect([row.getCell(4).value, row.getCell(5).value, row.getCell(6).value]).toEqual(["A", "1/1", 3]); } });
    expect(found).toBe(1);
    expect(registerPrintHtml(meta, reg, "")).toContain("02-11");
  });
});

describe("subject column heading", () => {
  it("uses the Subject Acronym, else the code, else the name", async () => {
    const { subjectLabel } = await import("./sectionReportExport");
    expect(subjectLabel({ subjectId: "a", subjectName: "Engineering Chemistry", subjectCode: "UG26BS1T04", shortCode: "EC" })).toBe("EC");
    expect(subjectLabel({ subjectId: "a", subjectName: "Engineering Chemistry", subjectCode: "UG26BS1T04" })).toBe("UG26BS1T04");
    expect(subjectLabel({ subjectId: "a", subjectName: "Library", subjectCode: "" })).toBe("Library");
  });
});
