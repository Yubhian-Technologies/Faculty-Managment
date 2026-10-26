import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationList } from "./experienceCalc";

describe("formatDurationList", () => {
  it("is comma separated and leaves out any unit that is zero", () => {
    expect(formatDurationList({ years: 18, months: 2, days: 17 })).toBe("18 yrs, 2 mos, 17 days");
    expect(formatDurationList({ years: 2, months: 4, days: 0 })).toBe("2 yrs, 4 mos");
    expect(formatDurationList({ years: 2, months: 0, days: 5 })).toBe("2 yrs, 5 days");
    expect(formatDurationList({ years: 0, months: 3, days: 0 })).toBe("3 mos");
    expect(formatDurationList({ years: 2, months: 0, days: 0 })).toBe("2 yrs");
    expect(formatDurationList({ years: 0, months: 0, days: 9 })).toBe("9 days");
  });
  it("uses the singular for exactly 1", () => {
    expect(formatDurationList({ years: 1, months: 1, days: 1 })).toBe("1 yr, 1 mo, 1 day");
    expect(formatDurationList({ years: 1, months: 0, days: 0 })).toBe("1 yr");
  });
  it("never prints a zero unit, and a total of nothing reads just 0", () => {
    expect(formatDurationList({ years: 5, months: 0, days: 0 })).not.toMatch(/\b0 /);
    expect(formatDurationList({ years: 0, months: 0, days: 0 })).toBe("0");
  });
  it("leaves the older formatter exactly as it was", () => {
    expect(formatDuration({ years: 2, months: 0, days: 5 })).toBe("2 yrs 5 days");
    expect(formatDuration({ years: 0, months: 0, days: 0 })).toBe("Less than a day");
  });
});
