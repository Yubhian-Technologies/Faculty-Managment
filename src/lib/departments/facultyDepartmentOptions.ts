export interface FacultyDepartmentOption {
  id: string;
  name: string;
  code: string;
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
  allDepartments: { id: string; name: string; code: string; parentDepartmentId?: string }[],
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
    if (d && !seen.has(d.id)) {
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
