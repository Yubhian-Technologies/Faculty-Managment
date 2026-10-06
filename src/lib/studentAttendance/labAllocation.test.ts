import { describe, expect, it } from "vitest";
import { dateInRanges, normalizeRanges } from "@/lib/studentAttendance/labAllocation";

describe("normalizeRanges", () => {
  it("sorts valid ranges", () => {
    const r = normalizeRanges([{ from: "2026-10-20", to: "2026-10-22" }, { from: "2026-10-01", to: "2026-10-05" }]);
    expect(r).toEqual({ ok: true, ranges: [{ from: "2026-10-01", to: "2026-10-05" }, { from: "2026-10-20", to: "2026-10-22" }] });
  });
  it("accepts a single-day range", () => {
    expect(normalizeRanges([{ from: "2026-10-01", to: "2026-10-01" }]).ok).toBe(true);
  });
  it("rejects from after to", () => {
    expect(normalizeRanges([{ from: "2026-10-05", to: "2026-10-01" }]).ok).toBe(false);
  });
  it("rejects overlapping and touching ranges", () => {
    expect(normalizeRanges([{ from: "2026-10-01", to: "2026-10-05" }, { from: "2026-10-05", to: "2026-10-09" }]).ok).toBe(false);
  });
  it("rejects missing, malformed and impossible dates", () => {
    expect(normalizeRanges([{ from: "2026-10-01" }]).ok).toBe(false);
    expect(normalizeRanges([{ from: "01-10-2026", to: "05-10-2026" }]).ok).toBe(false);
    expect(normalizeRanges([{ from: "2026-02-30", to: "2026-03-01" }]).ok).toBe(false);
  });
  it("rejects a non-list and more than 20 ranges", () => {
    expect(normalizeRanges("x").ok).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ from: `2026-01-${String(i + 1).padStart(2, "0")}`, to: `2026-01-${String(i + 1).padStart(2, "0")}` }));
    expect(normalizeRanges(many).ok).toBe(false);
  });
  it("allows an empty list (clears the allocation)", () => {
    expect(normalizeRanges([])).toEqual({ ok: true, ranges: [] });
  });
});

describe("dateInRanges", () => {
  const ranges = [{ from: "2026-10-01", to: "2026-10-05" }, { from: "2026-10-20", to: "2026-10-22" }];
  it("is inclusive at both ends", () => {
    expect(dateInRanges("2026-10-01", ranges)).toBe(true);
    expect(dateInRanges("2026-10-05", ranges)).toBe(true);
    expect(dateInRanges("2026-10-22", ranges)).toBe(true);
  });
  it("is false in the gap and outside", () => {
    expect(dateInRanges("2026-10-10", ranges)).toBe(false);
    expect(dateInRanges("2026-09-30", ranges)).toBe(false);
    expect(dateInRanges("2026-10-01", undefined)).toBe(false);
  });
});
