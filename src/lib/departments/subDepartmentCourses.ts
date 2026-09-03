import type { Course, Department } from "@/types";

// How a sub-department's course list is built.
//
// A sub-department owns no Course doc of its own to begin with: it shows its
// parent's courses, resolved through getRelatedDepartmentIds (which adds the
// parent's id to the query). That default is right while every child runs the
// same programmes, and wrong as soon as they diverge - an AI department whose
// AIML child runs B.Tech and M.Tech while its AIDS child runs only the B.Tech.
//
// So a child can now do two things to the inherited list, each recorded
// against the child and invisible to its siblings:
//
//   customise  create its own Course doc for the same catalogId (see
//              POST /api/college/courses with copyFromCourseId). From then on
//              the child's own doc REPLACES the parent's in its list, and
//              carries its own timings and academic years for free - those are
//              keyed `${courseId}_year${n}`, and the copy is a different
//              courseId.
//   remove     record the catalogId in Department.excludedCourseCatalogIds.
//              The parent's Course doc is untouched, because every sibling
//              shares it.
//
// Both are keyed by catalogId rather than courseId so they survive the parent
// deleting and re-adding its own Course doc, the same reasoning as
// Department.courseScopes.
//
// A course with no catalogId (predates the catalog system) can be neither
// customised nor removed - there's no stable key to record the decision
// against - so it always inherits. The UI disables both actions for those.

export interface SubDepartmentCourse {
  course: Course;
  /** True when this row is the child's OWN doc rather than the parent's. */
  isOwn: boolean;
  /** True when an own doc is standing in for a parent course of the same catalogId. */
  isCustomised: boolean;
}

/**
 * The courses a sub-department actually offers, given everything the courses
 * query returned for it (its own docs plus its parent's).
 *
 * Order of precedence, per catalogId:
 *   1. the child's own doc, when it has one          -> shown, isOwn
 *   2. otherwise the parent's doc, unless excluded   -> shown, inherited
 *   3. excluded                                      -> not shown at all
 *
 * A child's own doc always wins over an exclusion for the same catalogId: the
 * two can only coexist if a course was removed and later customised, and the
 * live doc is the more specific, more recent statement of intent. Callers that
 * write an exclusion should clear any own doc first (and vice versa) so the
 * pair never persists, but this stays total rather than trusting that.
 */
export function resolveSubDepartmentCourses(
  subDepartment: Pick<Department, "id" | "excludedCourseCatalogIds">,
  courses: Course[]
): SubDepartmentCourse[] {
  const excluded = new Set(subDepartment.excludedCourseCatalogIds ?? []);
  const own = courses.filter((c) => c.departmentId === subDepartment.id);
  const ownCatalogIds = new Set(own.map((c) => c.catalogId).filter((v): v is string => !!v));

  const rows: SubDepartmentCourse[] = own.map((course) => ({
    course,
    isOwn: true,
    isCustomised: !!course.catalogId && ownCatalogIds.has(course.catalogId),
  }));

  for (const course of courses) {
    if (course.departmentId === subDepartment.id) continue;
    // An inherited course the child has replaced with its own doc, or removed.
    if (course.catalogId && ownCatalogIds.has(course.catalogId)) continue;
    if (course.catalogId && excluded.has(course.catalogId)) continue;
    rows.push({ course, isOwn: false, isCustomised: false });
  }

  return rows.sort((a, b) => a.course.name.localeCompare(b.course.name));
}

/**
 * The same filter for callers that only want the Course list (course pickers,
 * the API's response) and don't care which side of the tree each row came from.
 */
export function filterSubDepartmentCourses(
  subDepartment: Pick<Department, "id" | "excludedCourseCatalogIds">,
  courses: Course[]
): Course[] {
  return resolveSubDepartmentCourses(subDepartment, courses).map((r) => r.course);
}
