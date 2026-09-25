import { describe, it, expect } from "vitest";
import { isShortage, isShortageByPercent, clampThreshold, DEFAULT_SHORTAGE_THRESHOLD } from "./shortage";

describe("shortage", () => {
  it("isShortage detects below-threshold attendance", () => {
    expect(isShortage(10, 7)).toBe(true); // 70% < 75
    expect(isShortage(10, 8)).toBe(false); // 80% >= 75
  });
  it("isShortageByPercent", () => {
    expect(isShortageByPercent(50)).toBe(true);
    expect(isShortageByPercent(75)).toBe(false);
    expect(isShortageByPercent(null)).toBe(false);
  });
  it("isShortage is false when held <= 0", () => {
    expect(isShortage(0, 5)).toBe(false);
    expect(isShortage(0, 0)).toBe(false);
  });
  it("clamps threshold to [0, 100]", () => {
    expect(clampThreshold(120)).toBe(100);
    expect(clampThreshold(-5)).toBe(0);
    expect(clampThreshold("abc" as unknown as number)).toBe(DEFAULT_SHORTAGE_THRESHOLD);
  });
});
