import { sectionMatchesDepartmentFilter } from "@/lib/departments/hodScope";
import type { Department, Section } from "@/types";

// The sections a college-wide department view (Principal / VP / Office drill-down) lists for ONE department.
//
// A section is filed under the real BRANCH for every year, never under the shared-year manager that runs
// its first year (e.g. "Basic Science - Chemistry" manages CSE/CSBS: their year-1 sections are filed under
// CSE/CSBS). So a manager can't be found by a name match alone - it needs the year-aware owner rule that the
// Sections tab already uses (sectionMatchesDepartmentFilter).
//
// This is the UNION of the original match (the department's own id / name / code - a branch's full roster,
// every year) and the year-aware match, so nothing that was listed before can drop out; it only adds the
// years a manager actually teaches, for each course the Principal assigned it (catalogId-aware).
export function sectionsOfDepartment<S extends Pick<Section, "department" | "year" | "courseId">>(
  dept: Pick<Department, "id" | "name" | "code">,
  allDepartments: Department[],
  sections: S[],
  catalogIdByCourseId: ReadonlyMap<string, string | undefined>
): S[] {
  return sections.filter((s) => {
    const sid = (s as S & { departmentId?: string }).departmentId;
    if (sid ? sid === dept.id : s.department === dept.name || s.department === dept.code) return true;
    return sectionMatchesDepartmentFilter(allDepartments, dept.name, s.department, s.year, catalogIdByCourseId.get(s.courseId));
  });
}
