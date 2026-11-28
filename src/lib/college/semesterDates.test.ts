import { describe, expect, it } from "vitest";
import { planChangeover, semesterLabel, semesterRangesError } from "./semesterDates";

// VWU III Year today: Semester 5 29/06 .. 28/11, Semester 6 30/11 .. 26/06.
const vwuY3 = [{ semester: 5, start: "2026-06-29", end: "2026-11-28" }, { semester: 6, start: "2026-11-30", end: "2027-06-26" }];

describe("class-work end date (Semester Changeover)", () => {
  it("ends Semester N on the date and sets Semester N+1", () => {
    const r = planChangeover(vwuY3, { semester: 5, classWorkEnd: "2026-12-05", nextStart: "2026-12-14", nextEnd: "2027-04-30" });
    expect(r).toEqual({ ok: true, semesters: [{ semester: 5, start: "2026-06-29", end: "2026-12-05" }, { semester: 6, start: "2026-12-14", end: "2027-04-30" }] });
  });
  it("adds Semester N+1 when the course-year had only Semester N", () => {
    const r = planChangeover([{ semester: 3, start: "2026-07-20", end: "2027-02-06" }], { semester: 3, classWorkEnd: "2026-12-10", nextStart: "2026-12-12", nextEnd: "2027-04-28" });
    expect(r.ok && r.semesters.map((s) => s.semester)).toEqual([3, 4]);
  });
  it("keeps other semesters untouched", () => {
    const r = planChangeover([{ semester: 4, start: "2026-01-01", end: "2026-05-01" }, ...vwuY3], { semester: 5, classWorkEnd: "2026-11-28", nextStart: "2026-11-30", nextEnd: "2027-06-26" });
    expect(r.ok && r.semesters[0]).toEqual({ semester: 4, start: "2026-01-01", end: "2026-05-01" });
  });
  it("refuses dates that don't hold together", () => {
    const base = { semester: 5, classWorkEnd: "2026-12-05", nextStart: "2026-12-14", nextEnd: "2027-04-30" };
    expect(planChangeover(vwuY3, { ...base, nextStart: "2026-12-05" })).toMatchObject({ ok: false, error: expect.stringMatching(/start after the class-work end/) });
    expect(planChangeover(vwuY3, { ...base, nextEnd: "2026-12-01" })).toMatchObject({ ok: false });
    expect(planChangeover(vwuY3, { ...base, classWorkEnd: "2026-06-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/before Semester 5 starts/) });
    expect(planChangeover(vwuY3, { ...base, semester: 7 })).toMatchObject({ ok: false, error: expect.stringMatching(/not set up/) });
    expect(planChangeover(vwuY3, { ...base, classWorkEnd: "28/11/2026" })).toMatchObject({ ok: false });
  });
  it("checks ranges in order, without overlap", () => {
    expect(semesterRangesError(vwuY3)).toBeNull();
    expect(semesterRangesError([{ semester: 5, start: "2026-06-29", end: "2026-12-01" }, { semester: 6, start: "2026-11-30", end: "2027-06-26" }])).toMatch(/must start after/);
    expect(semesterRangesError([{ semester: 5, start: "2026-06-29", end: "2026-06-01" }])).toMatch(/on or after/);
  });
  it("labels continuous semester numbers", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(semesterLabel)).toEqual(["I-I", "I-II", "II-I", "II-II", "III-I", "III-II", "IV-I", "IV-II"]);
  });
});
