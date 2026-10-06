import { describe, expect, it } from "vitest";
import { countsFromJoining, effectiveJoiningDate } from "./joiningDate";
import { countFullyAbsentDays, indexSessions, tallyStudentBySubject } from "./counting";
import { buildNotPostedIndex } from "./expectedPeriods";

const session = (date: string, mark: string) => ({ subjectId: "s1", date, entries: [{ studentId: "a", status: mark }] });

describe("effectiveJoiningDate", () => {
  it("prefers Date of Joining, falls back to Date of Admission, else none", () => {
    expect(effectiveJoiningDate({ dateOfJoining: "2026-07-10", dateOfAdmission: "2026-06-01" })).toBe("2026-07-10");
    expect(effectiveJoiningDate({ dateOfAdmission: "2026-06-01" })).toBe("2026-06-01");
    expect(effectiveJoiningDate({ dateOfJoining: "10-07-2026" })).toBeUndefined();
    expect(effectiveJoiningDate({})).toBeUndefined();
  });
  it("counts every session when there is no joining date", () => {
    expect(countsFromJoining("2020-01-01", undefined)).toBe(true);
    expect(countsFromJoining("2026-07-09", "2026-07-10")).toBe(false);
    expect(countsFromJoining("2026-07-10", "2026-07-10")).toBe(true);
  });
});

describe("joining date cutoff", () => {
  const sessions = indexSessions([session("2026-07-01", "ABSENT"), session("2026-07-10", "PRESENT"), session("2026-07-11", "ABSENT")]);
  it("leaves out sessions before the joining date", () => {
    expect(tallyStudentBySubject(sessions, "a").get("s1")).toEqual({ held: 3, attended: 1 });
    expect(tallyStudentBySubject(sessions, "a", "2026-07-10").get("s1")).toEqual({ held: 2, attended: 1 });
    expect(countFullyAbsentDays(sessions, "a", "2026-07-10")).toBe(1);
  });
  it("owes a late joiner only the not-posted periods from their joining date", () => {
    const idx = buildNotPostedIndex([
      { key: "1", date: "2026-07-01", periodNumber: 1, assignmentId: "x", subjectId: "s1" },
      { key: "2", date: "2026-07-12", periodNumber: 1, assignmentId: "x", subjectId: "s1" },
    ]);
    expect(idx.forStudent({}).get("s1")).toBe(2);
    expect(idx.forStudent({ joinedOn: "2026-07-10" }).get("s1")).toBe(1);
  });
});
