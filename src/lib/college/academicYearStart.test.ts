import { describe, expect, it } from "vitest";
import {
  academicSessionLabel, academicYearRange, currentAcademicStartYear,
  DEFAULT_ACADEMIC_YEAR_END, DEFAULT_ACADEMIC_YEAR_START,
  resolveAcademicYearEnd, resolveAcademicYearStart, resolveTimetableAcademicYear,
} from "./academicSession";

// A college now says only WHEN its year begins; the year is derived from today
// against that day and advances on its own. These pin the rollover boundary and
// the promise that a caller passing nothing keeps the old April-1 behaviour.

const JUNE_1 = { month: 6, day: 1 };
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("resolveAcademicYearStart", () => {
  it("reads a configured start day", () => {
    expect(resolveAcademicYearStart({ academicYearStartMonth: 6, academicYearStartDay: 1 })).toEqual(JUNE_1);
  });

  // Anything unusable must land on April 1 rather than produce a nonsense
  // cutoff - this is the value seven consumers derive the session from.
  it("falls back to April 1 for missing or invalid values", () => {
    for (const bad of [
      undefined, null, {},
      { academicYearStartMonth: 6 },
      { academicYearStartDay: 1 },
      { academicYearStartMonth: 0, academicYearStartDay: 1 },
      { academicYearStartMonth: 13, academicYearStartDay: 1 },
      { academicYearStartMonth: 6, academicYearStartDay: 0 },
      { academicYearStartMonth: 6, academicYearStartDay: 32 },
      { academicYearStartMonth: 6.5, academicYearStartDay: 1 },
    ]) {
      expect(resolveAcademicYearStart(bad)).toEqual(DEFAULT_ACADEMIC_YEAR_START);
    }
  });
});

describe("currentAcademicStartYear", () => {
  // The guarantee that stops this from being a breaking change: every existing
  // caller passes nothing and must behave exactly as it did when April 1 was
  // hardcoded.
  it("defaults to the April 1 cutoff", () => {
    expect(currentAcademicStartYear(at(2026, 4, 1))).toBe(2026);
    expect(currentAcademicStartYear(at(2026, 3, 31))).toBe(2025);
    expect(currentAcademicStartYear(at(2026, 1, 15))).toBe(2025);
    expect(currentAcademicStartYear(at(2026, 12, 31))).toBe(2026);
  });

  it("rolls over on the configured day, not in April", () => {
    expect(currentAcademicStartYear(at(2026, 5, 31), JUNE_1)).toBe(2025); // still last session
    expect(currentAcademicStartYear(at(2026, 6, 1), JUNE_1)).toBe(2026);  // first day of the new one
    expect(currentAcademicStartYear(at(2027, 5, 31), JUNE_1)).toBe(2026); // a year on, still 2026-27
    expect(currentAcademicStartYear(at(2027, 6, 1), JUNE_1)).toBe(2027);  // advances by itself
  });

  it("advances every cycle with nothing stored or updated", () => {
    const labels = [2026, 2027, 2028].map((y) => academicSessionLabel(currentAcademicStartYear(at(y, 6, 1), JUNE_1)));
    expect(labels).toEqual(["2026-27", "2027-28", "2028-29"]);
  });

  it("handles a mid-month cutoff on both sides of the boundary", () => {
    const jul15 = { month: 7, day: 15 };
    expect(currentAcademicStartYear(at(2026, 7, 14), jul15)).toBe(2025);
    expect(currentAcademicStartYear(at(2026, 7, 15), jul15)).toBe(2026);
  });

  it("keeps a January cutoff on the calendar year", () => {
    const jan1 = { month: 1, day: 1 };
    expect(currentAcademicStartYear(at(2026, 1, 1), jan1)).toBe(2026);
    expect(currentAcademicStartYear(at(2026, 12, 31), jan1)).toBe(2026);
  });
});

describe("resolveAcademicYearEnd", () => {
  it("reads a configured end day", () => {
    expect(resolveAcademicYearEnd({ academicYearEndMonth: 5, academicYearEndDay: 31 })).toEqual({ month: 5, day: 31 });
  });

  it("falls back to March 31 for missing or invalid values", () => {
    for (const bad of [undefined, null, {}, { academicYearEndMonth: 5 }, { academicYearEndMonth: 13, academicYearEndDay: 1 }]) {
      expect(resolveAcademicYearEnd(bad)).toEqual(DEFAULT_ACADEMIC_YEAR_END);
    }
  });
});

describe("academicYearRange", () => {
  // The end is now configured, not derived - but an end that falls BEFORE the
  // start in the calendar still belongs to the following year.
  it("carries an earlier end day into the next year", () => {
    expect(academicYearRange(2026, JUNE_1, { month: 5, day: 31 })).toEqual({ from: "2026-06-01", to: "2027-05-31" });
  });

  it("gives the assumed April-March span by default", () => {
    expect(academicYearRange(2026)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
  });

  it("keeps an end LATER in the calendar inside the same year", () => {
    expect(academicYearRange(2026, { month: 1, day: 1 }, { month: 12, day: 31 }))
      .toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("treats an end on the same month but an earlier day as next year", () => {
    expect(academicYearRange(2026, { month: 6, day: 15 }, { month: 6, day: 14 }))
      .toEqual({ from: "2026-06-15", to: "2027-06-14" });
  });

  it("honours an end the admin sets that is not the day before the start", () => {
    expect(academicYearRange(2026, JUNE_1, { month: 4, day: 30 })).toEqual({ from: "2026-06-01", to: "2027-04-30" });
  });
});

describe("resolveTimetableAcademicYear", () => {
  // The YYYY-YY shape every consumer stamps and compares on is unchanged.
  it("still emits the short label, now off the configured cutoff", () => {
    expect(resolveTimetableAcademicYear(null, at(2026, 5, 31), JUNE_1)).toBe("2025-26");
    expect(resolveTimetableAcademicYear(null, at(2026, 6, 1), JUNE_1)).toBe("2026-27");
  });

  // Colleges that pinned a session before the start day was configurable keep
  // that pin until they clear it - which is why the settings screen warns.
  it("lets a pinned session override the calculation", () => {
    expect(resolveTimetableAcademicYear("2024-25", at(2026, 6, 1), JUNE_1)).toBe("2024-25");
  });

  it("ignores an unparseable pin and calculates instead", () => {
    expect(resolveTimetableAcademicYear("whatever", at(2026, 6, 1), JUNE_1)).toBe("2026-27");
  });
});
