import { describe, expect, it } from "vitest";
import { toRoman, yearSemesterLabel, yearSemesterLabelIn, semesterInYearLabel, formatStudentClass } from "./format";

describe("yearSemesterLabel", () => {
  // The whole point: semesters are STORED running across the course, but
  // spoken as year-within-year. A four-year B.Tech reads 1-1 .. 4-2.
  it("writes a flat semester number as year-semester", () => {
    expect(yearSemesterLabel(1)).toBe("1-1");
    expect(yearSemesterLabel(2)).toBe("1-2");
    expect(yearSemesterLabel(3)).toBe("2-1");
    expect(yearSemesterLabel(4)).toBe("2-2");
    expect(yearSemesterLabel(7)).toBe("4-1");
    expect(yearSemesterLabel(8)).toBe("4-2");
  });

  // A college running three terms a year is a different mapping entirely -
  // semester 4 is 2-1 there, not 2-2.
  it("respects a different number of semesters per year", () => {
    expect(yearSemesterLabel(3, 3)).toBe("1-3");
    expect(yearSemesterLabel(4, 3)).toBe("2-1");
    expect(yearSemesterLabel(6, 3)).toBe("2-3");
    expect(yearSemesterLabel(2, 1)).toBe("2-1");
  });

  // Nothing is invented for a value that cannot be a semester - the caller
  // falls back to its own placeholder rather than showing "0-0".
  it("returns empty for a non-semester", () => {
    expect(yearSemesterLabel(0)).toBe("");
    expect(yearSemesterLabel(-1)).toBe("");
    expect(yearSemesterLabel(Number.NaN)).toBe("");
  });

  // A bad per-year figure must not produce Infinity or a negative year.
  it("falls back to two per year when given a nonsense split", () => {
    expect(yearSemesterLabel(3, 0)).toBe("2-1");
    expect(yearSemesterLabel(3, -2)).toBe("2-1");
    expect(yearSemesterLabel(3, Number.NaN)).toBe("2-1");
  });

  it("floors a fractional split rather than producing a fractional year", () => {
    expect(yearSemesterLabel(3, 2.7)).toBe("2-1");
  });
});

describe("toRoman", () => {
  it("covers the years and semesters actually used", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(8)).toBe("VIII");
  });

  it("accepts a numeric string", () => {
    expect(toRoman("3")).toBe("III");
  });

  // Out of range falls through to the plain number rather than throwing -
  // callers render it straight into a label.
  it("passes anything it cannot map straight through", () => {
    expect(toRoman(0)).toBe("0");
    expect(toRoman(11)).toBe("11");
    expect(toRoman(null)).toBe("");
    expect(toRoman(undefined)).toBe("");
  });
});

describe("yearSemesterLabelIn", () => {
  // The bug this exists for: second year's semesters are stored as [1,2] at
  // most colleges, so dividing the number by two read them as first year's.
  it("labels within-year numbering by the year it belongs to", () => {
    expect(yearSemesterLabelIn(2, [1, 2], 1)).toBe("2-1");
    expect(yearSemesterLabelIn(2, [1, 2], 2)).toBe("2-2");
    expect(yearSemesterLabelIn(4, [1, 2], 2)).toBe("4-2");
  });

  // ...and the other convention, in use at two course-years, must still work.
  it("labels course-wide numbering the same way", () => {
    expect(yearSemesterLabelIn(3, [5, 6], 5)).toBe("3-1");
    expect(yearSemesterLabelIn(3, [5, 6], 6)).toBe("3-2");
    expect(yearSemesterLabelIn(2, [3, 4], 3)).toBe("2-1");
  });

  it("handles a year split into more than two", () => {
    expect(yearSemesterLabelIn(2, [1, 2, 3], 3)).toBe("2-3");
  });

  it("sorts and de-duplicates before taking the position", () => {
    expect(yearSemesterLabelIn(2, [2, 1, 2], 2)).toBe("2-2");
  });

  // A stale pick must not render an empty label.
  it("falls back when the semester is not in that year's list", () => {
    expect(yearSemesterLabelIn(2, [1, 2], 7)).toBe("4-1");
  });

  it("falls back when the year is unusable", () => {
    expect(yearSemesterLabelIn(0, [1, 2], 3)).toBe("2-1");
  });
});

describe("semesterInYearLabel", () => {
  it("formats relative semester when year is already selected", () => {
    expect(semesterInYearLabel([3, 4], 3)).toBe("Sem 1");
    expect(semesterInYearLabel([3, 4], 4)).toBe("Sem 2");
    expect(semesterInYearLabel([5, 6], 5, { format: "full" })).toBe("Semester 1");
    expect(semesterInYearLabel([5, 6], 6, { format: "full" })).toBe("Semester 2");
    expect(semesterInYearLabel([1, 2], 1, { format: "number" })).toBe("1");
    expect(semesterInYearLabel([1, 2], 2, { format: "number" })).toBe("2");
  });
});

describe("formatStudentClass", () => {
  it("writes the class the college way: III B.Tech. I-Sem, CSE-A", () => {
    expect(formatStudentClass({ year: 3, courseCode: "BTECH", semester: 5, sectionName: "CSE-A" })).toBe("III B.Tech. I-Sem, CSE-A");
    expect(formatStudentClass({ year: 3, courseCode: "BTECH", semester: 6, sectionName: "CSE-A" })).toBe("III B.Tech. II-Sem, CSE-A");
    expect(formatStudentClass({ year: 1, courseCode: "BTECH", semester: 1, sectionName: "IT-B" })).toBe("I B.Tech. I-Sem, IT-B");
  });
  it("leaves out what isn't known", () => {
    expect(formatStudentClass({ year: 3, courseCode: "BTECH", semester: null, sectionName: "CSE-A" })).toBe("III B.Tech., CSE-A");
    expect(formatStudentClass({ year: 3, courseCode: "BTECH", semester: -1, sectionName: "CSE-A" })).toBe("III B.Tech., CSE-A");
    expect(formatStudentClass({ year: 2, courseCode: "PHARM.D", semester: 3 })).toBe("II Pharm.D. I-Sem");
  });
});
