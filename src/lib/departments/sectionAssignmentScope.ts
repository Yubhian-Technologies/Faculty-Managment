import { inheritedAssignmentDepartmentId } from "@/lib/timetable/sharedYearTiming";
import type { Course, Department } from "@/types";

// Which SubjectSemesterAssignment rows (Assign to Semester) govern the subjects of ONE section.
//
// Assign to Semester files a subject under a (department, course, year, semester). For an
// ordinary department that is the section's own department. For a shared first year it is not:
// the subjects are assigned to the MANAGING department (e.g. BS-ENGLISH), never to each branch it
// feeds (CE), while the section itself belongs to the branch. Asking "which subjects are assigned
// to this section's department" therefore finds nothing for a managed branch's shared year, even
// though the subjects were assigned - the exact lookup teaching-assignments already corrects with
// inheritedAssignmentDepartmentId. This is the same rule, packaged for every caller that starts
// from a section.
//
// The branch's own later years never fall through to the manager (inheritedAssignmentDepartmentId
// only answers for years the manager actually teaches), so a missing year-3 assignment stays missing.

type DepartmentRow = Department & { id: string };
type CourseRow = Pick<Course, "id" | "departmentId" | "catalogId">;

export interface SectionAssignmentScope {
  /** Departments whose assignments count for this section: its own, the shared-year manager, and their sub-departments. */
  departmentIds: string[];
  /** The section's course and every other Course doc of the same programme (each department keeps its own). */
  courseIds: string[];
}

export function sectionAssignmentScope(
  section: { department: string; secondaryDepartment?: string; secondaryDepartments?: string[]; courseId?: string; year: number },
  courses: CourseRow[],
  departments: DepartmentRow[]
): SectionAssignmentScope {
  const own = departments.find((d) => d.name === section.department);
  const secDeptName = section.secondaryDepartment || section.secondaryDepartments?.[0];
  const secDept = secDeptName ? departments.find((d) => d.name === secDeptName) : undefined;
  const course = section.courseId ? courses.find((c) => c.id === section.courseId) : undefined;

  const roots = new Set<string>();
  if (own) roots.add(own.id);
  if (secDept) roots.add(secDept.id);

  if (own?.parentDepartmentId) roots.add(own.parentDepartmentId);
  if (secDept?.parentDepartmentId) roots.add(secDept.parentDepartmentId);

  if (course) {
    const manager = inheritedAssignmentDepartmentId(course, Number(section.year), departments);
    if (manager) roots.add(manager);
  }

  const departmentIds = new Set(roots);

  // Only expand parent departments to ALL sub-departments if NO specific sub-department was identified
  const hasSpecificSubDept = !!(own?.parentDepartmentId || secDept?.parentDepartmentId || (secDept && secDept.id !== own?.id));

  if (!hasSpecificSubDept) {
    for (const d of departments) {
      if (d.parentDepartmentId && roots.has(d.parentDepartmentId)) departmentIds.add(d.id);
    }
  }

  const courseIds = new Set<string>();
  if (section.courseId) courseIds.add(section.courseId);
  if (course?.catalogId) {
    for (const c of courses) if (c.catalogId === course.catalogId) courseIds.add(c.id);
  }
  return { departmentIds: [...departmentIds], courseIds: [...courseIds] };
}
