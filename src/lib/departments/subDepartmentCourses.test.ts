import { describe, expect, it } from "vitest";
import { resolveSubDepartmentCourses, filterSubDepartmentCourses } from "./subDepartmentCourses";
import type { Course } from "@/types";

// The worked example from the request: an AI department with two children -
// AIML runs both programmes, AIDS runs only the B.Tech.
const AI = "ai-dept";
const AIDS = "aids-dept";

function course(over: Partial<Course> & { id: string; departmentId: string }): Course {
  return {
    collegeId: "c1",
    name: "Bachelor of Technology",
    code: "BTECH",
    durationYears: 4,
    isActive: true,
    createdAt: new Date() as never,
    ...over,
  } as Course;
}

const parentBtech = course({ id: "p-btech", departmentId: AI, catalogId: "cat-btech" });
const parentMtech = course({
  id: "p-mtech", departmentId: AI, catalogId: "cat-mtech",
  name: "Masters of Technology", code: "MTECH", durationYears: 2,
});

describe("resolveSubDepartmentCourses", () => {
  it("inherits every parent course when the child has customised nothing", () => {
    const rows = resolveSubDepartmentCourses({ id: AIDS }, [parentBtech, parentMtech]);
    expect(rows.map((r) => r.course.code)).toEqual(["BTECH", "MTECH"]);
    expect(rows.every((r) => !r.isOwn)).toBe(true);
  });

  it("drops a removed course from the child without touching the parent's", () => {
    const rows = resolveSubDepartmentCourses(
      { id: AIDS, excludedCourseCatalogIds: ["cat-mtech"] },
      [parentBtech, parentMtech]
    );
    expect(rows.map((r) => r.course.code)).toEqual(["BTECH"]);
    // The parent's own list is unaffected - it was never filtered here.
    expect(parentMtech.departmentId).toBe(AI);
  });

  it("replaces an inherited course with the child's own copy, not both", () => {
    const ownBtech = course({ id: "aids-btech", departmentId: AIDS, catalogId: "cat-btech" });
    const rows = resolveSubDepartmentCourses({ id: AIDS }, [parentBtech, parentMtech, ownBtech]);
    expect(rows).toHaveLength(2);
    const btech = rows.find((r) => r.course.code === "BTECH");
    expect(btech?.course.id).toBe("aids-btech");
    expect(btech?.isOwn).toBe(true);
    expect(btech?.isCustomised).toBe(true);
  });

  it("keeps a course the child added that the parent doesn't offer", () => {
    const ownOnly = course({
      id: "aids-mba", departmentId: AIDS, catalogId: "cat-mba", name: "MBA", code: "MBA", durationYears: 2,
    });
    const rows = resolveSubDepartmentCourses({ id: AIDS }, [parentBtech, ownOnly]);
    expect(rows.map((r) => r.course.code)).toEqual(["BTECH", "MBA"]);
    expect(rows.find((r) => r.course.code === "MBA")?.isOwn).toBe(true);
  });

  it("lets an own doc win over a stale exclusion for the same catalogId", () => {
    const ownBtech = course({ id: "aids-btech", departmentId: AIDS, catalogId: "cat-btech" });
    const rows = resolveSubDepartmentCourses(
      { id: AIDS, excludedCourseCatalogIds: ["cat-btech"] },
      [parentBtech, ownBtech]
    );
    expect(rows.map((r) => r.course.id)).toEqual(["aids-btech"]);
  });

  it("always inherits a pre-catalog course, which has no key to record against", () => {
    const legacy = course({ id: "p-legacy", departmentId: AI, catalogId: undefined, name: "Legacy", code: "LEG" });
    const rows = resolveSubDepartmentCourses(
      { id: AIDS, excludedCourseCatalogIds: ["cat-btech"] },
      [parentBtech, legacy]
    );
    expect(rows.map((r) => r.course.code)).toEqual(["LEG"]);
  });

  it("sorts by name so the card order is stable", () => {
    const rows = resolveSubDepartmentCourses({ id: AIDS }, [parentMtech, parentBtech]);
    expect(rows.map((r) => r.course.name)).toEqual(["Bachelor of Technology", "Masters of Technology"]);
  });

  it("filterSubDepartmentCourses returns the same rows as plain courses", () => {
    const list = filterSubDepartmentCourses(
      { id: AIDS, excludedCourseCatalogIds: ["cat-mtech"] },
      [parentBtech, parentMtech]
    );
    expect(list.map((c) => c.code)).toEqual(["BTECH"]);
  });
});
