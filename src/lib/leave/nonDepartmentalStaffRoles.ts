import type { UserRole } from "@/types";

// College-wide roles that never belong to a department, so they'd otherwise
// never appear in any department's leave register. Each gets its own card/
// register on the Principal Leave History page (see resolveStaffReportRoster
// in reportRoster.ts) rather than being lumped into one combined list -
// display order below is what the cards/tabs use.
// No firebase-admin import here (unlike reportRoster.ts) so client pages can
// import this list directly without pulling the admin SDK into the bundle.
export const NON_DEPARTMENTAL_STAFF_ROLES: UserRole[] = [
  "VICE_PRINCIPAL", "COLLEGE_OFFICE", "COLLEGE_STAFF", "DEAN",
  "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "LIBRARY", "EXAM_CELL", "WEBMASTER",
];
