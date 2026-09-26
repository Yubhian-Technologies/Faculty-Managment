import { departmentRunsOwnSections } from "@/lib/college/academicStructure";

export interface FacultyDepartmentOption {
  id: string;
  name: string;
  code: string;
}

/** The shape these helpers read - a superset of what every picker fetches. */
export interface FacultyDepartmentLike {
  id: string;
  name: string;
  code: string;
  parentDepartmentId?: string;
  hasSubDepartments?: boolean;
  parentRunsOwnSections?: boolean;
}

/**
 * Whether a faculty member can actually be filed under this department.
 *
 * A department that is split into sub-departments and has the "This department
 * also has its own sections/students" toggle OFF
 * (Department.parentRunsOwnSections === false) only ORGANISES its
 * sub-departments - its students and sections live in them, and so do its
 * faculty. Offering it was offering a destination that is not one: the same
 * reason api/college/sections POST rejects it outright as a section's
 * department.
 *
 * Only excluded once it actually HAS a sub-department here. A parent with the
 * toggle off but nothing beneath it yet is still the only place to put anyone,
 * and removing it would leave the picker empty - the same guard the Add
 * Section branch list applies (see replaceNoOwnSectionsParents).
 */
export function isFacultyDestination(
  department: FacultyDepartmentLike,
  allDepartments: FacultyDepartmentLike[]
): boolean {
  if (departmentRunsOwnSections(department)) return true;
  return !allDepartments.some((d) => d.parentDepartmentId === department.id);
}

// Every department a manual "Add Faculty" or bulk Faculty import may file a
// new faculty member's `department` under: the department(s) this HOD heads,
// plus any true sub-department beneath them (Department.parentDepartmentId).
// Client-safe mirror of canHodManageFacultyDepartment's server-side rule
// (src/lib/departments/scope.ts) - deliberately excludes a managed/grouped
// branch, which stays that branch's own dedicated HOD's roster to add
// faculty to, not this HOD's, even though this HOD has full edit rights over
// its sections/subjects/timetable.
//
// Without this, a parent HOD who owns exactly one department but also runs
// sub-departments had no way at all to add/import a faculty member into a
// sub-department - useMyDepartments only ever returns the department(s) this
// login directly heads, never the children beneath them.
export function facultyDepartmentOptions(
  allDepartments: FacultyDepartmentLike[],
  ownDepartmentNames: string[]
): FacultyDepartmentOption[] {
  const byName = new Map(allDepartments.map((d) => [d.name, d]));
  const ownIds = new Set(
    ownDepartmentNames.map((n) => byName.get(n)?.id).filter((v): v is string => !!v)
  );
  const seen = new Set<string>();
  const out: FacultyDepartmentOption[] = [];
  for (const name of ownDepartmentNames) {
    const d = byName.get(name);
    // A parent that organises its sub-departments and runs nothing of its own
    // is skipped here, not below - its children are still offered by the loop
    // that follows, so a parent HOD keeps somewhere to file people.
    if (d && !seen.has(d.id) && isFacultyDestination(d, allDepartments)) {
      seen.add(d.id);
      out.push({ id: d.id, name: d.name, code: d.code });
    }
  }
  for (const d of allDepartments) {
    if (d.parentDepartmentId && ownIds.has(d.parentDepartmentId) && !seen.has(d.id)) {
      seen.add(d.id);
      out.push({ id: d.id, name: d.name, code: d.code });
    }
  }
  return out;
}
