import {
  IdCard, GraduationCap, Briefcase, FlaskConical, HandCoins,
  Users, Wallet, FileQuestion, BookOpenCheck, BookOpen, FileText, Wrench,
  type LucideIcon,
} from "lucide-react";
import { TECHNICAL_STAFF_DESIGNATIONS } from "@/types";
import type { Designation } from "@/types";

// One tile/route per module a faculty member's details are broken into on the
// View pages (see FacultyProfileHub / FacultyProfileModuleContent) - lets HOD/
// Principal/self-profile open e.g. just "Research Publications" on its own
// page instead of scrolling one long form. Keys double as the URL segment
// (/hod/faculty/[id]/[module]).
export type ProfileModuleKey =
  | "personal" | "qualification" | "experience" | "research" | "grants"
  | "mentorship" | "financial" | "others" | "teaching-docs" | "teaching-load"
  | "technical" | "documents";

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
  "teaching-docs": { key: "teaching-docs", label: "Teaching Documentation", icon: BookOpenCheck },
  "teaching-load": { key: "teaching-load", label: "Teaching Load", icon: BookOpen },
  technical: { key: "technical", label: "Technical Profile", icon: Wrench },
  documents: { key: "documents", label: "Documents", icon: FileText },
};

// Self-profile modules a person never edits themselves - financial standing
// and documents are administratively controlled, teaching load is assigned
// by HOD/Principal, and research publications are R&D-managed (see the
// Research Publications feature).
export const SELF_EDIT_DISABLED_MODULES: ProfileModuleKey[] = ["financial", "teaching-load", "documents", "research"];

function isTechnicalDesignation(designation: Designation | string | undefined): boolean {
  return !!designation && (TECHNICAL_STAFF_DESIGNATIONS as string[]).includes(designation);
}

// designation is undefined for HOD/Principal/VP self-profiles (no FacultyMember
// record - see resolveEmployeeIdentity) - treated as non-technical, same as
// every other self-profile field on those accounts.
export function getFacultyProfileModules(
  designation: Designation | string | undefined,
  opts: { hideFinancialModule?: boolean; excludeModules?: ProfileModuleKey[] } = {}
): ProfileModuleDef[] {
  const keys: ProfileModuleKey[] = isTechnicalDesignation(designation)
    ? ["personal", "technical", "documents"]
    : [
        "personal", "qualification", "experience", "research", "grants", "mentorship",
        ...(opts.hideFinancialModule ? [] : (["financial"] as ProfileModuleKey[])),
        "others", "teaching-docs", "teaching-load", "documents",
      ];
  return keys.filter((k) => !opts.excludeModules?.includes(k)).map((k) => PROFILE_MODULES[k]);
}
