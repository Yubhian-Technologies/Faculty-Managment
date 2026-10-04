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
});
