import { describe, expect, it } from "vitest";
import { indexSessions, tallyStudent, tallyStudentBySubject } from "./counting";

const session = (subjectId: string, marks: Record<string, "PRESENT" | "ABSENT" | "ON_DUTY">) => ({
  subjectId,
  entries: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
});

describe("student attendance counting", () => {
  it("counts every period of the same subject on the same day", () => {
    const s = indexSessions([
      session("LAB", { a: "PRESENT" }),
      session("LAB", { a: "PRESENT" }),
      session("LAB", { a: "ABSENT" }),
    ]);
    expect(tallyStudent(s, "a")).toEqual({ held: 3, attended: 2 });
  });

  it("ignores a lab batch session the student is not rostered on", () => {
    const s = indexSessions([
      session("LAB", { a: "PRESENT", b: "PRESENT" }), // batch 1
      session("LAB", { c: "ABSENT" }),                 // batch 2 - 'a' is not on it
    ]);
    expect(tallyStudent(s, "a")).toEqual({ held: 1, attended: 1 });
    expect(tallyStudent(s, "c")).toEqual({ held: 1, attended: 0 });
  });

  it("does not count sessions from before the student joined", () => {
    const s = indexSessions([session("M1", { a: "PRESENT" }), session("M1", { a: "PRESENT", late: "PRESENT" })]);
    expect(tallyStudent(s, "late")).toEqual({ held: 1, attended: 1 });
  });

  it("splits by subject", () => {
    const s = indexSessions([session("M1", { a: "PRESENT" }), session("P1", { a: "ABSENT" })]);
    const by = tallyStudentBySubject(s, "a");
    expect(by.get("M1")).toEqual({ held: 1, attended: 1 });
    expect(by.get("P1")).toEqual({ held: 1, attended: 0 });
  });

  it("a student on no session has zero held (no data), not zero percent", () => {
    expect(tallyStudent(indexSessions([session("M1", { a: "PRESENT" })]), "z")).toEqual({ held: 0, attended: 0 });
  });

  it("leaves an ON_DUTY period out of both held and attended", () => {
    const s = indexSessions([
      session("M1", { a: "PRESENT" }),
      session("M1", { a: "ON_DUTY" }),
      session("M1", { a: "ABSENT" }),
      session("M2", { a: "ON_DUTY" }),
    ]);
    // 3 real periods + 1 on duty: the on-duty one is simply not there.
    expect(tallyStudent(s, "a")).toEqual({ held: 2, attended: 1 });
    // A subject with only on-duty periods doesn't appear at all (no 0/0 row).
    expect(Array.from(tallyStudentBySubject(s, "a").keys())).toEqual(["M1"]);
    expect(tallyStudentBySubject(s, "a").get("M1")).toEqual({ held: 2, attended: 1 });
  });

  it("never lets on-duty periods move a percentage either way", () => {
    const withOd = indexSessions([session("M1", { a: "PRESENT" }), session("M1", { a: "ON_DUTY" }), session("M1", { a: "ON_DUTY" })]);
    const without = indexSessions([session("M1", { a: "PRESENT" })]);
    expect(tallyStudent(withOd, "a")).toEqual(tallyStudent(without, "a"));
  });

  // Edge case: a subject is reassigned mid-semester from one faculty to
  // another (old teachingAssignments doc deleted, new assignmentId created -
  // see syncTeachingAssignments.ts). CountableSession never carries
  // assignmentId, only subjectId - so the two faculty's sessions, despite
  // coming from two different assignment docs, roll up as ONE continuous
  // subject percentage with no gap and no manual merge step.
  it("a mid-semester faculty handover on the same subject stays one continuous tally", () => {
    const beforeMid = [session("MATHS", { a: "PRESENT" }), session("MATHS", { a: "ABSENT" })]; // faculty 1, assignment a1
    const afterMid = [session("MATHS", { a: "PRESENT" }), session("MATHS", { a: "PRESENT" })]; // faculty 2, assignment a2
    const s = indexSessions([...beforeMid, ...afterMid]);
    expect(tallyStudentBySubject(s, "a").get("MATHS")).toEqual({ held: 4, attended: 3 });
  });

  // Edge case (documents a KNOWN, currently-unenforced gap - see
  // student-attendance/route.ts's "duplicate-period" warn-only check): if two
  // different assignments both end up with a SUBMITTED session for the same
  // subject/section/calendar period (e.g. two faculty both assigned the same
  // subject in the same period, no batch split between them), each session is
  // still counted independently here because nothing upstream de-duplicates
  // by (date, periodNumber) - a single class period is double-counted as 2
  // held periods instead of 1. This test exists to make that behavior
  // explicit and fail loudly the day someone adds de-duplication without
  // updating this expectation.
  it("[KNOWN GAP] two faculty submitting the SAME subject/period both count - held is doubled", () => {
    const period = { date: "2026-10-07" };
    const facultyOneSession = { ...period, ...session("PHYSICS", { a: "PRESENT" }) }; // assignment a1
    const facultyTwoSession = { ...period, ...session("PHYSICS", { a: "ABSENT" }) }; // assignment a2, same calendar period
    const s = indexSessions([facultyOneSession, facultyTwoSession]);
    const tally = tallyStudentBySubject(s, "a").get("PHYSICS");
    // One calendar period actually happened; the tally currently reports two.
    expect(tally).toEqual({ held: 2, attended: 1 });
  });
});
