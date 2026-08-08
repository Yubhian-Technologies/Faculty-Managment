import type { Timestamp } from "firebase/firestore";
import type { DegreeDetail, EmploymentType, FacultyStatus, TrainingEntry, AwardEntry, Religion, Caste } from "./core";

// ─── Supporting Staff (Non-Technical) ──────────────────────────────────────────
// NBA/AICTE-compliant profile module for non-teaching, non-technical staff,
// parallel to the Teaching Faculty module (FacultyMember/FacultyProfileFields
// in core.ts). Technical staff (Lab Assistant/Programmer/System Administrator/
// Network Engineer) moved to the Faculty module (see TechnicalProfile in
// core.ts) - this module only ever covers Non-Technical staff now.

export type SupportingStaffCategory = "NON_TECHNICAL";
export const STAFF_CATEGORY_LABELS: Record<SupportingStaffCategory, string> = {
  NON_TECHNICAL: "Non-Technical Staff",
};

export type NonTechnicalStaffDesignation =
  | "OFFICE_STAFF" | "ACCOUNTANT" | "CLERK" | "ATTENDER" | "OFFICE_ASSISTANT" | "OTHER";
export type SupportingStaffDesignation = NonTechnicalStaffDesignation;

export const NON_TECHNICAL_STAFF_DESIGNATION_LABELS: Record<NonTechnicalStaffDesignation, string> = {
  OFFICE_STAFF: "Office Staff",
  ACCOUNTANT: "Accountant",
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

export interface SupportingStaffProfileFields {
  qualifications: StaffQualification[];
  nonTechnicalProfile?: NonTechnicalProfile;
  otherInformation?: string;
}

export interface SupportingStaffMember {
  id: string;
  collegeId: string;
  department?: string; // optional - unlike FacultyMember.department, many roles are college-wide
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

  // Personal/statutory fields - same shape as FacultyMember's own block, built
  // via the shared buildPersonalDetailsUpdate() helper server-side.
  gender?: "Male" | "Female" | "Other";
  dateOfBirth?: Timestamp;
  legalName?: string;
  fatherName?: string;
  motherName?: string;
  religion?: Religion;
  caste?: Caste;
  subCaste?: string;
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

// GET list response shape - mirrors FacultyMember list items (no accessLevel
// tagging needed here since Supporting Staff has no sub-department concept).
export type SupportingStaffListItem = SupportingStaffMember;
