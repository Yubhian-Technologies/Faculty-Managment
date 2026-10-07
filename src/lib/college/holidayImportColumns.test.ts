import { describe, expect, it } from "vitest";
import { parseHolidayAudience } from "./holidayImportColumns";

describe("parseHolidayAudience", () => {
  it("defaults a blank to Both", () => {
    expect(parseHolidayAudience(undefined)).toBe("BOTH");
    expect(parseHolidayAudience("  ")).toBe("BOTH");
  });
  it("reads the labels shown in the app, case and spacing aside", () => {
    expect(parseHolidayAudience("Both")).toBe("BOTH");
    expect(parseHolidayAudience("Faculty & Students")).toBe("BOTH");
    expect(parseHolidayAudience("Students")).toBe("STUDENTS");
    expect(parseHolidayAudience("Students  (Outing)")).toBe("STUDENTS");
  });
  it("refuses anything else", () => {
    expect(parseHolidayAudience("Faculty")).toBeNull();
    expect(parseHolidayAudience("maybe")).toBeNull();
  });
});
