import { DESIGNATION_LABELS } from "@/types/core";
import { NON_TECHNICAL_STAFF_DESIGNATION_LABELS } from "@/types/supportingStaff";
import type { CollegeType } from "@/types/core";

// Designation lists used to be hardcoded here, one fixed set per college
// type. They're now each college's own admin-curated Designation Catalog
// (colleges/{id}/designations - see DesignationCatalogCard and
// api/college/designations) - Faculty/Supporting Staff Add-Edit, CSV import,
// and the Hiring role picker all read that collection directly instead of
// anything in this file. What's left here is legacy-record support: display
// labels for the old fixed codes, the Technical/Non-Technical split flag
// (still a real per-college-type distinction, not a list), and the
// per-college-type lists used ONLY by scripts/backfill-designation-
// catalog.mjs to seed an existing college's catalog once at rollout.

const ENGINEERING_TEACHING = ["PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "LECTURER", "VISITING_FACULTY", "ADJUNCT_FACULTY"];
// The 4 old FacultyMember "technical" designation codes, now Supporting
// Staff designations - exported on their own (not just folded into
// ENGINEERING_SUPPORTING) so callers that need to recognize a not-yet-
// migrated FacultyMember record (see scripts/migrate-technical-staff-to-
// supporting-staff.mjs, api/leave/profiles/route.ts, api/college/faculty/
// route.ts, and lib/leave/identity.ts/periodCoverage.ts's teaching-staff
// classification) can check against exactly these 4, regardless of college type.
export const LEGACY_TECHNICAL_DESIGNATIONS = ["LAB_ASSISTANT", "PROGRAMMER", "SYSTEM_ADMINISTRATOR", "NETWORK_ENGINEER"];
const ENGINEERING_SUPPORTING = ["OFFICE_STAFF", "ACCOUNTANT", "CLERK", "ATTENDER", "OFFICE_ASSISTANT", ...LEGACY_TECHNICAL_DESIGNATIONS];

const TEACHING_DESIGNATIONS_BY_COLLEGE_TYPE: Record<CollegeType, string[]> = {
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
// supporting list is deliberately NOT split (see hasSupportingStaffSplit).
const DEGREE_TECHNICAL_DESIGNATIONS = ["Lab Assistant", "Programmer", "Network I/C"];
const POLYTECHNIC_TECHNICAL_DESIGNATIONS = [
  "Sr. Lab Technician", "Drawing Assistant", "Lab Assistant", "Programmer", "Computer Operator", "Lab Technician",
];

const SUPPORTING_DESIGNATIONS_BY_COLLEGE_TYPE: Record<CollegeType, string[]> = {
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
// value itself - an admin-curated Designation Catalog value is already
// human-readable and displays as-is. Used anywhere a designation is shown
// without already knowing which category it's from (e.g. Salary Structures,
// Budget line items, which cover both).
export function designationLabel(value: string | undefined | null): string {
  if (!value) return "-";
  return DESIGNATION_LABELS[value] ?? NON_TECHNICAL_STAFF_DESIGNATION_LABELS[value] ?? value;
}

// Whether this college type has a real Technical (HOD-owned) / Non-Technical
// (Principal/College Office-owned) Supporting Staff split at all - School
// deliberately doesn't (its supporting staff is centrally managed,
// non-technical only). Not about list *content* any more (that's the
// Designation Catalog's category field), just whether the split exists -
// still gates HOD's Supporting Staff nav entry/module (Sidebar.tsx,
// hod/supporting-staff/*, api/college/supporting-staff*).
export function hasSupportingStaffSplit(type: CollegeType | undefined | null): boolean {
  return type !== "SCHOOL";
}

// ─── Rollout-only: seeds scripts/backfill-designation-catalog.mjs ───────────
// The per-college-type lists an EXISTING college's Designation Catalog is
// seeded from once at rollout, so it isn't stranded with an empty dropdown
// the moment admin-curated designations ship. A college created afterward
// gets no seed data - empty catalog, admin builds it from scratch, same as
// Course Catalog. Not read anywhere else in the running app.
export function getTeachingDesignations(type: CollegeType | undefined | null): string[] {
  return TEACHING_DESIGNATIONS_BY_COLLEGE_TYPE[type as CollegeType] ?? ENGINEERING_TEACHING;
}

export function getHodTechnicalDesignations(type: CollegeType | undefined | null): string[] {
  switch (type) {
    case "DEGREE": return DEGREE_TECHNICAL_DESIGNATIONS;
    case "POLYTECHNIC": return POLYTECHNIC_TECHNICAL_DESIGNATIONS;
    case "SCHOOL": return [];
    default: return LEGACY_TECHNICAL_DESIGNATIONS; // ENGINEERING/PHARMACY/DENTAL and any unset type
  }
}

// The full supporting list with the HOD-owned Technical subset removed, so a
// Technical designation (e.g. Lab Assistant, Programmer) never seeds into
// the Non-Technical catalog. School has no Technical subset, so it keeps the
// full list unchanged.
export function getNonTechnicalDesignations(type: CollegeType | undefined | null): string[] {
  const technical = getHodTechnicalDesignations(type);
  if (technical.length === 0) return SUPPORTING_DESIGNATIONS_BY_COLLEGE_TYPE[type as CollegeType] ?? ENGINEERING_SUPPORTING;
  return (SUPPORTING_DESIGNATIONS_BY_COLLEGE_TYPE[type as CollegeType] ?? ENGINEERING_SUPPORTING).filter((d) => !technical.includes(d));
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

