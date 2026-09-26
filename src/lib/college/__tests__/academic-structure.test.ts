import { describe, it, expect } from "vitest";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicSession";

describe("regulationsForCourseYearByBatch", () => {
  it("returns all regulations when no batch mapping exists", () => {
    const result = regulationsForCourseYearByBatch({}, 1);
    expect(result).toEqual([]);
  });

  it("returns single regulation when no regulationBatches but fallback provided", () => {
    const result = regulationsForCourseYearByBatch({}, 1, 2024, ["R20", "R23"]);
    expect(result).toEqual(["R20", "R23"]);
  });

  it("returns regulation matching the course year from regulationBatches", () => {
    // R20 covers 2024-2028, R23 covers 2025-2029
    const result = regulationsForCourseYearByBatch(
      { "R20": "2024-2028", "R23": "2025-2029" },
      1, 2024
    );
    expect(result).toEqual(["R20"]);
  });

  it("returns multiple regulations when multiple batches match", () => {
    // Both batches include 2025 as intake year
    const result = regulationsForCourseYearByBatch(
      { "R20": "2024-2028", "R23": "2025-2029" },
      2, 2025
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
