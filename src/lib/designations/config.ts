import { DESIGNATION_LABELS } from "@/types/core";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS } from "@/types/supportingStaff";
import type { CollegeType } from "@/types/core";

// Per-college-type designation catalogues, shared by Faculty add/edit,
// Supporting Staff add/edit, the hiring Vacancy Request role picker, and CSV
// import/export - one source of truth instead of each surface hardcoding its
// own list. Every list is presented with an "Other" free-text escape hatch
// by the components that render it (see DesignationOptions.tsx and the
// Vacancy Request form), matching the pattern the hiring module already used
// before this existed.
//
// ENGINEERING/PHARMACY/DENTAL deliberately keep the exact original
// Designation codes (uppercase, e.g. "PROFESSOR") rather than switching to
// human-readable strings like the other types - every existing FacultyMember/
// SupportingStaffMember record, and the AICTE cadre-ratio report
// (src/app/api/college/faculty-requirement/route.ts, which matches on these
// literal codes), depends on them staying exactly as they are. Display uses
// DESIGNATION_LABELS/SUPPORTING_DESIGNATION_LABELS to show them as words.

const ENGINEERING_TEACHING = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "LECTURER", "VISITING_FACULTY", "ADJUNCT_FACULTY"];
// The 4 old FacultyMember "technical" designation codes, now Supporting
// Staff designations - exported on their own (not just folded into
// ENGINEERING_SUPPORTING) so callers that need to recognize a not-yet-
// migrated FacultyMember record (see scripts/migrate-technical-staff-to-
// supporting-staff.mjs and api/leave/profiles/route.ts) can check against
// exactly these 4, regardless of college type.
export const LEGACY_TECHNICAL_DESIGNATIONS = ["LAB_ASSISTANT", "PROGRAMMER", "SYSTEM_ADMINISTRATOR", "NETWORK_ENGINEER"];
const ENGINEERING_SUPPORTING = ["OFFICE_STAFF", "ACCOUNTANT", "CLERK", "ATTENDER", "OFFICE_ASSISTANT", ...LEGACY_TECHNICAL_DESIGNATIONS];

export const TEACHING_DESIGNATIONS_BY_COLLEGE_TYPE: Record<CollegeType, string[]> = {
  ENGINEERING: ENGINEERING_TEACHING,
  PHARMACY: ENGINEERING_TEACHING,
  DENTAL: ENGINEERING_TEACHING,
  DEGREE: [
    "Principal", "Vice Principal", "Controller of Examinations", "Deputy Controller of Examinations",
    "Head of the Department", "Associate Professor", "Assistant Professor", "Teaching Assistant",
  ],
  POLYTECHNIC: ["Principal", "HOD", "Senior Lecturer", "Lecturer"],
  SCHOOL: [
    "Principal", "Vice-Principal", "HOD", "PGT", "TGT", "PRT",
    "Librarian", "Physical Education", "Art & Craft", "Drawing",
  ],
};

// Degree and Polytechnic's supporting-staff lists (below) split into a
// Technical half (HOD, department-scoped) and a Non-Technical half
// (Principal/College Office, college-wide) - same ownership model as
// Engineering/Pharmacy/Dental's LEGACY_TECHNICAL_DESIGNATIONS split. School's
// supporting list is deliberately NOT split (see getHodTechnicalDesignations).
const DEGREE_TECHNICAL_DESIGNATIONS = ["Lab Assistant", "Programmer", "Network I/C"];
const DEGREE_NON_TECHNICAL_DESIGNATIONS = ["AO", "Sr. Office Assistant", "Office Assistant", "Librarian", "Trainee"];
const POLYTECHNIC_TECHNICAL_DESIGNATIONS = [
  "Sr. Lab Technician", "Drawing Assistant", "Lab Assistant", "Programmer", "Computer Operator", "Lab Technician",
];
const POLYTECHNIC_NON_TECHNICAL_DESIGNATIONS = ["A.A.O", "Office Assistant", "Attender"];

export const SUPPORTING_DESIGNATIONS_BY_COLLEGE_TYPE: Record<CollegeType, string[]> = {
  ENGINEERING: ENGINEERING_SUPPORTING,
  PHARMACY: ENGINEERING_SUPPORTING,
  DENTAL: ENGINEERING_SUPPORTING,
  DEGREE: ["AO", "Sr. Office Assistant", "Office Assistant", "Lab Assistant", "Librarian", "Programmer", "Network I/C", "Trainee"],
  POLYTECHNIC: [
    "A.A.O", "Sr. Lab Technician", "Drawing Assistant", "Lab Assistant", "Programmer",
    "Office Assistant", "Computer Operator", "Lab Technician", "Attender",
  ],
  SCHOOL: ["AO", "AAO", "Clerk cum Typist & Record Assistant", "Vehicle In-Charge", "Stores In-Charge", "Receptionist", "Office Assistant"],
};

// Display label for any designation value, teaching or supporting - checks
// both legacy code maps (DESIGNATION_LABELS for the ENGINEERING_TEACHING
// codes, NON_TECHNICAL_STAFF_DESIGNATION_LABELS for ENGINEERING_SUPPORTING's,
// extended to cover the 4 migrated-in technical ones), falling back to the
// value itself - every new per-college-type value is already human-readable
// and displays as-is. Used anywhere a designation is shown without already
// knowing which category it's from (e.g. Salary Structures, Budget line
// items, which cover both).
export function designationLabel(value: string | undefined | null): string {
  if (!value) return "-";
  return DESIGNATION_LABELS[value] ?? NON_TECHNICAL_STAFF_DESIGNATION_LABELS[value] ?? value;
}

export function getTeachingDesignations(type: CollegeType | undefined | null): string[] {
  return TEACHING_DESIGNATIONS_BY_COLLEGE_TYPE[type as CollegeType] ?? ENGINEERING_TEACHING;
}

export function getSupportingDesignations(type: CollegeType | undefined | null): string[] {
  return SUPPORTING_DESIGNATIONS_BY_COLLEGE_TYPE[type as CollegeType] ?? ENGINEERING_SUPPORTING;
}

// Designation picklist for HOD's Technical Staff (Supporting Staff
// staffCategory "TECHNICAL"), and its Non-Technical counterpart for
// College Office/Principal. Engineering/Pharmacy/Dental and Degree/
// Polytechnic all have a real split; School deliberately does not (its
// supporting staff is centrally managed, non-technical only - see
// hasSupportingStaffSplit, which HOD's Sidebar nav entry keys off of).
export function hasSupportingStaffSplit(type: CollegeType | undefined | null): boolean {
  return type !== "SCHOOL";
}

export function getHodTechnicalDesignations(type: CollegeType | undefined | null): string[] {
  switch (type) {
    case "DEGREE": return DEGREE_TECHNICAL_DESIGNATIONS;
    case "POLYTECHNIC": return POLYTECHNIC_TECHNICAL_DESIGNATIONS;
    case "SCHOOL": return [];
    default: return LEGACY_TECHNICAL_DESIGNATIONS; // ENGINEERING/PHARMACY/DENTAL and any unset type
  }
}

// Non-Technical designation picklist for College Office/Principal. Only
// Degree/Polytechnic actually differ from the full supporting list (their
// Technical subset above is excluded) - every other type's Non-Technical
// picker keeps showing the same full list it always has (see
// getSupportingDesignations - untouched, still used by Salary Structures
// and CSV-import label lookups regardless of category).
export function getNonTechnicalDesignations(type: CollegeType | undefined | null): string[] {
  switch (type) {
    case "DEGREE": return DEGREE_NON_TECHNICAL_DESIGNATIONS;
    case "POLYTECHNIC": return POLYTECHNIC_NON_TECHNICAL_DESIGNATIONS;
    default: return getSupportingDesignations(type);
  }
}

// A record created before this per-college-type system existed - including
// one at a Degree/Polytechnic/School college, which had no choice but to use
// these codes back then - should still be recognized as teaching/supporting
// regardless of what its college's type resolves to today.
export function isTeachingDesignation(designation: string, type: CollegeType | undefined | null): boolean {
  return ENGINEERING_TEACHING.includes(designation) || getTeachingDesignations(type).includes(designation);
}
export function isSupportingDesignation(designation: string, type: CollegeType | undefined | null): boolean {
  return ENGINEERING_SUPPORTING.includes(designation) || getSupportingDesignations(type).includes(designation);
}

// School-only qualification levels (see AcademicProfileFields.tsx / SupportingStaffProfileFields.tsx) -
// every other college type keeps today's UG/PG/PhD form (Faculty) or this
// generic level list (Supporting Staff, via QualificationsFields' Level
// dropdown - unchanged from what used to be a free-text placeholder hint).
export const SCHOOL_TEACHING_QUALIFICATION_LEVELS = [
  "SSC", "Intermediate", "Degree", "Post Graduation", "BEd/DEd/MEd", "APTET", "CTET", "Pandit Training Certificate",
];
export const SCHOOL_SUPPORTING_QUALIFICATION_LEVELS = [
  "SSC", "Intermediate", "Degree", "Post Graduation", "Technical Certificate",
];
const DEFAULT_SUPPORTING_QUALIFICATION_LEVELS = ["SSC", "Intermediate", "Degree", "Post Graduation", "Diploma"];

export function getSupportingQualificationLevels(type: CollegeType | undefined | null): string[] {
  return type === "SCHOOL" ? SCHOOL_SUPPORTING_QUALIFICATION_LEVELS : DEFAULT_SUPPORTING_QUALIFICATION_LEVELS;
}
