import { describe, expect, it } from "vitest";
import { computeAcademicsHealth, type HealthInput } from "./health";

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  catalog: [{ id: "cat1", name: "B.Tech", regulations: ["R20"] }],
  courses: [{ id: "c1", name: "B.Tech", departmentName: "CSE", catalogId: "cat1", durationYears: 2 }],
  yearsWithSemesters: new Map([["c1", new Set([1, 2])]]),
  subjects: [],
  instances: [],
  ...over,
});
const codes = (i: HealthInput) => computeAcademicsHealth(i).map((x) => x.code);

describe("computeAcademicsHealth", () => {
  it("a clean curriculum has no issues", () => {
    const i = base({
      subjects: [{ id: "s1", code: "A1", name: "One", courseId: "c1", regulation: "R20" }],
      instances: [{ id: "s1_cse_1", subjectId: "s1", subjectCode: "A1", subjectName: "One", regulation: "R20" }],
    });
    expect(computeAcademicsHealth(i)).toEqual([]);
  });

  it("flags a catalog course with no regulation and years with no semesters", () => {
    const r = computeAcademicsHealth(base({ catalog: [{ id: "cat1", name: "B.Tech", regulations: [] }], yearsWithSemesters: new Map([["c1", new Set([1])]]) }));
    expect(r.map((x) => x.code)).toEqual(["COURSE_NO_REGULATION", "YEAR_NO_SEMESTERS"]);
    expect(r[1].items[0]).toBe("B.Tech (CSE): year 2");
  });

  it("finds duplicate code / name across sibling departments' Course docs of one catalog course", () => {
    const i = base({
      courses: [{ id: "c1", name: "B.Tech", catalogId: "cat1", durationYears: 1 }, { id: "c2", name: "B.Tech", catalogId: "cat1", durationYears: 1 }],
      yearsWithSemesters: new Map([["c1", new Set([1])], ["c2", new Set([1])]]),
      subjects: [
        { id: "s1", code: "A1", name: "Maths", courseId: "c1", regulation: "R20" },
        { id: "s2", code: "a1", name: "maths", courseId: "c2", regulation: "R20" },
        { id: "s3", code: "A1", name: "Maths", courseId: "c1", regulation: "R23" },
      ],
    });
    expect(codes(i)).toEqual(expect.arrayContaining(["DUPLICATE_CODE", "DUPLICATE_NAME"]));
    expect(computeAcademicsHealth(i).find((x) => x.code === "DUPLICATE_CODE")!.count).toBe(1); // R23 is a different group
  });

  it("finds a semester subject drifted from its master, or whose master is gone", () => {
    const i = base({
      subjects: [{ id: "s1", code: "A1", name: "One", courseId: "c1", regulation: "R20" }],
      instances: [
        { id: "i1", subjectId: "s1", subjectCode: "A9", subjectName: "One", regulation: "R20" },
        { id: "i2", subjectId: "gone", subjectCode: "Z", subjectName: "Z", regulation: "R20" },
      ],
    });
    const drift = computeAcademicsHealth(i).find((x) => x.code === "INSTANCE_DRIFT")!;
    expect(drift.count).toBe(2);
  });

  it("lists unassigned subjects as information, and unscoped ones as errors", () => {
    const r = computeAcademicsHealth(base({ subjects: [{ id: "s1", code: "A1", name: "One", courseId: "c1", regulation: "R20" }, { id: "s2", code: "B", name: "Two", courseId: "c1" }] }));
    expect(r.map((x) => [x.code, x.severity])).toEqual([["SUBJECT_UNSCOPED", "error"], ["SUBJECT_NOT_ASSIGNED", "info"]]);
  });
});
