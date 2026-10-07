import { describe, expect, it } from "vitest";
import { resolveDisplaySemester, matchesCurrentSemester, SEMESTERS_ENDED } from "./semester";
import type { CourseYearTiming } from "@/types";

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);
// Year 1: semester 1 31/08/2026-31/01/2027, semester 2 07/02/2027-31/07/2027.
const timing = {
  semesters: [
    { semester: 1, startDate: d(2026, 8, 31), endDate: d(2027, 1, 31) },
    { semester: 2, startDate: d(2027, 2, 7), endDate: d(2027, 7, 31) },
  ],
} as unknown as Pick<CourseYearTiming, "semesters">;

describe("resolveDisplaySemester", () => {
  it("is the semester running today", () => {
    expect(resolveDisplaySemester(timing, d(2026, 10, 7))).toBe(1);
    expect(resolveDisplaySemester(timing, d(2027, 1, 31))).toBe(1); // last day counts
    expect(resolveDisplaySemester(timing, d(2027, 3, 1))).toBe(2);
  });

  it("moves to the next semester in the gap after one ends, so the finished one is gone", () => {
    expect(resolveDisplaySemester(timing, d(2027, 2, 3))).toBe(2);
  });

  it("shows the first semester before it has started", () => {
    expect(resolveDisplaySemester(timing, d(2026, 8, 1))).toBe(1);
  });

  it("is SEMESTERS_ENDED once every semester is over", () => {
    expect(resolveDisplaySemester(timing, d(2027, 8, 1))).toBe(SEMESTERS_ENDED);
  });

  it("is null when no semesters are configured", () => {
    expect(resolveDisplaySemester({ semesters: [] } as unknown as Pick<CourseYearTiming, "semesters">, d(2026, 10, 7))).toBeNull();
    expect(resolveDisplaySemester(null, d(2026, 10, 7))).toBeNull();
  });

  it("hides a finished semester's slots but keeps untagged and current ones", () => {
    const afterAll = resolveDisplaySemester(timing, d(2027, 8, 1));
    expect(matchesCurrentSemester(1, afterAll)).toBe(false);
    expect(matchesCurrentSemester(2, afterAll)).toBe(false);
    expect(matchesCurrentSemester(null, afterAll)).toBe(true);
    const gap = resolveDisplaySemester(timing, d(2027, 2, 3));
    expect(matchesCurrentSemester(1, gap)).toBe(false);
    expect(matchesCurrentSemester(2, gap)).toBe(true);
  });
});
