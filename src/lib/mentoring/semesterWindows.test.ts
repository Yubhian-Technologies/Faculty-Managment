import { describe, expect, it } from "vitest";
import {
  academicYearLabel,
  academicYearOfStudentYear,
  dayBefore,
  monthYearLabel,
  semesterHeading,
  windowEndOfSemester,
  windowUpToMid,
} from "./semesterWindows";

describe("windowUpToMid", () => {
  it("counts from the semester start to the day before the mid begins", () => {
    expect(windowUpToMid("2025-06-16", "2025-11-15", "2025-08-20", "2025-10-01")).toEqual({ from: "2025-06-16", to: "2025-08-19" });
  });
  it("is empty until the mid has begun, or when none is scheduled", () => {
    expect(windowUpToMid("2025-06-16", "2025-11-15", "2025-08-20", "2025-08-10")).toBeNull();
    expect(windowUpToMid("2025-06-16", "2025-11-15", null, "2025-10-01")).toBeNull();
  });
  it("never reaches past the semester's end or today", () => {
    expect(windowUpToMid("2025-06-16", "2025-08-01", "2025-08-20", "2025-10-01")).toEqual({ from: "2025-06-16", to: "2025-08-01" });
  });
  it("is empty when the mid starts on the semester's first day", () => {
    expect(windowUpToMid("2025-06-16", "2025-11-15", "2025-06-16", "2025-10-01")).toBeNull();
  });
  it("steps back over a month boundary", () => {
    expect(dayBefore("2025-03-01")).toBe("2025-02-28");
    expect(dayBefore("2024-03-01")).toBe("2024-02-29");
  });
});

describe("windowEndOfSemester", () => {
  it("runs to today while the semester is on, and to its end once over", () => {
    expect(windowEndOfSemester("2025-06-16", "2025-11-15", "2025-09-01")).toEqual({ from: "2025-06-16", to: "2025-09-01" });
    expect(windowEndOfSemester("2025-06-16", "2025-11-15", "2026-02-01")).toEqual({ from: "2025-06-16", to: "2025-11-15" });
  });
  it("is empty before the semester starts", () => {
    expect(windowEndOfSemester("2025-06-16", "2025-11-15", "2025-06-01")).toBeNull();
  });
});

describe("academic year of a student's year", () => {
  it("labels a session the way academic sessions are kept", () => {
    expect(academicYearLabel(2025)).toBe("2025-26");
    expect(academicYearLabel(2099)).toBe("2099-00");
  });
  it("counts from the admission batch", () => {
    expect(academicYearOfStudentYear("2023-2027", "Regular", 3)).toBe("2025-26");
    expect(academicYearOfStudentYear("2023-27", undefined, 1)).toBe("2023-24");
  });
  it("starts a lateral entrant's batch at Year 2", () => {
    expect(academicYearOfStudentYear("2025-2028", "Lateral", 2)).toBe("2025-26");
    expect(academicYearOfStudentYear("2025-2028", "Lateral", 3)).toBe("2026-27");
  });
  it("is unknown without a batch", () => {
    expect(academicYearOfStudentYear("", "Regular", 2)).toBeNull();
  });
});

describe("labels", () => {
  it("words a semester the way the booklet does", () => {
    expect(semesterHeading(3, 2, 1)).toBe("II Year I Semester");
    expect(semesterHeading(8, 4, 2)).toBe("IV Year II Semester");
    expect(semesterHeading(5, null, null)).toBe("Semester 5");
  });
  it("writes a supplementary sitting as mm-yy (IST)", () => {
    expect(monthYearLabel(Date.UTC(2026, 2, 5, 12))).toBe("03-26");
    // 20:00 UTC on 31 Mar is already 1 Apr in IST.
    expect(monthYearLabel(Date.UTC(2026, 2, 31, 20))).toBe("04-26");
    expect(monthYearLabel(0)).toBe("");
  });
});
