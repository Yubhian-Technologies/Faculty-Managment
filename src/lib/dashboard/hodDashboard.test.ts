import { describe, expect, it } from "vitest";
import { classStatus, dailyTrend, mergeCell, passRate, sectionAttendanceToday, yearRoman, type ClassCell } from "./hodDashboard";

const cell = (status: ClassCell["status"], covered = false): ClassCell => ({ status, covered, subject: "DS", faculty: "X", start: "09:00", end: "09:50" });

describe("class status today", () => {
  it("posted wins; otherwise running, overdue after its end, or later", () => {
    expect(classStatus(true, "09:00", "09:50", "08:00")).toBe("POSTED");
    expect(classStatus(false, "09:00", "09:50", "08:59")).toBe("UPCOMING");
    expect(classStatus(false, "09:00", "09:50", "09:00")).toBe("NOW");
    expect(classStatus(false, "09:00", "09:50", "09:50")).toBe("OVERDUE");
  });

  it("two slots in one section + period: the one further along stands, a cover is kept", () => {
    expect(mergeCell(undefined, cell("NOW")).status).toBe("NOW");
    expect(mergeCell(cell("OVERDUE"), cell("POSTED")).status).toBe("POSTED");
    expect(mergeCell(cell("POSTED"), cell("OVERDUE", true))).toMatchObject({ status: "POSTED", covered: true });
  });
});

describe("student attendance today", () => {
  const s = (sectionId: string, marks: [string, string | null][]) => ({ sectionId, date: "2026-11-19", entries: marks.map(([studentId, status]) => ({ studentId, status })) });

  it("per section: present / counted, on duty left out, absent all day", () => {
    const rows = sectionAttendanceToday([
      s("A", [["a", "PRESENT"], ["b", "ABSENT"], ["c", "ON_DUTY"]]),
      s("A", [["a", "PRESENT"], ["b", "ABSENT"], ["c", "PRESENT"]]),
      s("B", [["x", "PRESENT"]]),
    ]);
    const a = rows.find((r) => r.sectionId === "A")!;
    expect(a).toMatchObject({ counted: 5, present: 3, pct: 60, absentAllDay: 1, students: 3 });
    expect(rows.find((r) => r.sectionId === "B")!.pct).toBe(100);
  });

  it("trend: last N class days up to today, oldest first", () => {
    const t = dailyTrend([
      { ...s("A", [["a", "PRESENT"], ["b", "ABSENT"]]), date: "2026-11-17" },
      { ...s("A", [["a", "PRESENT"], ["b", "PRESENT"]]), date: "2026-11-18" },
      { ...s("A", [["a", "ABSENT"]]), date: "2026-11-20" },
      { ...s("A", [["a", "ON_DUTY"]]), date: "2026-11-16" },
    ], 14, "2026-11-19");
    expect(t).toEqual([{ date: "2026-11-17", pct: 50 }, { date: "2026-11-18", pct: 100 }]);
    expect(dailyTrend([{ ...s("A", [["a", "PRESENT"]]), date: "2026-11-01" }, { ...s("A", [["a", "PRESENT"]]), date: "2026-11-02" }], 1, "2026-11-30")).toEqual([{ date: "2026-11-02", pct: 100 }]);
  });
});

describe("results and labels", () => {
  it("pass rate = passed every subject, students without subjects left out", () => {
    expect(passRate([
      { subjects: [{ isPass: true }, { isPass: true }] },
      { subjects: [{ isPass: true }, { isPass: false }] },
      { subjects: [] },
    ])).toEqual({ students: 2, passed: 1, pct: 50 });
    expect(passRate([]).pct).toBeNull();
  });

  it("year in Roman numerals", () => {
    expect(yearRoman(3)).toBe("III");
    expect(yearRoman(9)).toBe("9");
  });
});
