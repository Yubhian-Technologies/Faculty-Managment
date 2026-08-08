import type { SupportingStaffCategory } from "@/types";

// Non-Technical staff are owned college-wide by College Office - Technical
// staff moved to the Faculty module (see TECHNICAL_STAFF_DESIGNATIONS in
// core.ts), so Supporting Staff only ever has the one category now.
// SUPER_ADMIN is unrestricted (omitted from this map).
export const SUPPORTING_STAFF_ROLE_CATEGORY: Partial<Record<string, SupportingStaffCategory>> = {
  COLLEGE_OFFICE: "NON_TECHNICAL",
};

export function supportingStaffCategoryLabel(category: SupportingStaffCategory): string {
  return category === "NON_TECHNICAL" ? "Non-Technical" : category;
}
