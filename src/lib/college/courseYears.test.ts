import { describe, expect, it } from "vitest";
import {
  courseYearNumbers, firstSemesterOfYear, ordinalYearLabel, selectableYears, semesterLabel, semesterPlan, semestersInYear, yearOfSemester,
  FALLBACK_SEMESTERS_PER_YEAR, MAX_COURSE_DURATION_YEARS,
} from "@/lib/college/courseYears";
import { yearSemesterLabel } from "@/lib/academic/format";

// Finding 8: years/semesters come from the course's own data, not [1,2,3,4] / "x2".

describe("courseYearNumbers", () => {
  it("is 1..duration for any real length, not 1..4", () => {
    expect(courseYearNumbers(2)).toEqual([1, 2]);
    expect(courseYearNumbers(4)).toEqual([1, 2, 3, 4]);
    expect(courseYearNumbers(5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("has no years for a missing/invalid length - never an invented 4", () => {
    for (const bad of [undefined, null, 0, -1, 2.5, Number.NaN]) expect(courseYearNumbers(bad as never)).toEqual([]);
  });
});

describe("selectableYears", () => {
  it("configured years capped at the longest course", () => expect(selectableYears([1, 2, 3, 4, 5, 6], [{ durationYears: 4 }, { durationYears: 2 }])).toEqual([1, 2, 3, 4]));
  it("nothing usable configured -> the longest course's own years (a 5-year course gets 5, a 2-year gets 2)", () => {
    expect(selectableYears([], [{ durationYears: 5 }])).toEqual([1, 2, 3, 4, 5]);
    expect(selectableYears([], [{ durationYears: 2 }])).toEqual([1, 2]);
    expect(selectableYears([9], [{ durationYears: 3 }])).toEqual([1, 2, 3]);
  });
  it("no courses at all -> no years (was an invented 1-4)", () => expect(selectableYears([], [])).toEqual([]));
});

describe("semesterPlan", () => {
  const t = (year: number, ...semesters: number[]) => ({ year, semesters: semesters.map((semester) => ({ semester })) });

  it("uses the course's OWN timings: 3 semesters in year 1, 2 after", () => {
    const plan = semesterPlan(4, [t(1, 1, 2, 3), t(2, 4, 5), t(3, 6, 7), t(4, 8, 9)]);
    expect(plan.source).toBe("timings");
    expect(plan.semesters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.yearOf(3)).toBe(1);
    expect(plan.yearOf(4)).toBe(2);
    expect(plan.yearOf(9)).toBe(4);
    expect(plan.yearOf(10)).toBeUndefined();
  });
  it("no timings -> the labelled fallback: durationYears x 2, ceil(sem/2) - exactly what the pages hard-coded", () => {
    const plan = semesterPlan(4);
    expect(plan.source).toBe("fallback");
    expect(plan.semesters).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan.yearOf(3)).toBe(2);
    expect(plan.yearOf(8)).toBe(4);
    expect(plan.yearOf(9)).toBeUndefined();
    expect(FALLBACK_SEMESTERS_PER_YEAR).toBe(2);
  });
  it("timings that restart numbering every year (1,2 in each year) can't be flattened -> fallback, never a wrong guess", () => {
    expect(semesterPlan(2, [t(1, 1, 2), t(2, 1, 2)]).source).toBe("fallback");
  });
  it("timings with no semesters defined -> fallback", () => expect(semesterPlan(3, [{ year: 1 }, { year: 2, semesters: [] }]).semesters).toEqual([1, 2, 3, 4, 5, 6]));
  it("a missing duration and no timings is an empty plan", () => expect(semesterPlan(undefined).semesters).toEqual([]));
});

describe("semester helpers", () => {
  const timed = semesterPlan(2, [
    { year: 1, semesters: [{ semester: 1 }, { semester: 2 }, { semester: 3 }] },
    { year: 2, semesters: [{ semester: 4 }, { semester: 5 }, { semester: 6 }] },
  ]);
  const fallback = semesterPlan(4);

  it("semestersInYear / yearOfSemester follow the plan", () => {
    expect(semestersInYear(timed, 1)).toEqual([1, 2, 3]);
    expect(semestersInYear(timed, 2)).toEqual([4, 5, 6]);
    expect(yearOfSemester(timed, 5)).toBe(2);
  });
  it("...and fall back to two per year when the plan doesn't know the year", () => {
    expect(semestersInYear(semesterPlan(undefined), 3)).toEqual([5, 6]);
    expect(yearOfSemester(semesterPlan(undefined), 5)).toBe(3);
  });
  it("semesterLabel reads '<year>-<position in that year>' from the plan", () => {
    expect(semesterLabel(timed, 3)).toBe("1-3");
    expect(semesterLabel(timed, 4)).toBe("2-1");
    expect(semesterLabel(timed, 6)).toBe("2-3");
  });
  it("semesterLabel matches the existing yearSemesterLabel for the default two-per-year course (no behaviour change)", () => {
    for (let s = 1; s <= 8; s++) expect(semesterLabel(fallback, s)).toBe(yearSemesterLabel(s));
    expect(semesterLabel(fallback, 0)).toBe("");
  });
  it("firstSemesterOfYear: one past the earlier years' highest semester; fallback when they have none", () => {
    expect(firstSemesterOfYear(1)).toBe(1);
    expect(firstSemesterOfYear(2, [{ year: 1, semesters: [{ semester: 1 }, { semester: 2 }, { semester: 3 }] }])).toBe(4);
    expect(firstSemesterOfYear(3, [{ year: 1, semesters: [{ semester: 1 }, { semester: 2 }] }, { year: 2, semesters: [{ semester: 3 }, { semester: 4 }] }])).toBe(5);
    expect(firstSemesterOfYear(3)).toBe(5); // no earlier timings: 2 x 2 + 1
    expect(firstSemesterOfYear(2, [{ year: 2, semesters: [{ semester: 9 }] }])).toBe(3); // only EARLIER years count
  });
});

describe("misc", () => {
  it("ordinalYearLabel", () => {
    expect([1, 2, 3, 4, 5, 11, 12, 13, 21].map(ordinalYearLabel)).toEqual(["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "11th Year", "12th Year", "13th Year", "21st Year"]);
    expect(ordinalYearLabel("x")).toBe("Year x");
  });
  it("the safety ceiling matches the catalog's own bound", () => expect(MAX_COURSE_DURATION_YEARS).toBe(10));
});
