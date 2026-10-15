import { describe, it, expect } from "vitest";
import {
  batchStartYear,
  classLabel,
  currentSemesterOf,
  daysInMonth,
  monthPickerYears,
  resolveReportRange,
  semesterOptionsForStudent,
  type SemesterRange,
} from "./studentReportRange";

const sem = (semester: number, startDate: string, endDate: string): SemesterRange => ({ semester, startDate, endDate });

describe("resolveReportRange", () => {
  it("till now is unbounded", () => {
    expect(resolveReportRange("tillnow", {}, [])).toEqual({ ok: true, from: null, to: null, label: "Till now" });
  });

  it("month spans the real first..last day", () => {
    expect(resolveReportRange("month", { year: "2026", month: "10" }, [])).toEqual({
      ok: true, from: "2026-10-01", to: "2026-10-31", label: "October 2026",
    });
    expect(resolveReportRange("month", { year: "2026", month: "9" }, [])).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("handles February and leap years", () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(resolveReportRange("month", { year: "2028", month: "2" }, [])).toMatchObject({ to: "2028-02-29" });
  });

  it("rejects a bad month or year", () => {
    expect(resolveReportRange("month", { year: "2026", month: "13" }, []).ok).toBe(false);
    expect(resolveReportRange("month", { year: "2026", month: "0" }, []).ok).toBe(false);
    expect(resolveReportRange("month", { year: "abc", month: "3" }, []).ok).toBe(false);
    expect(resolveReportRange("month", {}, []).ok).toBe(false);
  });

  it("period is inclusive and labelled dd-mm-yyyy", () => {
    expect(resolveReportRange("period", { from: "2026-10-01", to: "2026-10-01" }, [])).toEqual({
      ok: true, from: "2026-10-01", to: "2026-10-01", label: "01-10-2026 to 01-10-2026",
    });
  });

  it("period rejects reversed, missing and impossible dates", () => {
    expect(resolveReportRange("period", { from: "2026-10-05", to: "2026-10-01" }, []).ok).toBe(false);
    expect(resolveReportRange("period", { from: "2026-10-05" }, []).ok).toBe(false);
    expect(resolveReportRange("period", { from: "2026-02-30", to: "2026-03-05" }, []).ok).toBe(false);
    expect(resolveReportRange("period", { from: "05-10-2026", to: "2026-10-09" }, []).ok).toBe(false);
  });

  it("semester uses its configured dates and refuses an unknown one", () => {
    const sems = [sem(5, "2025-06-16", "2025-11-15"), sem(6, "2025-12-01", "2026-04-30")];
    expect(resolveReportRange("semester", { semester: "6" }, sems)).toEqual({
      ok: true, from: "2025-12-01", to: "2026-04-30", label: "Semester 6",
    });
    expect(resolveReportRange("semester", { semester: "7" }, sems).ok).toBe(false);
    expect(resolveReportRange("semester", {}, sems).ok).toBe(false);
  });
});

describe("semesterOptionsForStudent", () => {
  const y1 = { year: 1, semesters: [sem(1, "2023-08-01", "2023-12-15"), sem(2, "2024-01-05", "2024-05-30")] };
  const y2 = { year: 2, semesters: [sem(3, "2024-07-01", "2024-11-30"), sem(4, "2024-12-15", "2025-04-30")] };
  const y3 = { year: 3, semesters: [sem(5, "2025-07-01", "2025-11-30"), sem(6, "2025-12-15", "2026-04-30")] };

  it("lists semesters of years 1..current that have started", () => {
    expect(semesterOptionsForStudent([y1, y2, y3], 3, "2026-01-10").map((s) => s.semester)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(semesterOptionsForStudent([y1, y2, y3], 3, "2025-08-01").map((s) => s.semester)).toEqual([1, 2, 3, 4, 5]);
  });

  it("never offers a year the student hasn't reached", () => {
    expect(semesterOptionsForStudent([y1, y2, y3], 2, "2030-01-01").map((s) => s.semester)).toEqual([1, 2, 3, 4]);
  });

  it("a lateral entrant without Year 1 timing simply has fewer options", () => {
    expect(semesterOptionsForStudent([y2, y3], 3, "2026-01-10").map((s) => s.semester)).toEqual([3, 4, 5, 6]);
  });

  it("de-duplicates a semester configured on two years and handles no timing at all", () => {
    const dup = { year: 2, semesters: [sem(2, "2024-01-05", "2024-05-30")] };
    expect(semesterOptionsForStudent([y1, dup], 2, "2026-01-01").filter((s) => s.semester === 2)).toHaveLength(1);
    expect(semesterOptionsForStudent([], 2, "2026-01-01")).toEqual([]);
  });

  // Regression: a course-year timing can be set up per year independently
  // (course-year-timings/route.ts only enforces uniqueness WITHIN one year's
  // own doc, never across sibling years of the same course), so nothing stops
  // Year 1 and Year 3 both using semester numbers 1 and 2 instead of
  // continuing 1-2 / 5-6 globally. When that happens, the student's actual
  // CURRENT (later) year must win the collision - not the earliest year
  // processed - otherwise a 3rd-year student's "till now" report resolves to
  // Year 1's long-past semester and prints "I/IV Semester-I" instead of
  // "III/IV Semester-I".
  it("a semester number reused on a LATER year wins the collision, not the earliest year", () => {
    const year1Misnumbered = { year: 1, semesters: [sem(1, "2023-08-01", "2023-12-15"), sem(2, "2024-01-05", "2024-05-30")] };
    const year3Misnumbered = { year: 3, semesters: [sem(1, "2025-07-01", "2025-11-30"), sem(2, "2025-12-15", "2026-04-30")] };
    const opts = semesterOptionsForStudent([year1Misnumbered, year3Misnumbered], 3, "2025-09-01");
    // Only one entry per colliding number - but it must be Year 3's (the
    // student's real current year), not Year 1's stale 2023 dates.
    expect(opts).toHaveLength(2);
    expect(opts.find((s) => s.semester === 1)).toMatchObject({ year: 3, startDate: "2025-07-01" });
    const current = currentSemesterOf(opts, "2025-09-01");
    expect(classLabel(3, 4, current)).toBe("III/IV Semester-I");
  });
});

describe("month picker years", () => {
  it("runs from the admission year to now, newest first", () => {
    expect(batchStartYear("2024-2028")).toBe(2024);
    expect(batchStartYear(undefined)).toBeNull();
    expect(monthPickerYears("2024-2028", 2026)).toEqual([2026, 2025, 2024]);
  });
  it("falls back to three years back when the batch is unusable or in the future", () => {
    expect(monthPickerYears(undefined, 2026)).toEqual([2026, 2025, 2024, 2023]);
    expect(monthPickerYears("2030-2034", 2026)).toEqual([2026, 2025, 2024, 2023]);
  });
});

describe("semester position and class label", () => {
  const y2 = { year: 2, semesters: [sem(3, "2024-07-01", "2024-11-30"), sem(4, "2024-12-15", "2025-04-30")] };
  const y3 = { year: 3, semesters: [sem(5, "2025-07-01", "2025-11-30"), sem(6, "2025-12-15", "2026-04-30")] };
  const opts = semesterOptionsForStudent([y2, y3], 3, "2026-01-10");

  it("tags each semester with its year and its position within that year", () => {
    expect(opts.map((s) => [s.semester, s.year, s.inYear])).toEqual([[3, 2, 1], [4, 2, 2], [5, 3, 1], [6, 3, 2]]);
  });

  it("current semester is the one containing today, else the latest started", () => {
    expect(currentSemesterOf(opts, "2026-01-10")?.semester).toBe(6);
    expect(currentSemesterOf(semesterOptionsForStudent([y2, y3], 3, "2025-12-05"), "2025-12-05")?.semester).toBe(5); // gap after 5 ended, 6 not started
    expect(currentSemesterOf([], "2026-01-10")).toBeNull();
  });

  it("prints Roman year / duration and the semester within the year", () => {
    expect(classLabel(3, 4, opts.find((s) => s.semester === 5)!)).toBe("III/IV Semester-I");
    expect(classLabel(3, 4, opts.find((s) => s.semester === 6)!)).toBe("III/IV Semester-II");
    // a past semester is labelled with its own year, not the student's current one
    expect(classLabel(3, 4, opts.find((s) => s.semester === 3)!)).toBe("II/IV Semester-I");
  });

  it("falls back to the year when no semester is known", () => {
    expect(classLabel(2, 4, null)).toBe("II/IV Year");
    expect(classLabel(2, null, null)).toBe("II Year");
    expect(classLabel(0, 4, null)).toBe("");
  });
});
