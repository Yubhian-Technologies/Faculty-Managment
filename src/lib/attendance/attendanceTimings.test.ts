import { describe, expect, it } from "vitest";
import { cleanAttendanceTimings, DEFAULT_ATTENDANCE_TIMINGS, lateAfterOf, readAttendanceTimings } from "./attendanceTimings";
import { isLateCheckIn } from "./lateStatus";

describe("college attendance timings", () => {
  it("the cut-off is start + grace; not set = 09:05 as before", () => {
    expect(lateAfterOf(DEFAULT_ATTENDANCE_TIMINGS)).toBe("09:05");
    expect(lateAfterOf({ startTime: "08:30", graceMinutes: 10 })).toBe("08:40");
    expect(lateAfterOf({ startTime: "09:45", graceMinutes: 30 })).toBe("10:15");
    expect(lateAfterOf({ startTime: "23:50", graceMinutes: 30 })).toBe("23:59");
  });

  it("Late uses the record's own cut-off; the cut-off minute itself is on time; no cut-off = 09:05", () => {
    expect(isLateCheckIn("08:40", null, "08:40")).toBe(false);
    expect(isLateCheckIn("08:41", null, "08:40")).toBe(true);
    expect(isLateCheckIn("09:30", null, "10:15")).toBe(false);
    expect(isLateCheckIn("09:06", null, null)).toBe(true);
    expect(isLateCheckIn("09:05")).toBe(false);
    // An HOD's permission for the day still exempts it.
    expect(isLateCheckIn("11:00", "10:30", "08:40")).toBe(false);
  });

  it("validates what is saved", () => {
    expect(cleanAttendanceTimings({ startTime: "08:30", graceMinutes: 10 })).toEqual({ startTime: "08:30", graceMinutes: 10 });
    expect(() => cleanAttendanceTimings({ startTime: "8.30", graceMinutes: 10 })).toThrow(/HH:MM/);
    expect(() => cleanAttendanceTimings({ startTime: "08:30", graceMinutes: -1 })).toThrow(/Grace/);
    expect(() => cleanAttendanceTimings({ startTime: "08:30", graceMinutes: 2.5 })).toThrow(/Grace/);
    expect(() => cleanAttendanceTimings({ startTime: "08:30", graceMinutes: 500 })).toThrow(/Grace/);
  });

  it("reads a stored value leniently", () => {
    expect(readAttendanceTimings(undefined)).toEqual(DEFAULT_ATTENDANCE_TIMINGS);
    expect(readAttendanceTimings({ startTime: "08:30" })).toEqual({ startTime: "08:30", graceMinutes: 5 });
    expect(readAttendanceTimings({ startTime: "junk", graceMinutes: 9 })).toEqual(DEFAULT_ATTENDANCE_TIMINGS);
  });
});
