import { describe, expect, it } from "vitest";
import { semesterOptionsFromTimings, semesterOptionsForYear } from "./semesterOptions";
import type { CourseYearTiming } from "@/types";

const timing = (year: number, semesters: number[]): Pick<CourseYearTiming, "year" | "semesters"> =>
  ({ year, semesters: semesters.map((semester) => ({ semester })) }) as Pick<CourseYearTiming, "year" | "semesters">;

describe("semesterOptionsFromTimings", () => {
  // The common shape: every year numbered from 1 within itself.
  it("labels within-year numbering by its own year", () => {
    expect(semesterOptionsFromTimings([timing(1, [1, 2]), timing(2, [1, 2])])).toEqual([
      { semester: 1, year: 1, label: "1-1" },
      { semester: 2, year: 1, label: "1-2" },
      { semester: 1, year: 2, label: "2-1" },
      { semester: 2, year: 2, label: "2-2" },
    ]);
  });

  // The other live convention - the same years, numbered across the course.
  it("labels course-wide numbering identically", () => {
    expect(semesterOptionsFromTimings([timing(3, [5, 6])])).toEqual([
      { semester: 5, year: 3, label: "3-1" },
      { semester: 6, year: 3, label: "3-2" },
    ]);
  });

  it("handles a year split into three", () => {
    expect(semesterOptionsFromTimings([timing(2, [1, 2, 3])]).map((o) => o.label)).toEqual(["2-1", "2-2", "2-3"]);
  });

  it("orders by year then by semester, whatever order they arrive in", () => {
    const out = semesterOptionsFromTimings([timing(2, [2, 1]), timing(1, [2, 1])]);
    expect(out.map((o) => o.label)).toEqual(["1-1", "1-2", "2-1", "2-2"]);
  });

  // A course-year with no semesters yet has no semester concept - it must not
  // contribute a phantom option.
  it("skips a year with no semesters configured", () => {
    expect(semesterOptionsFromTimings([timing(1, []), timing(2, [1, 2])]).map((o) => o.label)).toEqual(["2-1", "2-2"]);
  });

  it("de-duplicates a repeated semester number", () => {
    expect(semesterOptionsFromTimings([timing(2, [1, 1, 2])]).map((o) => o.label)).toEqual(["2-1", "2-2"]);
  });

  it("ignores a timing with no usable year", () => {
    expect(semesterOptionsFromTimings([timing(0, [1, 2]), timing(2, [1])]).map((o) => o.label)).toEqual(["2-1"]);
  });

  it("is empty for no timings at all", () => {
    expect(semesterOptionsFromTimings([])).toEqual([]);
  });
});

describe("semesterOptionsForYear", () => {
  const all = [timing(1, [1, 2]), timing(2, [1, 2]), timing(3, [5, 6])];

  it("narrows to one year without renumbering it", () => {
    expect(semesterOptionsForYear(all, 2)).toEqual([
      { semester: 1, year: 2, label: "2-1" },
      { semester: 2, year: 2, label: "2-2" },
    ]);
  });

  it("accepts the year as a string, as a select gives it", () => {
    expect(semesterOptionsForYear(all, "3").map((o) => o.label)).toEqual(["3-1", "3-2"]);
  });

  it("is empty for a year the course has no timing for", () => {
    expect(semesterOptionsForYear(all, 4)).toEqual([]);
  });
});
