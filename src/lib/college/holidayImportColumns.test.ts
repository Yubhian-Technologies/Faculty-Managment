import { describe, expect, it } from "vitest";
import { HOLIDAY_IMPORT_COLUMNS, parseOutingFlag } from "./holidayImportColumns";

describe("parseOutingFlag", () => {
  it("reads the outing flag, blank meaning not stated", () => {
    expect(parseOutingFlag(undefined)).toBeUndefined();
    expect(parseOutingFlag("Yes")).toBe(true);
    expect(parseOutingFlag("no")).toBe(false);
    expect(parseOutingFlag("maybe")).toBeNull();
  });
});

describe("HOLIDAY_IMPORT_COLUMNS", () => {
  it("has no Category or Applies To column - an import is the regular holiday list", () => {
    const keys = HOLIDAY_IMPORT_COLUMNS.map((c) => c.key);
    expect(keys).not.toContain("category");
    expect(keys).not.toContain("appliesTo");
  });
});
