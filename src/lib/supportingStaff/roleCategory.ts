import type { SupportingStaffCategory } from "@/types";

// Supporting Staff is owned college-wide by College Office. staffCategory is
// a vestigial single-value field (technical vs. non-technical is now carried
// by `designation` alone - see src/lib/designations/config.ts) kept only
// because existing records/routes still read it. SUPER_ADMIN is unrestricted
// (omitted from this map).
export const SUPPORTING_STAFF_ROLE_CATEGORY: Partial<Record<string, SupportingStaffCategory>> = {
  COLLEGE_OFFICE: "NON_TECHNICAL",
};

export function supportingStaffCategoryLabel(category: SupportingStaffCategory): string {
  return category === "NON_TECHNICAL" ? "Non-Technical" : category;
}
