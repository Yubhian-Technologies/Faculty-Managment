import { describe, it, expect } from "vitest";
import { resolveCurrentSemester, matchesCurrentSemester } from "@/lib/college/semester";
import type { CourseYearTiming } from "@/types";

function makeTiming(semesters: { semester: number; startDate: Date | string; endDate: Date | string }[]): CourseYearTiming {
  return { semesters } as unknown as CourseYearTiming;
}

describe("resolveCurrentSemester", () => {
  it("returns null when no semesters configured", () => {
    const timing = makeTiming([]);
    expect(resolveCurrentSemester(timing)).toBeNull();
  });

  it("returns the semester whose range contains today", () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5);
    const timing = makeTiming([
      { semester: 3, startDate: start, endDate: end },
    ]);
    expect(resolveCurrentSemester(timing)).toBe(3);
  });

  it("returns null when date falls between semesters", () => {
    const timing = makeTiming([
      { semester: 1, startDate: "2025-06-01T00:00:00.000Z", endDate: "2025-08-31T23:59:59.000Z" },
      { semester: 2, startDate: "2025-09-01T00:00:00.000Z", endDate: "2025-12-31T23:59:59.000Z" },
    ]);
    const gapDate = new Date("2025-09-05T12:00:00.000Z");
    expect(resolveCurrentSemester(timing, gapDate)).toBeNull();
  });

  it("returns null for a date before all semesters", () => {
    const timing = makeTiming([
      { semester: 1, startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-03-31T23:59:59.000Z" },
    ]);
    const pastDate = new Date("2025-12-01T00:00:00.000Z");
    expect(resolveCurrentSemester(timing, pastDate)).toBeNull();
  });

  it("returns null for a date after all semesters", () => {
    const timing = makeTiming([
      { semester: 1, startDate: "2025-01-01T00:00:00.000Z", endDate: "2025-03-31T23:59:59.000Z" },
    ]);
    const futureDate = new Date("2025-12-01T00:00:00.000Z");
    expect(resolveCurrentSemester(timing, futureDate)).toBeNull();
  });

  it("returns first matching semester when ranges overlap", () => {
    const now = new Date();
    const timing = makeTiming([
      { semester: 1, startDate: new Date(now.getTime() - 86400000), endDate: new Date(now.getTime() + 86400000) },
      { semester: 2, startDate: now, endDate: new Date(now.getTime() + 172800000) },
    ]);
    expect(resolveCurrentSemester(timing)).toBe(1);
  });
});

describe("matchesCurrentSemester", () => {
  it("returns true when itemSemester is null and currentSemester is null", () => {
    expect(matchesCurrentSemester(null, null)).toBe(true);
  });

  it("returns true when itemSemester is null and currentSemester is set", () => {
    expect(matchesCurrentSemester(null, 3)).toBe(true);
  });

  it("returns true when semesters match", () => {
    expect(matchesCurrentSemester(3, 3)).toBe(true);
  });

  it("returns false when semesters don't match", () => {
    expect(matchesCurrentSemester(2, 3)).toBe(false);
  });

  it("returns true when itemSemester is undefined and currentSemester is set", () => {
    expect(matchesCurrentSemester(undefined, 3)).toBe(true);
  });

  it("returns false when itemSemester is a prior semester and currentSemester is set", () => {
    expect(matchesCurrentSemester(1, 2)).toBe(false);
  });
});
