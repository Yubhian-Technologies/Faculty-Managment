import { describe, expect, it } from "vitest";
import { applyStudentFilters, NO_FILTERS } from "./reportFilters";

const mk = (id: string, a: [number, number], b: [number, number], extra: { labBatch?: string; absentDays?: number } = {}) => ({
  id, ...extra,
  bySubject: { M: { held: a[0], attended: a[1] }, P: { held: b[0], attended: b[1] } },
});
const students = [
  mk("full", [10, 10], [10, 10], { labBatch: "B1", absentDays: 0 }),
  mk("math-miss", [10, 5], [10, 10], { labBatch: "B2", absentDays: 2 }),
  mk("low", [10, 3], [10, 4], { labBatch: "B1", absentDays: 5 }),
  mk("none", [0, 0], [0, 0]),
];
const ids = (r: { id: string }[]) => r.map((s) => s.id);

describe("applyStudentFilters", () => {
  it("keeps everyone with no filters", () => {
    expect(ids(applyStudentFilters(students, NO_FILTERS))).toEqual(["full", "math-miss", "low", "none"]);
  });
  it("absentees only", () => {
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, absentees: true }))).toEqual(["math-miss", "low"]);
  });
  it("subject filter recomputes the % over that subject", () => {
    const r = applyStudentFilters(students, { ...NO_FILTERS, subjectIds: ["P"], absentees: true });
    expect(ids(r)).toEqual(["low"]);
    const m = applyStudentFilters(students, { ...NO_FILTERS, subjectIds: ["M"], minPercent: 40, maxPercent: 60 });
    expect(ids(m)).toEqual(["math-miss"]);
  });
  it("% range is inclusive and drops students with no classes", () => {
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, minPercent: 0, maxPercent: 100 }))).toEqual(["full", "math-miss", "low"]);
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, maxPercent: 40 }))).toEqual(["low"]);
  });
  it("batch and absent-days filters", () => {
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, batches: ["B1"] }))).toEqual(["full", "low"]);
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, batches: [""] }))).toEqual(["none"]);
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, minAbsentDays: 2 }))).toEqual(["math-miss", "low"]);
  });
  it("combines filters", () => {
    expect(ids(applyStudentFilters(students, { ...NO_FILTERS, batches: ["B1"], minAbsentDays: 3, absentees: true }))).toEqual(["low"]);
  });
});
