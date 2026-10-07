import { describe, it, expect } from "vitest";
import { inheritedTimingCourseId } from "@/lib/timetable/sharedYearTiming";
import type { Course, Department } from "@/types";

const dept = (id: string, name: string, extra: Partial<Department> = {}) =>
  ({ id, name, ...extra }) as Department & { id: string };
const course = (id: string, departmentId: string, catalogId = "btech") =>
  ({ id, departmentId, catalogId }) as Pick<Course, "id" | "departmentId" | "catalogId">;

describe("inheritedTimingCourseId - sub-department takes its main department's timing", () => {
  const departments = [
    dept("main", "BASIC SCIENCE"),
    dept("sub", "BASIC SCIENCE MATHS", { parentDepartmentId: "main" }),
    dept("other", "MECH"),
  ];
  const courses = [course("c-main", "main"), course("c-sub", "sub"), course("c-other", "other")];

  it("falls back to the parent's course of the same programme", () => {
    expect(inheritedTimingCourseId(courses[1], 1, departments, courses)).toBe("c-main");
  });

  it("gives nothing to a department with no parent and no manager", () => {
    expect(inheritedTimingCourseId(courses[2], 1, departments, courses)).toBeNull();
  });

  it("never matches a different programme", () => {
    const mixed = [course("c-main", "main", "mtech"), course("c-sub", "sub", "btech")];
    expect(inheritedTimingCourseId(mixed[1], 1, departments, mixed)).toBeNull();
  });
});
