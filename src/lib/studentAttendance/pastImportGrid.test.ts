import { describe, expect, it } from "vitest";
import { parseDateHeader, parsePastAttendanceGrid } from "./pastImportGrid";

describe("parseDateHeader", () => {
  it("reads ISO, day-first numeric and day-month names", () => {
    expect(parseDateHeader("2026-08-11", 2026)).toBe("2026-08-11");
    expect(parseDateHeader("11/08/2026", 2026)).toBe("2026-08-11");
    expect(parseDateHeader("11-Aug", 2026)).toBe("2026-08-11");
    expect(parseDateHeader("12 August 26", 2000)).toBe("2026-08-12");
    expect(parseDateHeader("1-9-26", 2000)).toBe("2026-09-01");
  });
  it("rejects impossible dates and other text", () => {
    expect(parseDateHeader("31-Feb-2026", 2026)).toBeNull();
    expect(parseDateHeader("Remarks", 2026)).toBeNull();
    expect(parseDateHeader("2", 2026)).toBeNull(); // a bare day is only meaningful after a full date
  });
});

describe("parsePastAttendanceGrid", () => {
  const rows = [
    ["Regd. No", "Name", "11-Aug", "12-Aug", "13-Aug"],
    ["22a91a0501", "X", "P", "A", ""],
    ["22A91A0502", "Y", "present", "-", "A"],
  ];
  it("maps marks per date and treats blanks as no record", () => {
    const g = parsePastAttendanceGrid(rows, 2026);
    expect(g.errors).toEqual([]);
    expect(g.dates).toEqual(["2026-08-11", "2026-08-12", "2026-08-13"]);
    expect(g.students[0]).toEqual({ roll: "22A91A0501", marks: ["PRESENT", "ABSENT", null] });
    expect(g.students[1].marks).toEqual(["PRESENT", null, "ABSENT"]);
  });
  it("reports bad marks, repeated rolls and repeated dates", () => {
    const g = parsePastAttendanceGrid(
      [["Regd. No", "11-Aug", "11/08/2026"], ["R12345", "X", "P"], ["R12345", "P", "P"]], 2026);
    expect(g.errors.some((e) => e.includes('"X"'))).toBe(true);
    expect(g.errors.some((e) => e.includes("two columns"))).toBe(true);
    expect(g.errors.some((e) => e.includes("R12345 appears twice"))).toBe(true);
  });
});

// The college's paper register: title rows, S.No / Regd.No / Name, full dates first then bare day numbers with the
// month implied by position (crossing September into October), CC / AC / % columns, and a REGISTRAR footer.
describe("parsePastAttendanceGrid - the college register layout", () => {
  const register = [
    ["VISHNU WOMEN'S UNIVERSITY"],
    ["I B.TECH. REGD.NO'S :: 2026-27"],
    ["CSE SECTION A", "", "", "", "", "", "", "", "", "", "", "", "", "Total Class", "", "% of Attendance"],
    ["S.No.", "Regd.No.", "Name of the Student", "29-8-2026", "31-8-2026", "1-9-26", "2", "3", "29", "30-9-26", "1", "3", "CC", "AC", "% of Attendance"],
    ["1", "26BV1A05001", "STUDENT ONE", "p", "p", "A", "p", "", "p", "p", "P", "a", "9", "6", "66.6"],
    ["2", "26BV1A05002", "STUDENT TWO", "p", "p", "p", "p", "p", "p", "p", "p", "p", "9", "8", "88.8"],
    ["", "REGISTRAR"],
    ["", "15.10.2026"],
  ];
  const g = parsePastAttendanceGrid(register, 2026);

  it("rebuilds every date from the full dates and the day numbers after them", () => {
    expect(g.errors).toEqual([]);
    expect(g.dates).toEqual([
      "2026-08-29", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03",
    ]);
  });
  it("matches p / P / a case-insensitively, keeps blanks as no record, and ignores the summary columns and footer", () => {
    expect(g.students.map((s) => s.roll)).toEqual(["26BV1A05001", "26BV1A05002"]);
    expect(g.students[0].marks).toEqual(["PRESENT", "PRESENT", "ABSENT", "PRESENT", null, "PRESENT", "PRESENT", "PRESENT", "ABSENT"]);
  });
  it("warns, without stopping, where the register's own AC total disagrees with its P marks", () => {
    expect(g.warnings).toEqual(["26BV1A05002: the register total (AC) is 8 but the sheet has 9 P marks."]);
  });
  it("needs a full date before the first bare day number", () => {
    const bad = parsePastAttendanceGrid([["Regd.No.", "2", "3"], ["26BV1A05001", "p", "p"]], 2026);
    expect(bad.errors[0]).toContain("no full date before it");
  });
});
