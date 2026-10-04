import { describe, expect, it } from "vitest";
import { cellsOverlap, describeCell, findOverlap, formatInterval, periodInterval, timingLookupFrom, type TimedCell } from "./facultyOverlap";
import type { CourseYearTiming } from "@/types";

const timing = (courseId: string, year: number, periods: [number, string, string][]): CourseYearTiming =>
  ({
    id: `${courseId}_year${year}`, courseId, year, collegeStartTime: "09:00", collegeEndTime: "16:00",
    numberOfPeriods: periods.length, periodDurationMinutes: 50, lunchBreak: { afterPeriod: 0, durationMinutes: 0 }, shortBreaks: [],
    periods: periods.map(([period, startTime, endTime]) => ({ period, startTime, endTime })),
  }) as unknown as CourseYearTiming;

// Year 1 and Year 2 run on offset clocks, as the old code comments describe.
const Y1 = timing("c1", 1, [[1, "09:00", "09:50"], [2, "09:50", "10:40"], [3, "10:40", "11:30"], [4, "11:30", "12:20"]]);
const Y2 = timing("c1", 2, [[1, "09:30", "10:20"], [2, "10:20", "11:10"], [3, "11:10", "12:00"], [4, "12:00", "12:50"]]);
const Y3 = timing("c1", 3, [[1, "14:00", "14:50"], [2, "14:50", "15:40"]]);
const lookup = timingLookupFrom([Y1, Y2, Y3]);
const cell = (year: number, periodNumber: number, day = "MON", courseId = "c1"): TimedCell => ({ day, periodNumber, courseId, year });

describe("periodInterval", () => {
  it("reads the HOD's period breakdown", () => {
    expect(periodInterval(Y1, 3)).toEqual({ start: 640, end: 690 });
    expect(formatInterval(periodInterval(Y1, 3)!)).toBe("10:40-11:30");
  });

  it("falls back to the numberOfPeriods/duration formula when no breakdown was saved", () => {
    const formula = { ...Y1, periods: undefined, collegeStartTime: "09:00", numberOfPeriods: 4, periodDurationMinutes: 45 } as CourseYearTiming;
    expect(periodInterval(formula, 2)).toEqual({ start: 9 * 60 + 45, end: 10 * 60 + 30 });
  });

  it("is null for a missing timing, a period that does not exist, or a malformed time", () => {
    expect(periodInterval(null, 1)).toBeNull();
    expect(periodInterval(Y1, 9)).toBeNull();
    expect(periodInterval(timing("c", 1, [[1, "9am", "10am"]]), 1)).toBeNull();
  });
});

describe("cellsOverlap - one rule on clock intervals", () => {
  it("same course-year, same period: overlap", () => {
    expect(cellsOverlap(cell(1, 2), cell(1, 2), lookup)).toBe(true);
  });

  it("same period NUMBER in two years whose clocks differ but intersect: overlap (what publish used to be the only one to say)", () => {
    // Y1 P3 10:40-11:30 vs Y2 P3 11:10-12:00
    expect(cellsOverlap(cell(1, 3), cell(2, 3), lookup)).toBe(true);
  });

  it("DIFFERENT period numbers whose clocks intersect: overlap (what nobody used to catch)", () => {
    // Y1 P3 10:40-11:30 vs Y2 P2 10:20-11:10
    expect(cellsOverlap(cell(1, 3), cell(2, 2), lookup)).toBe(true);
  });

  it("same period number but disjoint clocks: no overlap (publish used to refuse this)", () => {
    // Y1 P1 09:00-09:50 vs Y3 P1 14:00-14:50
    expect(cellsOverlap(cell(1, 1), cell(3, 1), lookup)).toBe(false);
  });

  it("touching end to start is not a clash", () => {
    // Y1 P2 ends 10:40, Y1 P3 starts 10:40
    expect(cellsOverlap(cell(1, 2), cell(1, 3), lookup)).toBe(false);
    // Y2 P2 ends 11:10, Y2 P3 starts 11:10
    expect(cellsOverlap(cell(2, 2), cell(2, 3), lookup)).toBe(false);
  });

  it("is symmetric", () => {
    for (const [a, b] of [[cell(1, 3), cell(2, 2)], [cell(1, 1), cell(3, 1)], [cell(1, 4), cell(2, 3)]]) {
      expect(cellsOverlap(a, b, lookup)).toBe(cellsOverlap(b, a, lookup));
    }
  });

  it("different days never overlap", () => {
    expect(cellsOverlap(cell(1, 1, "MON"), cell(1, 1, "TUE"), lookup)).toBe(false);
  });

  it("falls back to the period number when a timing cannot be resolved (conservative)", () => {
    expect(cellsOverlap(cell(1, 2), cell(9, 2, "MON", "unknown"), lookup)).toBe(true);
    expect(cellsOverlap(cell(1, 2), cell(9, 3, "MON", "unknown"), lookup)).toBe(false);
  });

  it("two different courses with the same year use their own timings", () => {
    const other = timing("c2", 1, [[1, "13:00", "13:50"]]);
    const both = timingLookupFrom([Y1, other]);
    expect(cellsOverlap(cell(1, 1, "MON", "c1"), cell(1, 1, "MON", "c2"), both)).toBe(false);
  });
});

describe("findOverlap / describeCell", () => {
  it("returns the first clashing placement", () => {
    const others = [{ ...cell(3, 1), id: "a" }, { ...cell(2, 2), id: "b" }, { ...cell(1, 3), id: "c" }];
    expect(findOverlap(cell(1, 3), others, lookup)?.id).toBe("b");
    expect(findOverlap(cell(1, 1), [{ ...cell(3, 1), id: "a" }], lookup)).toBeNull();
  });

  it("describes a cell by its clock time, or its period number when unresolvable", () => {
    expect(describeCell(cell(1, 3), lookup)).toBe("MON 10:40-11:30");
    expect(describeCell(cell(9, 4, "TUE", "unknown"), lookup)).toBe("TUE period 4");
  });
});
