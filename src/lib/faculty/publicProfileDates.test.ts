import { describe, expect, it } from "vitest";
import { publicMonthYear, publicPeriod, publicYear } from "./publicProfileDates";
import { awardYear } from "./awardYear";

describe("publicProfileDates", () => {
  it("prefers the real date, then the legacy year", () => {
    expect(publicMonthYear("2012-06-15", 1999)).toBe("Jun 2012");
    expect(publicMonthYear(undefined, 1999)).toBe("1999");
    expect(publicMonthYear("garbage", 2001)).toBe("2001");
    expect(publicMonthYear(undefined, undefined)).toBeUndefined();
    expect(publicYear("2020-01-01", 1999)).toBe(2020);
    expect(publicYear(undefined, 1999)).toBe(1999);
    expect(publicYear(undefined, undefined)).toBeUndefined();
  });

  it("builds a period from new dates, legacy years, or a mix", () => {
    expect(publicPeriod("2012-06-01", "2015-07-31")).toBe("Jun 2012 – Jul 2015");
    expect(publicPeriod("2012-06-01", undefined)).toBe("Jun 2012 – present");
    expect(publicPeriod(undefined, undefined, 2014, 2018)).toBe("2014 – 2018");
    expect(publicPeriod(undefined, undefined, 2014)).toBe("2014 – present");
    expect(publicPeriod(undefined, "2015-07-31")).toBeUndefined();
  });
});

describe("awardYear", () => {
  it("derives the year from dateOfAward and falls back to the legacy year", () => {
    expect(awardYear({ dateOfAward: "2021-12-31", year: 1999 })).toBe(2021);
    expect(awardYear({ year: 2018 })).toBe(2018);
    expect(awardYear({ year: 0 })).toBeUndefined();
    expect(awardYear({})).toBeUndefined();
    expect(awardYear(undefined)).toBeUndefined();
  });
});
