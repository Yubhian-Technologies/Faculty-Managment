import { describe, expect, it } from "vitest";
import { indexSessions, tallyStudent, tallyStudentBySubject } from "./counting";

const session = (subjectId: string, marks: Record<string, "PRESENT" | "ABSENT">) => ({
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
});
