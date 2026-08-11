import {
  IdCard, GraduationCap, ClipboardList, Award, FileQuestion,
  type LucideIcon,
} from "lucide-react";

// One tile/route per module a Supporting Staff member's details are broken
// into on the View pages (see SupportingStaffProfileHub /
// SupportingStaffModuleContent) - parallel to src/lib/faculty/profileModules.ts
// but scoped to SupportingStaffProfileFields' simpler shape (no research/
// grants/mentorship/financial/teaching-load - those are Faculty-only). Keys
// double as the URL segment (/college-office/non-technical-staff/[id]/[module]).
export type SupportingStaffModuleKey = "personal" | "qualifications" | "responsibilities" | "training" | "achievements" | "others";

export interface SupportingStaffModuleDef {
  key: SupportingStaffModuleKey;
  label: string;
  icon: LucideIcon;
}

export const SUPPORTING_STAFF_MODULES: Record<SupportingStaffModuleKey, SupportingStaffModuleDef> = {
  personal: { key: "personal", label: "Personal Details", icon: IdCard },
  qualifications: { key: "qualifications", label: "Qualifications", icon: GraduationCap },
  responsibilities: { key: "responsibilities", label: "Job Responsibilities & Skills", icon: ClipboardList },
  training: { key: "training", label: "Training", icon: FileQuestion },
  achievements: { key: "achievements", label: "Awards & Recognition", icon: Award },
  others: { key: "others", label: "Others", icon: FileQuestion },
};

export function getSupportingStaffProfileModules(): SupportingStaffModuleDef[] {
  return Object.values(SUPPORTING_STAFF_MODULES);
}
