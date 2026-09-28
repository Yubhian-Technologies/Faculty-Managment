import { describe, it, expect } from "vitest";
import { calcFine, isOverdue, daysOverdue } from "./fine";

describe("fine", () => {
  it("calcFine is 0 when returned on or before the due date", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    expect(calcFine(due, new Date("2026-01-10T00:00:00Z"), 5)).toBe(0);
    expect(calcFine(due, new Date("2026-01-05T00:00:00Z"), 5)).toBe(0);
  });

  it("calcFine charges per full day late", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    expect(calcFine(due, new Date("2026-01-13T00:00:00Z"), 5)).toBe(15); // 3 days late
    expect(calcFine(due, new Date("2026-01-10T23:00:00Z"), 5)).toBe(0); // <1 day late
  });

  it("isOverdue / daysOverdue", () => {
    const due = new Date("2026-01-10T00:00:00Z");
    expect(isOverdue(due, new Date("2026-01-11T00:00:00Z"))).toBe(true);
    expect(isOverdue(due, new Date("2026-01-09T00:00:00Z"))).toBe(false);
    expect(daysOverdue(due, new Date("2026-01-13T00:00:00Z"))).toBe(3);
  });
});
