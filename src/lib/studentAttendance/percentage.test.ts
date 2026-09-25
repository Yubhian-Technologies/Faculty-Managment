import { describe, it, expect } from "vitest";
import { calcPercent, calcConsolidatedPercent, formatPercent } from "./percentage";

describe("percentage", () => {
  it("calcPercent returns a rounded percentage", () => {
    expect(calcPercent(50, 100)).toBe(50);
    expect(calcPercent(1, 3)).toBe(33.33);
  });
  it("calcPercent returns null when held <= 0", () => {
    expect(calcPercent(0, 0)).toBeNull();
    expect(calcPercent(1, 0)).toBeNull();
  });
  it("calcConsolidatedPercent aggregates across subjects", () => {
    const bySubject = {
      subjA: { held: 2, attend: 1 },   // 50%
      subjB: { held: 4, attend: 3 },   // 75%
    };
    // consolidated = 4/6 = 66.67%
    expect(calcConsolidatedPercent(bySubject)).toBe(66.67);
  });
  it("formatPercent renders null as an em dash", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(50)).toBe("50.00%");
  });
});
