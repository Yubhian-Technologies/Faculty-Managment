import { matchesCurrentSemester } from "@/lib/college/semester";

/**
 * Which of the loaded teaching assignments the "Current Assignments" list shows
 * for the filters the page was loaded with - the same course / year / semester /
 * sub-department the Unstaffed Subjects and Assign Faculty panels already use,
 * so all three agree.
 *
 * Display only. Nothing is removed or changed: the full list stays loaded, the
 * page can show it again, and exports / delete-all keep using it.
 *
 *  - course: an assignment stores the course of its own SECTION, which for a
 *    shared first year is a branch's Course doc, so it is matched against every
 *    course-doc id of the programme (the group), as the gap finder does.
 *  - semester: the same leniency used everywhere (`matchesCurrentSemester`) - an
 *    assignment with no semester is never hidden.
 *  - sub-department: an assignment stores its section's department, so the pick
 *    stands for the department names it rolls up to (see departmentPickNames).
 *    `null` = no sub-department picked.
 */
export interface AssignmentViewFilter {
  courseIds: Set<string>;
  year: number;
  semester: number | null;
  departmentNames: Set<string> | null;
}

export function assignmentsForFilter<
  A extends { courseId?: string; year?: number | null; department?: string; timetableSemester?: number | null }
>(assignments: A[], f: AssignmentViewFilter): A[] {
  return assignments.filter((a) => {
    if (!a.courseId || !f.courseIds.has(a.courseId)) return false;
    if (Number(a.year) !== f.year) return false;
    if (!matchesCurrentSemester(a.timetableSemester, f.semester)) return false;
    if (f.departmentNames && !f.departmentNames.has((a.department ?? "").trim())) return false;
    return true;
  });
}
