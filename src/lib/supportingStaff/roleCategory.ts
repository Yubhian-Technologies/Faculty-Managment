import type { SupportingStaffCategory } from "@/types";

// Technical staff are owned per-department by an HOD; Non-Technical staff are
// owned college-wide by College Office. Each role is locked to its own
// category everywhere Supporting Staff records are read or written —
// SUPER_ADMIN is unrestricted (omitted from this map).
export const SUPPORTING_STAFF_ROLE_CATEGORY: Partial<Record<string, SupportingStaffCategory>> = {
  HOD: "TECHNICAL",
  COLLEGE_OFFICE: "NON_TECHNICAL",
};

export function supportingStaffCategoryLabel(category: SupportingStaffCategory): string {
  return category === "TECHNICAL" ? "Technical" : "Non-Technical";
}
