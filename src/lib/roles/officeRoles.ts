import type { CollegeType, UserRole } from "@/types/core";

// "Internal office" roles - each its own login/dashboard (see
// ROLE_DASHBOARD_PATHS in core.ts), college-scoped, one holder each for
// LIBRARY/EXAM_CELL/WEBMASTER (see COLLEGE_SINGLETON_ROLES in
// api/college/users/route.ts). Which of these actually exist varies by
// institution type: AICTE/NBA-accredited Engineering/Pharmacy/Dental
// colleges have the full administrative structure (Dean system, IQAC, T&P,
// R&D, Placement, Library, Exam Cell, Webmaster); UGC-affiliated Degree
// colleges typically only need accreditation (IQAC) and exam/placement
// administration; Polytechnic (Diploma-level) colleges are simpler still
// (Placement + Library only); School has none of these at all.
const ALL_OFFICE_ROLES: UserRole[] = [
  "DEAN", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL", "WEBMASTER",
];

const OFFICE_ROLES_BY_COLLEGE_TYPE: Record<CollegeType, UserRole[]> = {
  ENGINEERING: ALL_OFFICE_ROLES,
  PHARMACY: ALL_OFFICE_ROLES,
  DENTAL: ALL_OFFICE_ROLES,
  DEGREE: ["IQAC_COORDINATOR", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL"],
  POLYTECHNIC: ["PLACEMENT_DEPT", "LIBRARY"],
  SCHOOL: [],
};

export function getCreatableOfficeRoles(type: CollegeType | undefined | null): UserRole[] {
  return type ? OFFICE_ROLES_BY_COLLEGE_TYPE[type] : ALL_OFFICE_ROLES;
}
