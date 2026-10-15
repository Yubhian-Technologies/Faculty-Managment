import { describe, expect, it } from "vitest";
import { classifyRoll, parseRollNumbers, summarizeRollPlan } from "./rollAssignment";

describe("parseRollNumbers", () => {
  it("accepts lines, commas and spaces, upper-cases, and counts repeats", () => {
    expect(parseRollNumbers("24a91a0514\n24A91A0515, 24a91a0516  24A91A0514;")).toEqual({
      rolls: ["24A91A0514", "24A91A0515", "24A91A0516"],
      repeated: 1,
    });
  });
  it("ignores blanks", () => {
    expect(parseRollNumbers("  \n ,, ")).toEqual({ rolls: [], repeated: 0 });
  });
});

describe("classifyRoll", () => {
  const stu = { id: "s1", name: "A", section: "CE-A", year: 1 };
  it("assigns a free student", () => expect(classifyRoll("R1", stu, "m1", true).status).toBe("ASSIGN"));
  it("is fine when the student already has this mentor", () => expect(classifyRoll("R1", { ...stu, mentorUid: "m1" }, "m1", true).status).toBe("ALREADY_MENTEE"));
  it("refuses a student who has another mentor, naming the mentor", () => {
    const r = classifyRoll("R1", { ...stu, mentorUid: "m2", mentorName: "Dr X" }, "m1", true);
    expect(r.status).toBe("HAS_OTHER_MENTOR");
    expect(r.message).toContain("Dr X");
  });
  it("refuses an unknown roll, a graduated student and another department's student - without naming them", () => {
    expect(classifyRoll("R9", undefined, "m1", true).status).toBe("NOT_FOUND");
    expect(classifyRoll("R1", { ...stu, status: "GRADUATED" }, "m1", true).status).toBe("GRADUATED");
    const out = classifyRoll("R1", stu, "m1", false);
    expect(out.status).toBe("OUTSIDE_DEPARTMENT");
    expect(out.name).toBeUndefined();
  });
  it("counts only real problems", () => {
    const plan = [classifyRoll("A", stu, "m1", true), classifyRoll("B", { ...stu, mentorUid: "m1" }, "m1", true), classifyRoll("C", undefined, "m1", true)];
    expect(summarizeRollPlan(plan)).toEqual({ toAssign: 1, alreadyMentee: 1, problems: 1 });
  });
});
