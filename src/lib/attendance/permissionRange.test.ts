import { describe, expect, it } from "vitest";
import { MAX_PERMISSION_DAYS, permissionDates } from "./permissionRange";

describe("check-in permission date range", () => {
  it("every day from..to inclusive, Sundays left out", () => {
    // 2026-11-21 Sat, 22 Sun, 23 Mon
    expect(permissionDates("2026-11-20", "2026-11-23")).toEqual(["2026-11-20", "2026-11-21", "2026-11-23"]);
    expect(permissionDates("2026-11-17", "2026-11-17")).toEqual(["2026-11-17"]);
  });
  it("refuses a reversed, malformed or too long range", () => {
    expect(permissionDates("2026-11-20", "2026-11-19")).toBeNull();
    expect(permissionDates("2026-11-20", "x")).toBeNull();
    const end = new Date(Date.UTC(2026, 10, 1 + MAX_PERMISSION_DAYS)).toISOString().slice(0, 10);
    expect(permissionDates("2026-11-01", end)).toBeNull();
  });
});
