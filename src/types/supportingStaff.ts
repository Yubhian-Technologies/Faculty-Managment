import type { Timestamp } from "firebase/firestore";
import type { DegreeDetail, EmploymentType, FacultyStatus, TrainingEntry, AwardEntry } from "./core";

// ─── Supporting Staff (Technical + Non-Technical) ──────────────────────────────
// NBA/AICTE-compliant profile module for non-teaching staff, parallel to the
// Teaching Faculty module (FacultyMember/FacultyProfileFields in core.ts).

export type SupportingStaffCategory = "TECHNICAL" | "NON_TECHNICAL";
export const STAFF_CATEGORY_LABELS: Record<SupportingStaffCategory, string> = {
  TECHNICAL: "Technical Staff",
  NON_TECHNICAL: "Non-Technical Staff",
};

export type TechnicalStaffDesignation =
  | "LAB_ASSISTANT" | "PROGRAMMER" | "SYSTEM_ADMINISTRATOR" | "NETWORK_ENGINEER" | "OTHER";
export type NonTechnicalStaffDesignation =
  | "OFFICE_STAFF" | "ACCOUNTANT" | "LIBRARIAN" | "CLERK" | "ATTENDER" | "OFFICE_ASSISTANT" | "OTHER";
export type SupportingStaffDesignation = TechnicalStaffDesignation | NonTechnicalStaffDesignation;

export const TECHNICAL_STAFF_DESIGNATION_LABELS: Record<TechnicalStaffDesignation, string> = {
  LAB_ASSISTANT: "Lab Assistant",
  PROGRAMMER: "Programmer",
  SYSTEM_ADMINISTRATOR: "System Administrator",
  NETWORK_ENGINEER: "Network Engineer",
  OTHER: "Other",
};
export const NON_TECHNICAL_STAFF_DESIGNATION_LABELS: Record<NonTechnicalStaffDesignation, string> = {
  OFFICE_STAFF: "Office Staff",
  ACCOUNTANT: "Accountant",
  LIBRARIAN: "Librarian",
  CLERK: "Clerk",
  ATTENDER: "Attender",
  OFFICE_ASSISTANT: "Office Assistant",
  OTHER: "Other",
};

// Reuses DegreeDetail's exact shape (degreeAndBranch/universityOrInstitute/
// percentageOrDivision/yearOfCompletion/certificateUrl), +level to label SSC/
// Intermediate/Degree/PG (Non-Technical) vs Diploma/B.Tech-B.Sc/M.Tech-MCA
// (Technical) within one repeating list.
export interface StaffQualification extends DegreeDetail {
  level: string;
}

export interface TechnicalSkillsProfile {
  programmingLanguages: string[];
  operatingSystems: string[];
  networking: string[];
  databases: string[];
  cloud: string[];
  hardware: string[];
  softwareTools: string[];
}

export type TechnicalResponsibility =
  | "LAB_MAINTENANCE" | "EQUIPMENT_MAINTENANCE" | "SOFTWARE_INSTALLATION"
  | "NETWORK_ADMINISTRATION" | "LAB_STOCK_MANAGEMENT" | "STUDENT_SUPPORT"
  | "PRACTICAL_SESSION_ASSISTANCE" | "OTHER";
export const TECHNICAL_RESPONSIBILITY_LABELS: Record<TechnicalResponsibility, string> = {
  LAB_MAINTENANCE: "Lab Maintenance",
  EQUIPMENT_MAINTENANCE: "Equipment Maintenance",
  SOFTWARE_INSTALLATION: "Software Installation",
  NETWORK_ADMINISTRATION: "Network Administration",
  LAB_STOCK_MANAGEMENT: "Lab Stock Maintenance",
  STUDENT_SUPPORT: "Student Support",
  PRACTICAL_SESSION_ASSISTANCE: "Practical Sessions",
  OTHER: "Other",
};

export type VendorCertification =
  | "CISCO" | "MICROSOFT" | "AWS" | "REDHAT" | "ORACLE" | "GOOGLE" | "VMWARE" | "OTHER";
export const VENDOR_CERTIFICATION_LABELS: Record<VendorCertification, string> = {
  CISCO: "Cisco", MICROSOFT: "Microsoft", AWS: "AWS", REDHAT: "RedHat",
  ORACLE: "Oracle", GOOGLE: "Google", VMWARE: "VMware", OTHER: "Other",
};
export interface VendorCertificationEntry {
  vendor: VendorCertification;
  otherVendorName?: string; // when vendor === "OTHER"
  certificationName: string;
  year?: number;
  certificateUrl?: string;
}

export interface TechnicalProfile {
  skills: TechnicalSkillsProfile;
  responsibilities: TechnicalResponsibility[];
  otherResponsibility?: string;
  certifications: VendorCertificationEntry[];
  training: TrainingEntry[]; // reused from core.ts
  innovationsAndAutomation?: string;
  achievements: AwardEntry[]; // reused from core.ts
}

export type NonTechnicalResponsibility =
  | "OFFICE_ADMINISTRATION" | "STUDENT_RECORDS" | "FILE_MANAGEMENT" | "ACCOUNTS"
  | "PURCHASE" | "EXAMINATION_WORK" | "ADMISSION_SUPPORT" | "DOCUMENTATION" | "OTHER";
export const NON_TECHNICAL_RESPONSIBILITY_LABELS: Record<NonTechnicalResponsibility, string> = {
  OFFICE_ADMINISTRATION: "Office Administration",
  STUDENT_RECORDS: "Student Records",
  FILE_MANAGEMENT: "File Management",
  ACCOUNTS: "Accounts",
  PURCHASE: "Purchase",
  EXAMINATION_WORK: "Examination Work",
  ADMISSION_SUPPORT: "Admission Support",
  DOCUMENTATION: "Documentation",
  OTHER: "Other",
};

export type ComputerSkill = "MS_OFFICE" | "ERP" | "EXCEL" | "EMAIL" | "DOCUMENT_MANAGEMENT" | "OTHER";
export const COMPUTER_SKILL_LABELS: Record<ComputerSkill, string> = {
  MS_OFFICE: "MS Office", ERP: "ERP", EXCEL: "Excel", EMAIL: "Email",
  DOCUMENT_MANAGEMENT: "Document Management", OTHER: "Other",
};

export interface NonTechnicalProfile {
  responsibilities: NonTechnicalResponsibility[];
  otherResponsibility?: string;
  computerSkills: ComputerSkill[];
  otherComputerSkill?: string;
  typingSpeedWpm?: number;
  training: TrainingEntry[]; // ADMINISTRATIVE/ERP/OFFICE_AUTOMATION types apply here
  achievements: AwardEntry[];
}

// One collection, staffCategory discriminant, two mutually-exclusive optional
// sub-profiles gated by staffCategory. Technical and Non-Technical share
// Personal/Qualification/Employment/Training/Awards/Documents scaffolding but
// have entirely disjoint skills/responsibilities/certification vocabularies —
// two optional sub-objects avoids duplicating the shared scaffolding across
// two full parallel collections while keeping irrelevant fields off any record.
export interface SupportingStaffProfileFields {
  qualifications: StaffQualification[];
  technicalProfile?: TechnicalProfile;       // present iff staffCategory === "TECHNICAL"
  nonTechnicalProfile?: NonTechnicalProfile; // present iff staffCategory === "NON_TECHNICAL"
  otherInformation?: string;
}

export interface SupportingStaffMember {
  id: string;
  collegeId: string;
  department?: string; // optional — unlike FacultyMember.department, many roles are college-wide
  employeeId: string;
  name: string;
  email?: string;
  phone?: string;
  staffCategory: SupportingStaffCategory;
  designation: SupportingStaffDesignation;
  otherDesignationTitle?: string; // when designation === "OTHER"
  experienceYears: number;
  joiningDate: Timestamp;
  employmentType: EmploymentType; // reused from core.ts
  status: FacultyStatus;          // reused from core.ts (INTERVIEW_DONE simply unused here)
  userUid?: string;
  profilePhotoUrl?: string;
  collegeEmail: string; // login username

  // Personal/statutory fields — same shape as FacultyMember's own block, built
  // via the shared buildPersonalDetailsUpdate() helper server-side.
  gender?: "Male" | "Female" | "Other";
  dateOfBirth?: Timestamp;
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  ratificationStatus?: "Ratified" | "Not Ratified";
  ratificationDate?: Timestamp;
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;
  bloodGroup?: string;

  supportingStaffProfile?: SupportingStaffProfileFields;

  joiningLetterUrl?: string;
  appointmentLetterUrl?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// GET list response shape — mirrors FacultyMember list items (no accessLevel
// tagging needed here since Supporting Staff has no sub-department concept).
export type SupportingStaffListItem = SupportingStaffMember;
