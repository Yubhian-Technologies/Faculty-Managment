import {
  IdCard, GraduationCap, Briefcase, FlaskConical,
  Users, Wallet, FileQuestion, BookOpen,
  type LucideIcon,
} from "lucide-react";

// One tile/route per module a faculty member's details are broken into on the
// View pages (see FacultyProfileHub / FacultyProfileModuleContent) - lets HOD/
// Principal/self-profile open e.g. just "Research & Innovation" on its own
// page instead of scrolling one long form. Keys double as the URL segment
// (/hod/faculty/[id]/[module]).
export type ProfileModuleKey =
  | "personal" | "qualification" | "experience" | "research"
  | "mentorship" | "financial" | "others" | "teaching-load";

export interface ProfileModuleDef {
  key: ProfileModuleKey;
  // What the tab is called everywhere a person reads it (tile, page title, "Edit ..." title, export and completion
  // sections). Display text only: the key above is what URLs and stored/exported data use, and no faculty record
  // stores a tab name - renaming a tab here never touches a stored value.
  label: string;
  icon: LucideIcon;
  // The line shown under the tab's heading, saying what belongs in it. Absent = no line.
  description?: string;
  // What to call the tab's details in a sentence ("Please enter the academic details here"). Display text only.
  emptyNoun: string;
}

export const PROFILE_MODULES: Record<ProfileModuleKey, ProfileModuleDef> = {
  personal: {
    key: "personal", label: "Personal & Contact Information", icon: IdCard, emptyNoun: "personal & contact",
    description: "Personal information, contact details, address, emergency contact and all personal details.",
  },
  qualification: {
    key: "qualification", label: "Academic Qualification", icon: GraduationCap, emptyNoun: "academic",
    description: "Degrees, specializations, institutions, year of passing, certifications, and additional qualifications.",
  },
  experience: {
    key: "experience", label: "Professional Experience & Employment", icon: Briefcase, emptyNoun: "professional experience",
    description: "Previous employment, teaching and academic, industry and research experience, service history, and years of experience.",
  },
  research: {
    key: "research", label: "Research, Innovation & Publications", icon: FlaskConical, emptyNoun: "research",
    description: "Research projects, publications, patents, consultancy, funded projects, copyrights, and innovation activities.",
  },
  mentorship: {
    key: "mentorship", label: "Professional Development & Certifications", icon: Users, emptyNoun: "professional development",
    description: "FDPs, workshops, conferences, training programmes, certifications, and professional memberships.",
  },
  financial: {
    key: "financial", label: "Compensation & Benefits", icon: Wallet, emptyNoun: "compensation",
    description: "Salary structure, increments, promotions, financial rewards, incentives, gratuity, and other employment benefits. Access is restricted to authorized personnel.",
  },
  others: { key: "others", label: "Additional Information & Institutional Contributions", icon: FileQuestion, emptyNoun: "additional information" },
  "teaching-load": {
    key: "teaching-load", label: "Teaching & Academic Responsibilities", icon: BookOpen, emptyNoun: "teaching",
    description: "Courses handled, subjects, timetable, teaching hours, workload allocation, mentoring responsibilities, and academic duties.",
  },
};

// Self-profile modules a person never edits themselves - financial standing
// is administratively controlled, teaching load is assigned by HOD/Principal,
// and research publications are R&D-managed (see the Research & Innovation
// feature).
export const SELF_EDIT_DISABLED_MODULES: ProfileModuleKey[] = ["financial", "teaching-load", "research"];

// Teaching Load is the one exception: the current assignments stay HOD/Principal-assigned, but a person with a real
// facultyMembers record enters their own Previous Teaching Assignments there (PATCH /api/college/faculty/me). Used by
// the shared My Profile pages only - every other page keeps reading SELF_EDIT_DISABLED_MODULES as before.
export function isSelfEditDisabled(moduleKey: ProfileModuleKey, hasFacultyRecord: boolean): boolean {
  if (moduleKey === "teaching-load") return !hasFacultyRecord;
  return SELF_EDIT_DISABLED_MODULES.includes(moduleKey);
}

// Faculty is teaching staff only now (Technical designations - Lab
// Assistant/Programmer/System Administrator/Network Engineer - live in the
// Supporting Staff module instead, see src/lib/designations/config.ts), so
// every FacultyMember gets the full Academic Profile module set.
export function getFacultyProfileModules(
  opts: { hideFinancialModule?: boolean; excludeModules?: ProfileModuleKey[] } = {}
): ProfileModuleDef[] {
  const keys: ProfileModuleKey[] = [
    "personal", "qualification", "experience", "research", "mentorship",
    ...(opts.hideFinancialModule ? [] : (["financial"] as ProfileModuleKey[])),
    "teaching-load", "others",
  ];
  return keys.filter((k) => !opts.excludeModules?.includes(k)).map((k) => PROFILE_MODULES[k]);
}
