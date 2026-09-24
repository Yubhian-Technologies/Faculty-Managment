// Which location department(s) a location-scoped staff member (HR_ADMIN/
// ADMIN_OFFICE/ACCOUNTS/LOCATION_DEPT_HEAD) covers - single source of truth
// for the Add/Edit Staff forms' own logic and the Department detail page's
// "who's assigned here" list, so they can never disagree about the answer.
// Pure function, no Firestore/React - see FMSUser's own doc-comment
// (locationDeptId/locationDeptIds/allLocationDepts) in types/core.ts for the
// underlying field shapes this reads.
export interface LocationStaffCoverageFacts {
  role?: string;
  locationDeptId?: string; // LOCATION_DEPT_HEAD only - exactly one department
  locationDeptIds?: string[]; // HR_ADMIN/ADMIN_OFFICE/ACCOUNTS only
  allLocationDepts?: boolean; // HR_ADMIN/ADMIN_OFFICE/ACCOUNTS only
}

export function staffCoversLocationDept(staff: LocationStaffCoverageFacts, deptId: string): boolean {
  if (staff.role === "LOCATION_DEPT_HEAD") return staff.locationDeptId === deptId;
  if (staff.allLocationDepts) return true;
  return (staff.locationDeptIds ?? []).includes(deptId);
}
