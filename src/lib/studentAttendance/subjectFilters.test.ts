import { describe, expect, it } from "vitest";
import { filterSubjectRows, hasSubjectFilters, NO_SUBJECT_FILTERS, totalOfRows } from "./subjectFilters";

const rows = [
  { subjectId: "a", held: 10, attended: 10, percent: 100 },
  { subjectId: "b", held: 10, attended: 6, percent: 60 },
  { subjectId: "c", held: 0, attended: 0, percent: null },
];

describe("filterSubjectRows", () => {
  it("keeps everything with no filters", () => {
    expect(filterSubjectRows(rows, NO_SUBJECT_FILTERS, 75)).toHaveLength(3);
    expect(hasSubjectFilters(NO_SUBJECT_FILTERS)).toBe(false);
  });
  it("filters by subject", () => {
    expect(filterSubjectRows(rows, { ...NO_SUBJECT_FILTERS, subjectIds: ["b"] }, 75).map((r) => r.subjectId)).toEqual(["b"]);
  });
  it("shortage only drops subjects with no percentage", () => {
    expect(filterSubjectRows(rows, { ...NO_SUBJECT_FILTERS, shortageOnly: true }, 75).map((r) => r.subjectId)).toEqual(["b"]);
  });
  it("applies percent bounds", () => {
    expect(filterSubjectRows(rows, { ...NO_SUBJECT_FILTERS, minPercent: 70 }, 75).map((r) => r.subjectId)).toEqual(["a"]);
    expect(filterSubjectRows(rows, { ...NO_SUBJECT_FILTERS, maxPercent: 70 }, 75).map((r) => r.subjectId)).toEqual(["b"]);
  });
});

describe("totalOfRows", () => {
  it("sums held and attended and recomputes the percentage", () => {
    expect(totalOfRows(rows)).toEqual({ held: 20, attended: 16, percent: 80 });
    expect(totalOfRows([])).toEqual({ held: 0, attended: 0, percent: null });
  });
});
