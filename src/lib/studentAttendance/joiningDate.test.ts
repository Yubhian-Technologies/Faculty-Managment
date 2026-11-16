import { describe, expect, it } from "vitest";
import { countsFromJoining, effectiveJoiningDate, joinedBy } from "./joiningDate";
import { countFullyAbsentDays, indexSessions, tallyStudentBySubject } from "./counting";
import { buildNotPostedIndex } from "./expectedPeriods";

const session = (date: string, mark: string) => ({ subjectId: "s1", date, entries: [{ studentId: "a", status: mark }] });

describe("effectiveJoiningDate", () => {
  it("is the Date of Joining only - Date of Admission is not used", () => {
    expect(effectiveJoiningDate({ dateOfJoining: "2026-07-10" })).toBe("2026-07-10");
    expect(effectiveJoiningDate({ dateOfAdmission: "2026-06-01" } as never)).toBeUndefined();
    expect(effectiveJoiningDate({ dateOfJoining: "10-07-2026" })).toBeUndefined();
    expect(effectiveJoiningDate({})).toBeUndefined();
  });
  it("counts a class on or after the DOJ, not before; no DOJ counts every day", () => {
    expect(countsFromJoining("2020-01-01", undefined)).toBe(true);
    expect(countsFromJoining("2026-07-09", "2026-07-10")).toBe(false);
    expect(countsFromJoining("2026-07-10", "2026-07-10")).toBe(true);
    expect(joinedBy({ dateOfJoining: "2026-07-10" }, "2026-07-09")).toBe(false);
    expect(joinedBy({}, "2026-07-09")).toBe(true);
  });
});

describe("attendance from the Date of Joining", () => {
  const sessions = indexSessions([session("2026-07-01", "ABSENT"), session("2026-07-10", "PRESENT"), session("2026-07-11", "ABSENT")]);
  it("classes conducted and attended count from the DOJ", () => {
    expect(tallyStudentBySubject(sessions, "a").get("s1")).toEqual({ held: 3, attended: 1 });
    expect(tallyStudentBySubject(sessions, "a", "2026-07-10").get("s1")).toEqual({ held: 2, attended: 1 });
    expect(countFullyAbsentDays(sessions, "a", "2026-07-10")).toBe(1);
  });
  it("a late joiner does not owe not-posted periods from before the DOJ", () => {
    const idx = buildNotPostedIndex([
      { key: "1", date: "2026-07-01", periodNumber: 1, assignmentId: "x", subjectId: "s1" },
      { key: "2", date: "2026-07-12", periodNumber: 1, assignmentId: "x", subjectId: "s1" },
    ]);
    expect(idx.forStudent({}).get("s1")).toBe(2);
    expect(idx.forStudent({ joinedOn: "2026-07-10" }).get("s1")).toBe(1);
  });
});
