import {
  IdCard, GraduationCap, Briefcase, FlaskConical, HandCoins,
  Users, Wallet, FileQuestion, BookOpen,
  type LucideIcon,
} from "lucide-react";

// One tile/route per module a faculty member's details are broken into on the
// View pages (see FacultyProfileHub / FacultyProfileModuleContent) - lets HOD/
// Principal/self-profile open e.g. just "Research Publications" on its own
// page instead of scrolling one long form. Keys double as the URL segment
// (/hod/faculty/[id]/[module]).
export type ProfileModuleKey =
  | "personal" | "qualification" | "experience" | "research" | "grants"
  | "mentorship" | "financial" | "others" | "teaching-load";

export interface ProfileModuleDef {
  key: ProfileModuleKey;
  label: string;
  icon: LucideIcon;
}

export const PROFILE_MODULES: Record<ProfileModuleKey, ProfileModuleDef> = {
  personal: { key: "personal", label: "Personal Details", icon: IdCard },
  qualification: { key: "qualification", label: "Academic Qualification", icon: GraduationCap },
  experience: { key: "experience", label: "Previous Experience", icon: Briefcase },
  research: { key: "research", label: "Research Publications", icon: FlaskConical },
  grants: { key: "grants", label: "Grants, Consultancy & IP", icon: HandCoins },
  mentorship: { key: "mentorship", label: "Mentorship & Institutional Value", icon: Users },
  financial: { key: "financial", label: "Financial Standing", icon: Wallet },
  others: { key: "others", label: "Others", icon: FileQuestion },
  "teaching-load": { key: "teaching-load", label: "Teaching Load", icon: BookOpen },
};

// Self-profile modules a person never edits themselves - financial standing
// is administratively controlled, teaching load is assigned by HOD/Principal,
// and research publications are R&D-managed (see the Research Publications
// feature).
export const SELF_EDIT_DISABLED_MODULES: ProfileModuleKey[] = ["financial", "teaching-load", "research"];

// Faculty is teaching staff only now (Technical designations - Lab
// Assistant/Programmer/System Administrator/Network Engineer - live in the
// Supporting Staff module instead, see src/lib/designations/config.ts), so
// every FacultyMember gets the full Academic Profile module set.
export function getFacultyProfileModules(
  opts: { hideFinancialModule?: boolean; excludeModules?: ProfileModuleKey[] } = {}
): ProfileModuleDef[] {
  const keys: ProfileModuleKey[] = [
    "personal", "qualification", "experience", "research", "grants", "mentorship",
    ...(opts.hideFinancialModule ? [] : (["financial"] as ProfileModuleKey[])),
    "teaching-load", "others",
  ];
  return keys.filter((k) => !opts.excludeModules?.includes(k)).map((k) => PROFILE_MODULES[k]);
}
