import { describe, expect, it } from "vitest";
import { timetableClassLine } from "./gridModel";

const base = { courseName: "Bachelor of Technology", departmentName: "Computer Science and Engineering" };

describe("timetableClassLine", () => {
  it("drops the owning department's prefix from a branch-picker section name", () => {
    expect(timetableClassLine({ ...base, year: 1, semesterLabel: "Sem 1-1", sectionName: "BSC-CSE-C" })).toBe("I B.Tech I Sem CSE C");
    expect(timetableClassLine({ ...base, year: 1, semesterLabel: "Sem 1-2", sectionName: "BSE-CIVIL-A" })).toBe("I B.Tech II Sem CIVIL A");
  });

  it("uses the semester within the year, not the year, from a 'year-semester' label", () => {
    expect(timetableClassLine({ ...base, year: 2, semesterLabel: "Sem 2-1", sectionName: "CSE-A" })).toBe("II B.Tech I Sem CSE A");
  });

  it("keeps two-part and bare section names", () => {
    expect(timetableClassLine({ ...base, year: 3, semesterLabel: "Sem 3-2", sectionName: "CSE-B" })).toBe("III B.Tech II Sem CSE B");
    expect(timetableClassLine({ ...base, year: 3, sectionName: "A" })).toBe("III B.Tech CSE A");
  });
});
