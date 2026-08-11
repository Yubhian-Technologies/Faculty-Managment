import type { SupportingStaffCategory } from "@/types";
import { STAFF_CATEGORY_LABELS } from "@/types/supportingStaff";

// Supporting Staff has two owners: HOD manages Technical staff within their
// own department (Lab Assistant/Programmer/System Administrator/Network
// Engineer - see LEGACY_TECHNICAL_DESIGNATIONS in
// src/lib/designations/config.ts), College Office manages Non-Technical
// staff college-wide. This map drives GET's default category filter for
// roles that only ever see one category. SUPER_ADMIN is unrestricted
// (omitted from this map). PRINCIPAL/VICE_PRINCIPAL are deliberately NOT
// here - they need unfiltered GET (both categories) but a restricted POST,
// see canRolePostCategory below.
export const SUPPORTING_STAFF_ROLE_CATEGORY: Partial<Record<string, SupportingStaffCategory>> = {
  HOD: "TECHNICAL",
  COLLEGE_OFFICE: "NON_TECHNICAL",
};

// POST-only category permission - separate from SUPPORTING_STAFF_ROLE_CATEGORY
// because PRINCIPAL/VICE_PRINCIPAL need to create Non-Technical records (their
// GET stays unfiltered) but must never be allowed to create/edit Technical
// ones - that stays HOD's department-scoped domain.
export function canRolePostCategory(role: string, category: SupportingStaffCategory): boolean {
  if (role === "PRINCIPAL" || role === "VICE_PRINCIPAL") return category === "NON_TECHNICAL";
  const required = SUPPORTING_STAFF_ROLE_CATEGORY[role];
  return !required || required === category;
}

export function supportingStaffCategoryLabel(category: SupportingStaffCategory): string {
  return STAFF_CATEGORY_LABELS[category] ?? category;
}
