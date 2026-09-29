import { managerTeachingYears } from "@/lib/departments/managedBranches";
import { fedYears } from "@/lib/college/academicStructure";
import type { Course, Department } from "@/types";

// Which ordinal years (1..durationYears) `department` actually teaches
// `course` for - same resolution academics/teaching-assignments/page.tsx's
// own yearOptions and (before it was removed) assign-semester/page.tsx's
// yearOptions already use: the department's own (or inherited-from-parent)
// configured years first, falling back to "every year minus whatever a
// shared-year manager has fed away" only when genuinely unconfigured.
// Extracted here so Course Structure's pre-import validation (does the
// SELECTED department even teach this row's Year?) shares the exact same
// rule the Year dropdown elsewhere in Academics already enforces, rather
// than a second, possibly-drifting copy of it.
export function teachableYearsForDepartment(
  course: Pick<Course, "durationYears" | "catalogId">,
  department: Department,
  allDepartments: Department[]
): number[] {
  const courseYears = Array.from({ length: course.durationYears }, (_, i) => i + 1);
  const catalogId = course.catalogId;
  const assigned = managerTeachingYears(allDepartments, department, catalogId);
  return assigned.length > 0
    ? courseYears.filter((y) => assigned.includes(y))
    : courseYears.filter((y) => !new Set(fedYears(department, allDepartments, catalogId)).has(y));
}
