import { describe, expect, it } from "vitest";
import { courseYearBatch, shortBatchLabel } from "./courseYearBatch";

// B.Tech with R20 for the 2020-2022 intakes and R23 from 2023 on.
const catalog = {
  regulations: ["R20", "R23"],
  regulationBatches: { R20: "2020-2024,2021-2025,2022-2026", R23: "2023-2027,2024-2028,2025-2029,2026-2030" },
};

describe("courseYearBatch", () => {
  it("places each year of a 4-year course in its intake batch for 2026-27", () => {
    expect([1, 2, 3, 4].map((y) => courseYearBatch(2026, y, 4).label)).toEqual(["2026-30", "2025-29", "2024-28", "2023-27"]);
    expect(courseYearBatch(2026, 3, 4).longLabel).toBe("2024-2028");
  });

  it("handles 2- and 5-year courses", () => {
    expect(courseYearBatch(2026, 2, 2).label).toBe("2025-27");
    expect(courseYearBatch(2026, 5, 5).label).toBe("2022-27");
  });

  it("moves forward with the college academic year", () => {
    expect(courseYearBatch(2027, 3, 4).label).toBe("2025-29");
  });

  it("resolves the regulation that covers the batch", () => {
    expect(courseYearBatch(2026, 3, 4, catalog).regulations).toEqual(["R23"]);
    expect(courseYearBatch(2025, 4, 4, catalog).regulations).toEqual(["R20"]);
  });

  it("returns none when no regulation covers the batch, and all of them when they overlap", () => {
    expect(courseYearBatch(2026, 4, 4, { regulations: ["R23"], regulationBatches: { R23: "2024-2028" } }).regulations).toEqual([]);
    expect(courseYearBatch(2026, 3, 4, { regulations: ["R20", "R23"], regulationBatches: { R20: "2024-2028", R23: "2024-2028" } }).regulations).toEqual(["R20", "R23"]);
  });

  it("falls back to the catalog's regulations when no batch coverage is set", () => {
    expect(courseYearBatch(2026, 1, 4, { regulations: ["R23"] }).regulations).toEqual(["R23"]);
    expect(courseYearBatch(2026, 1, 4, null).regulations).toEqual([]);
  });

  it("pads the short label", () => {
    expect(shortBatchLabel(2096, 2100)).toBe("2096-00");
  });
});
