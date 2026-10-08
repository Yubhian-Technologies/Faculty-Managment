import { describe, it, expect } from "vitest";
import { sectionAssignmentScope } from "@/lib/departments/sectionAssignmentScope";
import type { Course, Department } from "@/types";

const dept = (id: string, name: string, extra: Partial<Department> = {}) => ({ id, name, ...extra }) as Department & { id: string };
const course = (id: string, departmentId: string, catalogId: string | null = "btech") =>
  ({ id, departmentId, ...(catalogId ? { catalogId } : {}) }) as Pick<Course, "id" | "departmentId" | "catalogId">;

// BS-ENGLISH (a sub-department of BASIC SCIENCE) runs the shared first year of CE; CE's own HOD runs
// years 2-4. Assign to Semester files the first-year subjects under BS-ENGLISH, not under CE.
const departments = [
  dept("bs", "BASIC SCIENCE", { hasSubDepartments: true, assignedYears: [1] }),
  dept("bse", "BS-ENGLISH", { parentDepartmentId: "bs", managedDepartments: ["CE"] }),
  dept("ce", "CE", { assignedYears: [2, 3, 4] }),
  dept("mech", "MECH", { assignedYears: [1, 2, 3, 4] }),
];
const courses = [
  course("c-bs", "bs"),
  course("c-ce", "ce"),
  course("c-mech", "mech"),
  course("c-ce-mtech", "ce", "mtech"),
];

describe("sectionAssignmentScope", () => {
  it("a managed branch's shared year is governed by the managing department as well as its own", () => {
    const s = sectionAssignmentScope({ department: "CE", courseId: "c-ce", year: 1 }, courses, departments);
    expect(s.departmentIds.sort()).toEqual(["bse", "ce"]);
  });

  it("the branch's own later years do not borrow the manager's assignments", () => {
    for (const year of [2, 3, 4]) {
      expect(sectionAssignmentScope({ department: "CE", courseId: "c-ce", year }, courses, departments).departmentIds).toEqual(["ce"]);
    }
  });

  it("covers every Course doc of the same programme (each department keeps its own) and no other programme", () => {
    const s = sectionAssignmentScope({ department: "CE", courseId: "c-ce", year: 1 }, courses, departments);
    expect(s.courseIds.sort()).toEqual(["c-bs", "c-ce", "c-mech"]);
    expect(s.courseIds).not.toContain("c-ce-mtech");
  });

  it("an ordinary department is just itself", () => {
    const s = sectionAssignmentScope({ department: "MECH", courseId: "c-mech", year: 1 }, courses, departments);
    expect(s.departmentIds).toEqual(["mech"]);
  });

  it("a department with sub-departments includes them", () => {
    const s = sectionAssignmentScope({ department: "BASIC SCIENCE", courseId: "c-bs", year: 1 }, courses, departments);
    expect(s.departmentIds.sort()).toEqual(["bs", "bse"]);
  });

  it("a course with no catalogId only knows itself", () => {
    const s = sectionAssignmentScope({ department: "CE", courseId: "c-x", year: 1 }, [course("c-x", "ce", null)], departments);
    expect(s.courseIds).toEqual(["c-x"]);
  });

  it("missing data gives empty lists instead of throwing", () => {
    expect(sectionAssignmentScope({ department: "NOPE", year: 1 }, courses, departments)).toEqual({ departmentIds: [], courseIds: [] });
    expect(sectionAssignmentScope({ department: "CE", courseId: "gone", year: 1 }, courses, departments).departmentIds).toEqual(["ce"]);
  });
});
