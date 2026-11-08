import { canHodEditDepartment, facultyManageableDepartmentNames, type HodDepartmentScope } from "@/lib/departments/scope";

/**
 * Which of `departments` (the ones reviewing a subject's bank / paper) this HOD reviews for - "" = none.
 * A Subject Department is matched only against the HOD's OWN department(s) and true sub-departments: coordinating
 * a branch's shared 1st-year sections (a managed branch, e.g. the English HOD over Civil / EEE / Mech) does not make
 * them that department's HOD for its subjects. With no Subject Department the reviewer is the branch, and the branch's
 * HOD - managed branches included - decides as before.
 */
export function reviewingDepartment(scope: HodDepartmentScope, departments: string[], bySubjectDepartment: boolean): string {
  if (!bySubjectDepartment) return departments.find((d) => canHodEditDepartment(scope, d)) ?? "";
  const own = new Set(facultyManageableDepartmentNames(scope));
  return departments.find((d) => own.has(d)) ?? "";
}
