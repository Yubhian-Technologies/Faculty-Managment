import type { Timestamp } from "firebase/firestore";
import type { EmploymentType, FacultyStatus, TrainingEntry, AwardEntry, Religion, Caste, StaffQualification } from "./core";

// ─── Supporting Staff ───────────────────────────────────────────────────────
// NBA/AICTE-compliant profile module for non-teaching staff, parallel to the
// Teaching Faculty module (FacultyMember/FacultyProfileFields in core.ts).
// Designation is free text, per-college-type (see College.type and
// src/lib/designations/config.ts) - covers both the original Non-Technical
// roles (Office Staff/Accountant/Clerk/...) and, for Engineering/Pharmacy/
// Dental colleges, the Technical roles (Lab Assistant/Programmer/System
// Administrator/Network Engineer) migrated back in from the Faculty module.

export type SupportingStaffCategory = "NON_TECHNICAL" | "TECHNICAL";
export const STAFF_CATEGORY_LABELS: Record<SupportingStaffCategory, string> = {
  NON_TECHNICAL: "Non-Technical Staff",
  TECHNICAL: "Technical Staff",
};

// Free text, not a closed enum - see src/lib/designations/config.ts for the
// per-college-type lists. The original fixed codes below are what
// Engineering/Pharmacy/Dental colleges use and what every pre-existing
// SupportingStaffMember record holds - NON_TECHNICAL_STAFF_DESIGNATION_LABELS
// keeps them displaying as words.
export type NonTechnicalStaffDesignation = string;
export type SupportingStaffDesignation = string;

export const NON_TECHNICAL_STAFF_DESIGNATION_LABELS: Record<string, string> = {
  OFFICE_STAFF: "Office Staff",
  ACCOUNTANT: "Accountant",
  CLERK: "Clerk",
  ATTENDER: "Attender",
  OFFICE_ASSISTANT: "Office Assistant",
  // Migrated back in from the Faculty module's old Designation codes (see
  // core.ts's DESIGNATION_LABELS) - kept here too so a SupportingStaffMember
  // record with one of these designations displays as a word.
  LAB_ASSISTANT: "Lab Assistant",
  PROGRAMMER: "Programmer",
  SYSTEM_ADMINISTRATOR: "System Administrator",
  NETWORK_ENGINEER: "Network Engineer",
  OTHER: "Other",
};

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
