import { describe, expect, it } from "vitest";
import { pctTone, summarizeClassesToday, summarizeFacultyToday } from "./principalSummary";

const r = (department: string, status: string, checkIn: string | null = null, role = "PANEL_MEMBER") => ({ department, role, status, checkIn, permittedCheckInTime: null });

describe("summarizeFacultyToday", () => {
  it("counts each state once; leave and holidays aren't expected", () => {
    const s = summarizeFacultyToday([
      r("CSE", "PRESENT", "09:00"), r("CSE", "PRESENT", "11:30"), r("CSE", "ON_LEAVE"), r("CSE", "NOT_MARKED"),
      r("ECE", "ON_DUTY"), r("ECE", "ABSENT"), r("ECE", "HALF_DAY"), r("Office", "PRESENT", "09:00", "COLLEGE_STAFF"),
    ]);
    expect(s.total).toBe(7); // college staff left out
    expect(s).toMatchObject({ present: 2, onLeave: 1, notIn: 1, onDuty: 1, absent: 1, halfDay: 1 });
    expect(s.late).toBe(1);
    // in: 2 present + 1 on duty + 1 half day = 4, expected 7 - 1 leave = 6
    expect(s.pct).toBe(67);
    expect(s.departments.map((d) => d.department)).toEqual(["CSE", "ECE"]); // lowest first, ties by name (both 67%)
    expect(s.departments.find((d) => d.department === "CSE")).toMatchObject({ total: 4, present: 2, pct: 67 });
  });
  it("nobody expected (holiday) -> no percentage", () => {
    expect(summarizeFacultyToday([r("CSE", "HOLIDAY")]).pct).toBeNull();
  });
});

describe("summarizeClassesToday", () => {
  it("posted out of ended periods; upcoming ones don't count against anyone", () => {
    const s = summarizeClassesToday([
      { department: "CSE", totalPeriods: 6, onTime: 3, late: 1, notMarked: 1, pending: 1 },
      { department: "ECE", totalPeriods: 4, onTime: 0, late: 0, notMarked: 0, pending: 4 },
      { department: "EEE", totalPeriods: 5, onTime: 2, late: 0, notMarked: 3, pending: 0 },
    ]);
    expect(s).toMatchObject({ periods: 15, ended: 10, onTime: 5, late: 1, notPosted: 4, upcoming: 5, facultyNotPosted: 2, pct: 60 });
    expect(s.departments.map((d) => d.department)).toEqual(["EEE", "CSE"]); // ECE has nothing ended yet
  });
  it("before the first period ends -> no percentage", () => {
    expect(summarizeClassesToday([{ department: "CSE", totalPeriods: 2, onTime: 0, late: 0, notMarked: 0, pending: 2 }]).pct).toBeNull();
  });
});

it("pctTone", () => {
  expect(pctTone(95)).toBe("good");
  expect(pctTone(80)).toBe("watch");
  expect(pctTone(50)).toBe("bad");
  expect(pctTone(null)).toBe("none");
});
