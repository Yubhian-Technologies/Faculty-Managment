import { findBranchManager, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import { canHodManageFacultyDepartment, type HodDepartmentScope } from "@/lib/departments/scope";
import { cachedCollectionDocs } from "@/lib/firestore/sharedReads";
import type { Course } from "@/types";

// WHO MAY DO WHAT with a branch's year - one rule, used by every gate.
//
// A branch (CSE) has an OWNER: the HOD who heads it (or the parent of a sub-department). A shared
// year (CSE Year 1) is additionally MAINTAINED by a manager department (Basic Science - Maths), which
// runs that year's day-to-day teaching: its teaching assignments and its timetable.
//
//                              owner (CSE HOD)            maintainer (BS-Maths HOD)
//   students, sections         write, every year          view the years it maintains
//   subjects                   (assigned by Academics)    view / use
//   teaching assignments       write, years nobody        write, the years it maintains
//   + timetable                maintains; VIEW otherwise
//   anything else              view                       nothing
//
// "Maintains" = the manager actually teaches that year for this course (findBranchManager). A manager
// never gets a year it doesn't run, and being GROUPED under a manager never takes a year away from the
// branch's own HOD for things other than teaching. These functions are pure; the loader below reads
// the (cached) department and course lists for a route.

type Dept = DepartmentYearRow & { name?: string };

export type YearScope = Pick<HodDepartmentScope, "ownDepartmentNames" | "childDepartmentNames">;

/** True when the HOD heads `departmentName` itself, or heads the parent of that sub-department. */
export function headsDepartment(scope: YearScope, departmentName: string): boolean {
  if (!departmentName) return false;
  return scope.ownDepartmentNames.includes(departmentName) || scope.childDepartmentNames.includes(departmentName);
}

/** The department that maintains (`branch`, `year`) - its manager, if that manager teaches the year - else null. */
export function yearMaintainer(departments: Dept[], branch: string, year: number, catalogId?: string): string | null {
  const manager = findBranchManager(departments, branch, catalogId);
  if (!manager) return null;
  const name = manager.department.name ?? "";
  if (!name || name === branch) return null;
  return manager.years.includes(Number(year)) ? name : null;
}

/** May this HOD create/remove teaching assignments and edit the timetable of (`branch`, `year`)? */
export function canHodWriteTeaching(scope: YearScope, departments: Dept[], branch: string, year: number, catalogId?: string): boolean {
  const maintainer = yearMaintainer(departments, branch, year, catalogId);
  return maintainer ? headsDepartment(scope, maintainer) : headsDepartment(scope, branch);
}

/** May this HOD change the students and sections of `branch`? Only whoever heads it - never the maintainer. */
export function canHodWriteRoster(scope: YearScope, branch: string): boolean {
  return headsDepartment(scope, branch);
}

/** May this HOD read (`branch`, `year`)? The owner always; the maintainer for the years it maintains. */
export function canHodViewYear(scope: YearScope, departments: Dept[], branch: string, year: number, catalogId?: string): boolean {
  if (headsDepartment(scope, branch)) return true;
  const maintainer = yearMaintainer(departments, branch, year, catalogId);
  return !!maintainer && headsDepartment(scope, maintainer);
}

/** The sentence a refused teaching write should carry: says who does it instead. */
export function teachingWriteRefusal(scope: YearScope, departments: Dept[], branch: string, year: number, catalogId?: string): string {
  const maintainer = yearMaintainer(departments, branch, year, catalogId);
  if (maintainer && !headsDepartment(scope, maintainer)) {
    return `Year ${year} of ${branch} is maintained by ${maintainer}: they create its teaching assignments and timetable. You can view it.`;
  }
  return `Year ${year} of ${branch} isn't in your department.`;
}

/**
 * Whether an HOD may manage an existing teaching assignment: they write teaching for its (department, year), or
 * - the older exception - the assigned faculty member is theirs (lent to another department's section).
 */
export async function canHodManageTeachingAssignment(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  scope: HodDepartmentScope,
  departments: Dept[],
  assignment: { department?: string; year?: number; courseId?: string; facultyId?: string },
  catalogId?: string,
): Promise<boolean> {
  if (canHodWriteTeaching(scope, departments, assignment.department ?? "", assignment.year ?? -1, catalogId)) return true;
  if (!assignment.facultyId) return false;
  const snap = await db.collection("colleges").doc(collegeId).collection("facultyMembers").doc(assignment.facultyId).get();
  return canHodManageFacultyDepartment(scope, (snap.data() as { department?: string } | undefined)?.department ?? "");
}

/** What a route needs to apply the rules above to a section: the department list and each course's catalog entry. */
export async function loadYearGate(db: FirebaseFirestore.Firestore, collegeId: string, scope: HodDepartmentScope) {
  const [deptDocs, courseDocs] = await Promise.all([
    cachedCollectionDocs(db, collegeId, "departments"),
    cachedCollectionDocs(db, collegeId, "courses"),
  ]);
  const departments = deptDocs.map((d) => ({ id: d.id, ...(d.data() as object) })) as Dept[];
  const catalogOf = new Map(courseDocs.map((d) => [d.id, (d.data() as Pick<Course, "catalogId">).catalogId]));
  const catalog = (courseId?: string) => (courseId ? catalogOf.get(courseId) : undefined);
  return {
    departments,
    catalogOf: catalog,
    teachingWrite: (branch: string, year: number, courseId?: string) => canHodWriteTeaching(scope, departments, branch, year, catalog(courseId)),
    teachingRefusal: (branch: string, year: number, courseId?: string) => teachingWriteRefusal(scope, departments, branch, year, catalog(courseId)),
    rosterWrite: (branch: string) => canHodWriteRoster(scope, branch),
    view: (branch: string, year: number, courseId?: string) => canHodViewYear(scope, departments, branch, year, catalog(courseId)),
    manageAssignment: (assignment: { department?: string; year?: number; courseId?: string; facultyId?: string }) =>
      canHodManageTeachingAssignment(db, collegeId, scope, departments, assignment, catalog(assignment.courseId)),
  };
}
