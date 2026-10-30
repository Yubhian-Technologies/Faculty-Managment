import { describe, expect, it } from "vitest";
import { currentMentoringSemester, mentoringSemesterRanges, withEarlierYears } from "./semesterRanges";

// Course-year timings hold the CURRENT academic year's dates for every year of the course.
const y1 = { year: 1, semesters: [{ semester: 1, startDate: "2026-08-01", endDate: "2026-12-15" }, { semester: 2, startDate: "2027-01-05", endDate: "2027-05-30" }] };
const y2 = { year: 2, semesters: [{ semester: 3, startDate: "2026-08-01", endDate: "2026-12-15" }, { semester: 4, startDate: "2027-01-05", endDate: "2027-05-30" }] };

describe("mentoringSemesterRanges", () => {
  it("offers every semester of the years a student has finished, even when their dates are still ahead", () => {
    // 2026-10-27: Year 1's semester 2 is "in the future" on this year's calendar, but a year-2 student finished it.
    expect(mentoringSemesterRanges([y1, y2], 2, "2026-10-27").map((s) => s.semester)).toEqual([1, 2, 3]);
  });

  it("holds back only a semester of the student's own year that has not started", () => {
    expect(mentoringSemesterRanges([y1, y2], 2, "2027-02-01").map((s) => s.semester)).toEqual([1, 2, 3, 4]);
    expect(mentoringSemesterRanges([y1], 1, "2026-10-27").map((s) => s.semester)).toEqual([1]);
  });

  it("numbers each semester within its year", () => {
    const r = mentoringSemesterRanges([y1, y2], 2, "2027-02-01");
    expect(r.map((s) => [s.year, s.inYear])).toEqual([[1, 1], [1, 2], [2, 1], [2, 2]]);
  });

  it("skips years with no timing and years beyond the student's", () => {
    expect(mentoringSemesterRanges([y2], 2, "2027-02-01").map((s) => s.semester)).toEqual([3, 4]);
    expect(mentoringSemesterRanges([y1, y2], 1, "2027-02-01").map((s) => s.semester)).toEqual([1, 2]);
  });
});

describe("currentMentoringSemester", () => {
  it("is the student's own year's semester, never an earlier year's that happens to contain today", () => {
    const r = mentoringSemesterRanges([y1, y2], 2, "2026-10-27");
    expect(currentMentoringSemester(r, "2026-10-27")?.semester).toBe(3);
  });

  it("is the latest started semester of the own year in a gap", () => {
    const r = mentoringSemesterRanges([y1, y2], 2, "2026-12-20");
    expect(currentMentoringSemester(r, "2026-12-20")?.semester).toBe(3);
  });

  it("falls back to the previous year's last semester before the own year has started", () => {
    const r = mentoringSemesterRanges([y1, y2], 2, "2026-07-01");
    expect(currentMentoringSemester(r, "2026-07-01")?.semester).toBe(2);
  });

  it("is null with no semesters", () => {
    expect(currentMentoringSemester([], "2026-10-27")).toBeNull();
  });
});

describe("withEarlierYears", () => {
  const y3 = { year: 3, semesters: [{ semester: 5, startDate: "2026-08-01", endDate: "2026-12-15" }, { semester: 6, startDate: "2027-01-05", endDate: "2027-05-30" }] };

  it("lists a third-year student's finished years even when only their own year has a timing", () => {
    const r = mentoringSemesterRanges(withEarlierYears([y3], 3), 3, "2026-10-27");
    expect(r.map((s) => [s.semester, s.year, s.inYear])).toEqual([[1, 1, 1], [2, 1, 2], [3, 2, 1], [4, 2, 2], [5, 3, 1]]);
    expect(r.filter((s) => s.year !== 3).every((s) => s.startDate === "")).toBe(true);
    expect(currentMentoringSemester(r, "2026-10-27")?.semester).toBe(5);
  });

  it("keeps a year's own timing and numbers a missing year after it", () => {
    const r = mentoringSemesterRanges(withEarlierYears([y1, y3], 3), 3, "2026-10-27");
    expect(r.map((s) => s.semester)).toEqual([1, 2, 3, 4, 5]);
    expect(r.find((s) => s.semester === 2)?.endDate).toBe("2027-05-30");
  });

  it("adds nothing for a first-year student", () => {
    expect(withEarlierYears([y1], 1)).toEqual([y1]);
  });

  it("gives every finished year both semesters when each timing lists only one", () => {
    const only1 = { year: 1, semesters: [{ semester: 1, startDate: "2026-08-01", endDate: "2026-12-15" }] };
    const only3 = { year: 2, semesters: [{ semester: 3, startDate: "2026-08-01", endDate: "2026-12-15" }] };
    const r = mentoringSemesterRanges(withEarlierYears([only1, only3, y3], 3), 3, "2026-10-27");
    expect(r.map((s) => [s.semester, s.year, s.inYear])).toEqual([[1, 1, 1], [2, 1, 2], [3, 2, 1], [4, 2, 2], [5, 3, 1]]);
  });

  it("adds the earlier semester of the student's own year when only the later one is listed", () => {
    const only6 = { year: 3, semesters: [{ semester: 6, startDate: "2027-01-05", endDate: "2027-05-30" }] };
    const r = mentoringSemesterRanges(withEarlierYears([only6], 3), 3, "2027-02-01");
    expect(r.filter((s) => s.year === 3).map((s) => [s.semester, s.inYear])).toEqual([[5, 1], [6, 2]]);
  });
});
