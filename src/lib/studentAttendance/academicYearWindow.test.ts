import { describe, expect, it } from "vitest";
import {
  academicYearOfDate, resolveAcademicYearRequest, sessionInAcademicYear, windowForAcademicYear, type AcademicYearConfig,
} from "./academicYearWindow";

const april: AcademicYearConfig = { start: { month: 4, day: 1 }, end: { month: 3, day: 31 }, currentLabel: "2026-27" };
const june: AcademicYearConfig = { start: { month: 6, day: 1 }, end: { month: 5, day: 31 }, currentLabel: "2026-27" };

describe("windowForAcademicYear", () => {
  it("builds the dates from the college's own start day", () => {
    expect(windowForAcademicYear("2026-27", april)).toEqual({ label: "2026-27", from: "2026-04-01", to: "2027-03-31", isCurrent: true });
    expect(windowForAcademicYear("2026-27", june)).toEqual({ label: "2026-27", from: "2026-06-01", to: "2027-05-31", isCurrent: true });
  });
  it("accepts the long label and flags a past year as not current", () => {
    expect(windowForAcademicYear("2025-2026", april)).toMatchObject({ label: "2025-26", isCurrent: false });
  });
  it("rejects a label that isn't a year range", () => {
    expect(windowForAcademicYear("whenever", april)).toBeNull();
  });
});

describe("resolveAcademicYearRequest", () => {
  it("defaults to the current year", () => {
    for (const p of [undefined, null, "", "current", "CURRENT"]) {
      expect(resolveAcademicYearRequest(p, april).window?.label).toBe("2026-27");
    }
  });
  it("'all' means no window (the old unbounded behaviour)", () => {
    expect(resolveAcademicYearRequest("all", april)).toEqual({ window: null });
  });
  it("a specific year, or an error for nonsense", () => {
    expect(resolveAcademicYearRequest("2024-25", april).window).toMatchObject({ from: "2024-04-01", to: "2025-03-31" });
    expect(resolveAcademicYearRequest("nope", april).error).toMatch(/academicYear/);
  });
});

describe("academicYearOfDate - the read fallback for sessions written before the stamp existed", () => {
  it("April-start: March is the old year, April the new", () => {
    expect(academicYearOfDate("2027-03-31", april.start)).toBe("2026-27");
    expect(academicYearOfDate("2027-04-01", april.start)).toBe("2027-28");
    expect(academicYearOfDate("2026-04-01", april.start)).toBe("2026-27");
  });
  it("June-start: a May date still belongs to the year that began the previous June", () => {
    expect(academicYearOfDate("2027-05-31", june.start)).toBe("2026-27");
    expect(academicYearOfDate("2027-06-01", june.start)).toBe("2027-28");
  });
  it("is null for a malformed date", () => expect(academicYearOfDate("tomorrow", april.start)).toBeNull());
});

describe("sessionInAcademicYear", () => {
  const window = windowForAcademicYear("2026-27", april)!;

  it("an unstamped (old) session is placed by its date", () => {
    expect(sessionInAcademicYear({ date: "2026-10-05" }, window)).toBe(true);
    expect(sessionInAcademicYear({ date: "2026-03-30" }, window)).toBe(false); // last cohort's
    expect(sessionInAcademicYear({ date: "2027-04-01" }, window)).toBe(false); // next year's
  });

  it("a stamped session is placed by its stamp, in either label shape", () => {
    expect(sessionInAcademicYear({ date: "2026-10-05", academicYear: "2026-27" }, window)).toBe(true);
    expect(sessionInAcademicYear({ date: "2026-10-05", academicYear: "2026-2027" }, window)).toBe(true);
    expect(sessionInAcademicYear({ date: "2026-10-05", academicYear: "2025-26" }, window)).toBe(false);
  });

  it("a garbage stamp falls back to the date rather than hiding the session", () => {
    expect(sessionInAcademicYear({ date: "2026-10-05", academicYear: "??" }, window)).toBe(true);
  });

  it("no window (academicYear=all) includes everything", () => {
    expect(sessionInAcademicYear({ date: "1999-01-01" }, null)).toBe(true);
  });
});
