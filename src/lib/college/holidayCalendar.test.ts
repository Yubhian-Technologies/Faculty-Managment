import { describe, expect, it } from "vitest";
import { addDaysKey, isDateKey, nextSundayAfter, suggestBridgeDays, weekdayOfKey } from "./holidayCalendar";

const WORKING = ["MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

describe("holidayCalendar", () => {
  it("validates real dates only", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("26-02-28")).toBe(false);
  });

  it("finds weekdays, with Sunday as null", () => {
    expect(weekdayOfKey("2026-11-02")).toBe("MON"); // 2 Nov 2026 is a Monday
    expect(weekdayOfKey("2026-11-08")).toBeNull();
  });

  it("moves across month ends", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("gives the very next Sunday, never the same day", () => {
    expect(nextSundayAfter("2026-11-03")).toBe("2026-11-08"); // Tuesday -> that week's Sunday
    expect(nextSundayAfter("2026-11-08")).toBe("2026-11-15"); // a Sunday -> the one after
    expect(nextSundayAfter("2026-11-07")).toBe("2026-11-08");
  });

  it("suggests the Tuesday between Monday and Wednesday holidays", () => {
    expect(suggestBridgeDays(["2026-11-02", "2026-11-04"], [...WORKING])).toEqual(["2026-11-03"]);
  });

  it("does not suggest a day already declared, a Sunday, or a non-working day", () => {
    expect(suggestBridgeDays(["2026-11-02", "2026-11-03", "2026-11-04"], [...WORKING])).toEqual([]);
    expect(suggestBridgeDays(["2026-11-07", "2026-11-09"], [...WORKING])).toEqual([]); // gap is Sunday
    expect(suggestBridgeDays(["2026-11-02", "2026-11-04"], ["MON", "WED"])).toEqual([]); // Tue not a working day
  });
});
