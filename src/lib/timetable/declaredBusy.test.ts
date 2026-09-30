import { describe, expect, it } from "vitest";
import { declaredBusyByFaculty, expandDeclaredBusy, requesterRequestsLink, requesterTimetableLink } from "./declaredBusy";
import type { CourseYearTiming } from "@/types";

const mk = (year: number, start: string, n: number, dur: number): CourseYearTiming => ({
  id: `c1_${year}`, collegeId: "col1", departmentId: "d1", courseId: "c1", year,
  collegeStartTime: start, collegeEndTime: "17:00", numberOfPeriods: n, periodDurationMinutes: dur,
  lunchBreak: undefined as never, shortBreaks: [], createdAt: null as never,
});

// Year 1 starts 09:00, year 2 starts 10:00 - same period number, different hour.
const y1 = mk(1, "09:00", 4, 60);
const y2 = mk(2, "10:00", 4, 60);
const timingFor = (y: number) => (y === 1 ? y1 : y === 2 ? y2 : null);

describe("expandDeclaredBusy", () => {
  it("keeps entries with no year or the section's own year as-is", () => {
    const cells = expandDeclaredBusy([{ day: "MON", period: 2 }, { day: "TUE", period: 3, year: 1 }], 1, y1, timingFor);
    expect([...cells].sort()).toEqual(["MON:2", "TUE:3"]);
  });

  it("maps another year's period by clock time", () => {
    // Year 2 P1 = 10:00-11:00 -> year 1 P2 (10:00-11:00)
    const cells = expandDeclaredBusy([{ day: "MON", period: 1, year: 2 }], 1, y1, timingFor);
    expect([...cells]).toEqual(["MON:2"]);
  });

  it("falls back to the same number when the other year's timing is unknown", () => {
    const cells = expandDeclaredBusy([{ day: "MON", period: 3, year: 4 }], 1, y1, timingFor);
    expect([...cells]).toEqual(["MON:3"]);
  });
});

describe("declaredBusyByFaculty", () => {
  it("skips requests without an allocated faculty or busy periods", () => {
    const m = declaredBusyByFaculty(
      [{ allocatedFacultyId: undefined, busyPeriods: [{ day: "MON", period: 1 }] }, { allocatedFacultyId: "f1", busyPeriods: [] }],
      1, y1, timingFor,
    );
    expect(m.size).toBe(0);
  });
});

describe("requester links", () => {
  const r = { courseId: "c1", year: 2, sectionId: "s1" };
  it("routes by role", () => {
    expect(requesterTimetableLink("HOD", r)).toBe("/hod/timetable/c1/2/s1");
    expect(requesterTimetableLink("PANEL_MEMBER", r)).toBe("/panel/timetable-incharge/c1/2/s1");
    expect(requesterTimetableLink("COLLEGE_STAFF", r)).toBe("/college-staff/timetable-incharge/c1/2/s1");
    expect(requesterTimetableLink(undefined, r)).toBe("/hod/timetable/c1/2/s1");
    expect(requesterRequestsLink("PANEL_MEMBER")).toBe("/panel/assignment-requests");
  });
});
