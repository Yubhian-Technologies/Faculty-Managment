import { describe, expect, it } from "vitest";
import { computeSemesterOptions, resolveYearsForSemesterChoice } from "./semester";
import type { CourseYearTiming } from "@/types";

// Only `semester` matters to either function under test - startDate/endDate
// only matter to resolveCurrentSemester's own date-range logic, which these
// two functions never call.
function timing(year: number, semesters: number[]): Pick<CourseYearTiming, "year" | "semesters"> {
  return {
    year,
    semesters: semesters.map((semester) => ({ semester })) as unknown as CourseYearTiming["semesters"],
  };
}

describe("computeSemesterOptions", () => {
  it("collects distinct semester numbers across years, plus one Full Year entry per unconfigured year", () => {
    const timingByYear = new Map([
      [1, timing(1, [1, 2])],
      [2, timing(2, [3, 4])],
      [3, undefined], // never had a CourseYearTiming doc at all
    ]);
    const options = computeSemesterOptions([1, 2, 3], timingByYear);
    expect(options).toEqual([
      { kind: "semester", value: 1 },
      { kind: "semester", value: 2 },
      { kind: "semester", value: 3 },
      { kind: "semester", value: 4 },
      { kind: "fullYear", year: 3 },
    ]);
  });

  it("gives a year with an empty semesters array its own Full Year entry, not silently dropped", () => {
    const timingByYear = new Map([[1, timing(1, [])]]);
    expect(computeSemesterOptions([1], timingByYear)).toEqual([{ kind: "fullYear", year: 1 }]);
  });
});

describe("resolveYearsForSemesterChoice", () => {
  it("resolves a Full Year choice to exactly the one year it was offered for", () => {
    const timingByYear = new Map([[2, timing(2, [])]]);
    expect(resolveYearsForSemesterChoice([1, 2], timingByYear, { kind: "fullYear", year: 2 })).toEqual([2]);
  });

  it("resolves a real semester number to a single year in the ordinary case", () => {
    const timingByYear = new Map([
      [1, timing(1, [1, 2])],
      [2, timing(2, [3, 4])],
    ]);
    expect(resolveYearsForSemesterChoice([1, 2], timingByYear, { kind: "semester", value: 1 })).toEqual([1]);
  });

  // The union branch: two different Years both configure the SAME semester
  // number (e.g. a shared "Semester 5" marking the point two specializations
  // diverge, both still running under one combined semester count). Neither
  // may be dropped in favor of the other - both must resolve, so the caller
  // can union their Sections rather than picking one arbitrarily.
  it("unions every Year that configures the same semester number, rather than picking one", () => {
    const timingByYear = new Map([
      [3, timing(3, [5, 6])],
      [4, timing(4, [5, 6])], // e.g. a lateral-entry Year 4 sharing Year 3's semester numbering
    ]);
    expect(resolveYearsForSemesterChoice([3, 4], timingByYear, { kind: "semester", value: 5 })).toEqual([3, 4]);
  });

  it("excludes a year that has the same course-year timing doc but not that specific semester number", () => {
    const timingByYear = new Map([
      [3, timing(3, [5, 6])],
      [4, timing(4, [7, 8])],
    ]);
    expect(resolveYearsForSemesterChoice([3, 4], timingByYear, { kind: "semester", value: 5 })).toEqual([3]);
  });
});
