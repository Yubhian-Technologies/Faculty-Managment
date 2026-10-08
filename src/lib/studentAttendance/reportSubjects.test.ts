import { afterEach, describe, expect, it } from "vitest";
import { reportCountsAllSubjects, withSessionSubjects } from "./reportSubjects";

describe("withSessionSubjects", () => {
  const cur = [{ subjectId: "a", subjectName: "Algebra", subjectCode: "M1" }];

  it("keeps the current subjects first and appends retired ones from sessions", () => {
    const out = withSessionSubjects(cur, [
      { subjectId: "z", subjectName: "Zoology", subjectCode: "Z1" },
      { subjectId: "a", subjectName: "Algebra", subjectCode: "M1" },
      { subjectId: "b", subjectName: "Biology", subjectCode: "B1" },
      { subjectId: "b", subjectName: "Biology", subjectCode: "B1" },
    ]);
    expect(out.map((s) => s.subjectId)).toEqual(["a", "b", "z"]);
  });

  it("returns the current list unchanged when every session subject is current", () => {
    expect(withSessionSubjects(cur, [{ subjectId: "a" }])).toEqual(cur);
  });
});

describe("reportCountsAllSubjects", () => {
  afterEach(() => { delete process.env.ATTENDANCE_REPORT_ALL_SUBJECTS; });
  it("is off unless explicitly set to 1", () => {
    expect(reportCountsAllSubjects()).toBe(false);
    process.env.ATTENDANCE_REPORT_ALL_SUBJECTS = "1";
    expect(reportCountsAllSubjects()).toBe(true);
  });
});
