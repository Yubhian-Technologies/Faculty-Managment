import { describe, expect, it } from "vitest";
import { sameFilters } from "./useAppliedFilters";

describe("sameFilters (dirty detection for filters + Load)", () => {
  it("is equal for identical values and different once any filter changes", () => {
    expect(sameFilters({ status: "ALL", year: 2026 }, { status: "ALL", year: 2026 })).toBe(true);
    expect(sameFilters({ status: "ALL", year: 2026 }, { status: "PENDING", year: 2026 })).toBe(false);
    expect(sameFilters({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});
