import { describe, expect, it } from "vitest";
import { effectiveEndTime, isEarly, markCoverage, periodsLeft, permissionCovers } from "./earlyCheckOut";
import { cleanAttendanceTimings, readAttendanceTimings } from "./attendanceTimings";

const P = (slotId: string, startTime: string, endTime: string) => ({
  slotId, periodNumber: 1, startTime, endTime, subjectName: "DS", sectionId: "s1", sectionName: "A", department: "CSE",
});

describe("early check-out", () => {
  it("End Time is optional and must follow the start time; a bad one never loses the start time", () => {
    expect(cleanAttendanceTimings({ startTime: "09:00", graceMinutes: 5, endTime: "16:30" })).toEqual({ startTime: "09:00", graceMinutes: 5, endTime: "16:30" });
    expect(cleanAttendanceTimings({ startTime: "09:00", graceMinutes: 5, endTime: "" })).toEqual({ startTime: "09:00", graceMinutes: 5 });
    expect(() => cleanAttendanceTimings({ startTime: "09:00", graceMinutes: 5, endTime: "08:00" })).toThrow(/after the start/);
    expect(readAttendanceTimings({ startTime: "08:30", graceMinutes: 5, endTime: "junk" })).toEqual({ startTime: "08:30", graceMinutes: 5 });
  });

  it("early = before the closing time; an afternoon leave closes the day at 13:00; not set = never early", () => {
    expect(isEarly("15:00", "16:30")).toBe(true);
    expect(isEarly("16:30", "16:30")).toBe(false);
    expect(isEarly("10:00", null)).toBe(false);
    expect(effectiveEndTime("16:30", "AN")).toBe("13:00");
    expect(effectiveEndTime("16:30", "FN")).toBe("16:30");
    expect(effectiveEndTime(null, "AN")).toBeNull();
  });

  it("classes left = not ended yet (a class going on counts), earliest first", () => {
    const left = periodsLeft([P("c", "14:00", "14:50"), P("a", "10:00", "10:50"), P("b", "11:00", "11:50")], "10:20");
    expect(left.map((p) => p.slotId)).toEqual(["a", "b", "c"]);
    expect(periodsLeft([P("a", "10:00", "10:50")], "10:50")).toEqual([]);
  });

  it("a permission covers from when they leave (or the class starts) to the class end", () => {
    expect(permissionCovers({ fromTime: "10:20", toTime: "16:30" }, P("a", "10:00", "10:50"), "10:25")).toBe(true);
    expect(permissionCovers({ fromTime: "10:30", toTime: "16:30" }, P("a", "10:00", "10:50"), "10:25")).toBe(false);
    expect(permissionCovers({ fromTime: "13:00", toTime: "14:00" }, P("c", "14:00", "14:50"), "10:25")).toBe(false);
    expect(permissionCovers({ fromTime: "13:00", toTime: "15:00" }, P("c", "14:00", "14:50"), "10:25")).toBe(true);
  });

  it("each class is covered by a pending adjustment, a permission or a half-day leave - else uncovered", () => {
    const { periods, permissionIds } = markCoverage(
      [P("a", "10:00", "10:50"), P("b", "11:00", "11:50"), P("c", "14:00", "14:50"), P("d", "15:00", "15:50")],
      { now: "10:20", pendingAdjustedSlotIds: new Set(["a"]), permissions: [{ id: "p1", fromTime: "10:50", toTime: "12:00" }], leavePart: "AN" },
    );
    expect(periods.map((p) => p.coveredBy)).toEqual(["ADJUSTMENT", "PERMISSION", "LEAVE", "LEAVE"]);
    expect(permissionIds).toEqual(["p1"]);
    const none = markCoverage([P("b", "11:00", "11:50")], { now: "10:20", pendingAdjustedSlotIds: new Set(), permissions: [], leavePart: null });
    expect(none.periods[0].coveredBy).toBeUndefined();
  });
});
