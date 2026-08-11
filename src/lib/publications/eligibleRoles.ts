import type { UserRole } from "@/types";

// Which college-scoped roles can plausibly own a research publication -
// every academic/administrative staff role, but never STUDENT, CLASS_LEADER,
// or the finance-only roles (ACCOUNTS, FINANCE). Shared by the Add
// Publication staff picker (r-and-d/publications/new/page.tsx) and the API
// route's own read-access list (api/college/publications/route.ts) so the
// two can't drift apart.
// Faculty first (the overwhelming majority of publications), then
// department/college leadership, then the internal-office roles.
export const PUBLICATION_ELIGIBLE_ROLES: UserRole[] = [
  "PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL", "R_AND_D",
  "DEAN", "IQAC_COORDINATOR", "T_AND_P", "PLACEMENT_DEPT",
  "LIBRARY", "EXAM_CELL", "WEBMASTER", "COLLEGE_OFFICE", "COLLEGE_STAFF",
];
