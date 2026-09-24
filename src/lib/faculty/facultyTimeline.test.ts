import { describe, expect, it } from "vitest";
import { facultyActiveDuringRange, facultyMatchesTimelineFilter } from "./facultyTimeline";

describe("facultyActiveDuringRange", () => {
  it("a currently Active faculty member counts as active from their joining date onward, with no upper bound", () => {
    const f = { status: "ACTIVE", joiningDate: "2020-01-01" };
    expect(facultyActiveDuringRange(f, "2019-01-01", "2019-12-31")).toBe(false);
    expect(facultyActiveDuringRange(f, "2021-01-01", "2021-12-31")).toBe(true);
    expect(facultyActiveDuringRange(f, "2099-01-01", "2099-12-31")).toBe(true);
  });

  it("a Resigned faculty member's window closes at their Resignation Date", () => {
    const f = { status: "RESIGNED", joiningDate: "2018-01-01", resignedDate: "2021-06-30" };
    expect(facultyActiveDuringRange(f, "2019-01-01", "2019-12-31")).toBe(true);
    expect(facultyActiveDuringRange(f, "2022-01-01", "2022-12-31")).toBe(false);
    // still overlaps a range that only partly precedes resignation
    expect(facultyActiveDuringRange(f, "2021-01-01", "2021-12-31")).toBe(true);
  });

  it("a Retired faculty member's window closes at their Retirement Date", () => {
    const f = { status: "RETIRED", joiningDate: "2000-01-01", retiredDate: "2023-03-31" };
    expect(facultyActiveDuringRange(f, "2024-01-01", "2024-12-31")).toBe(false);
    expect(facultyActiveDuringRange(f, "2010-01-01", "2010-12-31")).toBe(true);
  });

  it("moving into Retainership also closes the window at the Retainership Date", () => {
    const f = { status: "RETAINERSHIP", joiningDate: "2015-01-01", retainershipDate: "2022-01-01" };
    expect(facultyActiveDuringRange(f, "2021-01-01", "2021-12-31")).toBe(true);
    expect(facultyActiveDuringRange(f, "2023-01-01", "2023-12-31")).toBe(false);
  });

  it("On Leave has no end date - counts as ongoing, same as Active", () => {
    const f = { status: "ON_LEAVE", joiningDate: "2019-01-01" };
    expect(facultyActiveDuringRange(f, "2099-01-01", "2099-12-31")).toBe(true);
  });

  it("Interview Done never matches - they haven't actually joined yet", () => {
    const f = { status: "INTERVIEW_DONE", joiningDate: "2026-01-01" };
    expect(facultyActiveDuringRange(f, "", "")).toBe(false);
  });

  it("an open-ended range (no from or to) matches anyone with a valid joining date", () => {
    const f = { status: "RESIGNED", joiningDate: "2018-01-01", resignedDate: "2020-01-01" };
    expect(facultyActiveDuringRange(f, "", "")).toBe(true);
  });

  it("a Resigned record with no resignedDate on file (legacy data) is treated as still ongoing", () => {
    const f = { status: "RESIGNED", joiningDate: "2018-01-01" };
    expect(facultyActiveDuringRange(f, "2099-01-01", "2099-12-31")).toBe(true);
  });

  it("missing/invalid joining date never matches", () => {
    expect(facultyActiveDuringRange({ status: "ACTIVE" }, "", "")).toBe(false);
    expect(facultyActiveDuringRange({ status: "ACTIVE", joiningDate: "not-a-date" }, "", "")).toBe(false);
  });
});

describe("facultyMatchesTimelineFilter - point-in-time modes", () => {
  const f = {
    status: "ACTIVE", // current status is deliberately unrelated to the dates below -
    // a historical-events view must read the stored dates regardless of it.
    joiningDate: "2018-03-15",
    resignedDate: "2021-06-30",
    retiredDate: "2024-09-01",
    retainershipDate: "2022-11-20",
  };

  it("joinedDuring reads joiningDate", () => {
    expect(facultyMatchesTimelineFilter(f, "joinedDuring", "2018-01-01", "2018-12-31")).toBe(true);
    expect(facultyMatchesTimelineFilter(f, "joinedDuring", "2019-01-01", "2019-12-31")).toBe(false);
  });

  it("resignedDuring reads resignedDate, independent of current status", () => {
    expect(facultyMatchesTimelineFilter(f, "resignedDuring", "2021-01-01", "2021-12-31")).toBe(true);
    expect(facultyMatchesTimelineFilter(f, "resignedDuring", "2020-01-01", "2020-12-31")).toBe(false);
  });

  it("retiredDuring reads retiredDate", () => {
    expect(facultyMatchesTimelineFilter(f, "retiredDuring", "2024-01-01", "2024-12-31")).toBe(true);
    expect(facultyMatchesTimelineFilter(f, "retiredDuring", "2023-01-01", "2023-12-31")).toBe(false);
  });

  it("retainershipDuring reads retainershipDate", () => {
    expect(facultyMatchesTimelineFilter(f, "retainershipDuring", "2022-01-01", "2022-12-31")).toBe(true);
    expect(facultyMatchesTimelineFilter(f, "retainershipDuring", "2023-01-01", "2023-12-31")).toBe(false);
  });

  it("a missing date for the selected mode never matches", () => {
    expect(facultyMatchesTimelineFilter({ status: "ACTIVE", joiningDate: "2020-01-01" }, "resignedDuring", "", "")).toBe(false);
  });

  it("activeDuring delegates to facultyActiveDuringRange", () => {
    expect(facultyMatchesTimelineFilter(f, "activeDuring", "2019-01-01", "2019-12-31")).toBe(true);
  });
});
