import { describe, expect, it } from "vitest";
import { parseHolidayAudience, parseHolidayCategory, parseOutingFlag } from "./holidayImportColumns";

describe("parseHolidayCategory / parseOutingFlag", () => {
  it("reads the category, blank meaning Regular", () => {
    expect(parseHolidayCategory("")).toBe("REGULAR");
    expect(parseHolidayCategory("Bridge")).toBe("BRIDGE");
    expect(parseHolidayCategory("Classwork Suspended")).toBe("CLASS_SUSPENDED");
    expect(parseHolidayCategory("festival")).toBeNull();
  });
  it("reads the outing flag, blank meaning not stated", () => {
    expect(parseOutingFlag(undefined)).toBeUndefined();
    expect(parseOutingFlag("Yes")).toBe(true);
    expect(parseOutingFlag("no")).toBe(false);
    expect(parseOutingFlag("maybe")).toBeNull();
  });
});

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
