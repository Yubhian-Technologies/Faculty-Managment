import { describe, expect, it } from "vitest";
import { cleanLateMarkDays, daysBetween, lateMarkBlock, lateMarkDates, parseLateMark, permissionCoversPeriod } from "./lateMark";

const base = { date: "2026-11-24", today: "2026-11-26", nowMinutes: 10 * 60, days: 3, closeTime: "16:30", onLeave: false, permissionCovers: false };

describe("Late Marking", () => {
  it("days back: 0..7, default kept by the caller", () => {
    expect(cleanLateMarkDays(3)).toBe(3);
    expect(cleanLateMarkDays(0)).toBe(0);
    expect(cleanLateMarkDays(8)).toBeNull();
    expect(cleanLateMarkDays(1.5)).toBeNull();
  });

  it("a reason is required; absent = not a late mark", () => {
    expect(parseLateMark(undefined)).toBeNull();
    expect(parseLateMark({ reason: "  Network down  " })).toEqual({ reason: "Network down" });
    expect(() => parseLateMark({ reason: " " })).toThrow(/reason/);
    expect(parseLateMark({ reason: "x".repeat(900) })!.reason).toHaveLength(500);
  });

  it("dates reach back N days, newest first, across a month end", () => {
    expect(lateMarkDates("2026-12-01", 2)).toEqual(["2026-12-01", "2026-11-30", "2026-11-29"]);
    expect(daysBetween("2026-11-29", "2026-12-01")).toBe(2);
  });

  it("refuses: off, future, too old, still open today, on leave, covered by a permission", () => {
    expect(lateMarkBlock(base)).toBeNull();
    expect(lateMarkBlock({ ...base, days: 0 })).toMatch(/turned off/);
    expect(lateMarkBlock({ ...base, date: "2026-11-27" })).toMatch(/not happened/);
    expect(lateMarkBlock({ ...base, date: "2026-11-22" })).toMatch(/up to 3 days/);
    expect(lateMarkBlock({ ...base, date: "2026-11-23" })).toBeNull();
    expect(lateMarkBlock({ ...base, date: "2026-11-26", nowMinutes: 16 * 60 })).toMatch(/still open/);
    expect(lateMarkBlock({ ...base, date: "2026-11-26", nowMinutes: 16 * 60 + 30 })).toBeNull();
    expect(lateMarkBlock({ ...base, onLeave: true })).toMatch(/leave/);
    expect(lateMarkBlock({ ...base, permissionCovers: true })).toMatch(/permission/);
  });

  it("a permission blocks only when it covers the whole class", () => {
    expect(permissionCoversPeriod({ fromTime: "09:00", toTime: "10:00" }, { startTime: "09:00", endTime: "09:50" })).toBe(true);
    expect(permissionCoversPeriod({ fromTime: "09:30", toTime: "10:30" }, { startTime: "09:00", endTime: "09:50" })).toBe(false);
  });
});
