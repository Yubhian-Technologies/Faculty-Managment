import { describe, expect, it } from "vitest";
import { experienceBreakdown, totalYearsOfExperience } from "./experienceCalc";

const asOf = new Date("2026-01-01");

function yearsAgo(years: number, from = asOf): string {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe("experienceBreakdown", () => {
  it("Internal 2 + External 5 = Total 7", () => {
    const joiningDate = yearsAgo(2); // Internal: 2 years at this institution
    const previousInstitutions = [
      { fromDate: yearsAgo(9), toDate: yearsAgo(4) }, // External: 5 years, pre-joining
    ];
    const result = experienceBreakdown(previousInstitutions, joiningDate, asOf);
    expect(result.internal).toBe(2);
    expect(result.external).toBe(5);
    expect(result.total).toBe(7);
  });

  it("sums multiple Academic/Industry/Research entries", () => {
    const joiningDate = yearsAgo(1);
    const previousInstitutions = [
      { fromDate: yearsAgo(10), toDate: yearsAgo(8) }, // Academic: 2 years
      { fromDate: yearsAgo(6), toDate: yearsAgo(5) }, // Industry: 1 year
      { fromDate: "2020-01-01", toDate: "2022-07-01" }, // Research: 2.5 years
    ];
    const result = experienceBreakdown(previousInstitutions, joiningDate, asOf);
    expect(result.external).toBeCloseTo(5.5, 1);
    expect(result.total).toBeCloseTo(6.5, 1);
  });

  it("a future joining date gives Internal 0, never negative", () => {
    const futureJoiningDate = "2030-06-01";
    const result = experienceBreakdown(undefined, futureJoiningDate, asOf);
    expect(result.internal).toBe(0);
    expect(result.total).toBe(0);

    const duration = totalYearsOfExperience(undefined, futureJoiningDate, asOf);
    expect(duration.years).toBe(0);
    expect(duration.months).toBe(0);
    expect(duration.days).toBe(0);
  });

  it("no joining date at all gives Internal 0", () => {
    const result = experienceBreakdown([{ fromDate: yearsAgo(5), toDate: yearsAgo(3) }], undefined, asOf);
    expect(result.internal).toBe(0);
    expect(result.external).toBe(2);
    expect(result.total).toBe(2);
  });
});
