import type { Timestamp } from "firebase/firestore";

// ─── Roles ────────────────────────────────────────────────────────────────────

export type UserRole =
  // System
  | "SUPER_ADMIN"
  | "MANAGEMENT"
  // Location-scoped
  | "ADMINISTRATION"
  | "HR_ADMIN"
  | "ADMIN_OFFICE"
  | "LOCATION_DEPT_HEAD"
  // College-scoped
  | "PRINCIPAL"
  | "VICE_PRINCIPAL"
  | "HOD"
  | "COLLEGE_OFFICE"
  | "PANEL_MEMBER"
  | "ACCOUNTS"
  | "FINANCE"
  | "PURCHASE_DEPT"
  | "STUDENT";

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGEMENT: "Management",
  ADMINISTRATION: "Administration",
  HR_ADMIN: "HR Admin",
  ADMIN_OFFICE: "Admin Office",
  LOCATION_DEPT_HEAD: "Dept Head",
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  HOD: "Head of Department",
  COLLEGE_OFFICE: "College Office",
  PANEL_MEMBER: "Faculty",
  ACCOUNTS: "Accounts",
  FINANCE: "Finance",
  PURCHASE_DEPT: "Purchase Department",
  STUDENT: "Student",
};

export const ROLE_DASHBOARD_PATHS: Record<UserRole, string> = {
  SUPER_ADMIN: "/super-admin",
  MANAGEMENT: "/management",
  ADMINISTRATION: "/administration",
  HR_ADMIN: "/hr-admin",
  ADMIN_OFFICE: "/admin-office",
  LOCATION_DEPT_HEAD: "/location-dept-head",
  PRINCIPAL: "/principal",
  VICE_PRINCIPAL: "/vice-principal",
  HOD: "/hod",
  COLLEGE_OFFICE: "/college-office",
  PANEL_MEMBER: "/panel",
  ACCOUNTS: "/accounts",
  FINANCE: "/finance",
  PURCHASE_DEPT: "/purchase",
  STUDENT: "/feedback",
};

// Roles that are scoped to a Location (not a specific college)
export const LOCATION_SCOPED_ROLES: UserRole[] = [
  "ADMINISTRATION",
  "HR_ADMIN",
  "ADMIN_OFFICE",
  "LOCATION_DEPT_HEAD",
];

// ─── Workflow Status ──────────────────────────────────────────────────────────

export type WorkflowStatus =
  | "PENDING"
  | "PENDING_HR"
  | "PENDING_ADMIN"
  | "APPROVED"
  | "REJECTED"
  | "MODIFIED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "WAITLISTED"
  | "SHORTLISTED"
  | "SELECTED"
  | "OFFER_PENDING"
  | "OFFER_SENT";

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  PENDING: "Pending",
  PENDING_HR: "Pending HR Review",
  PENDING_ADMIN: "Forwarded to Admin",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  MODIFIED: "Modified",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  WAITLISTED: "Waitlisted",
  SHORTLISTED: "Shortlisted",
  SELECTED: "Selected",
  OFFER_PENDING: "Offer Pending Approval",
  OFFER_SENT: "Offer Sent",
};

// ─── System User (login account) ─────────────────────────────────────────────

export interface FMSUser {
  uid: string;
  collegeId: string;
  locationId?: string;      // set for location-scoped roles; also present on college roles
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  department?: string;      // for HOD / LOCATION_DEPT_HEAD
  locationDeptId?: string;  // for LOCATION_DEPT_HEAD
  employeeId?: string;      // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  designation?: string;     // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  dateOfBirth?: Timestamp;  // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  academicProfile?: FacultyProfileFields; // Modules 1-5 extended profile; PRINCIPAL/VICE_PRINCIPAL omit teachingAssignment in the UI
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Location ────────────────────────────────────────────────────────────────

export interface Location {
  id: string;
  name: string;
  city: string;
  state?: string;
  address?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Location Department ─────────────────────────────────────────────────────

export interface LocationDepartment {
  id: string;
  locationId: string;
  name: string;          // Electrical, Civil, Accounts, etc.
  deptHeadUid?: string;
  deptHeadName?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── College ──────────────────────────────────────────────────────────────────

export interface College {
  id: string;
  locationId?: string;   // which location this college belongs to
  name: string;
  logoUrl?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Department ───────────────────────────────────────────────────────────────

export interface Department {
  id: string;
  collegeId: string;
  name: string;
  code: string;
  hodUid?: string;
  hodName?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Faculty Norms ────────────────────────────────────────────────────────────

export type RegulatoryBody = "UGC" | "AICTE" | "STATE" | "NAAC";

export interface PositionNorm {
  designation: string;
  minQualification: string;
  minExperienceYears: number;
  requiredPerDept: number;
}

export interface FacultyNorms {
  regulatoryBody: RegulatoryBody;
  studentFacultyRatio: number;
  teachingHoursPerWeek: number;
  defaultMinFacultyPerDept: number;
  minimumQualifications: {
    assistantProfessor: string;
    associateProfessor: string;
    professor: string;
  };
  positionNorms: PositionNorm[];
  updatedAt?: Timestamp;
  updatedByName?: string;
}

// ─── Faculty Member (central entity across all modules) ───────────────────────
// All leave, attendance, payroll, appraisal records reference facultyId

export type Designation =
  | "PROFESSOR"
  | "ASSOCIATE_PROFESSOR"
  | "ASSISTANT_PROFESSOR"
  | "LECTURER"
  | "VISITING_FACULTY"
  | "ADJUNCT_FACULTY"
  | "LAB_ASSISTANT";

export const DESIGNATION_LABELS: Record<Designation, string> = {
  PROFESSOR: "Professor",
  ASSOCIATE_PROFESSOR: "Associate Professor",
  ASSISTANT_PROFESSOR: "Assistant Professor",
  LECTURER: "Lecturer",
  VISITING_FACULTY: "Visiting Faculty",
  ADJUNCT_FACULTY: "Adjunct Faculty",
  LAB_ASSISTANT: "Lab Assistant",
};

export type EmploymentType = "PERMANENT" | "CONTRACT" | "VISITING" | "PART_TIME";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  VISITING: "Visiting",
  PART_TIME: "Part-Time",
};

export type FacultyStatus = "ACTIVE" | "ON_LEAVE" | "RESIGNED" | "RETIRED";

export const FACULTY_STATUS_LABELS: Record<FacultyStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  RESIGNED: "Resigned",
  RETIRED: "Retired",
};

export interface FacultyMember {
  id: string;
  collegeId: string;
  department: string;
  employeeId: string;
  name: string;
  email: string;
  phone?: string;
  designation: Designation;
  qualification: string;
  specialization?: string;
  experienceYears: number;
  joiningDate: Timestamp;
  employmentType: EmploymentType;
  status: FacultyStatus;
  userUid?: string;            // links to users/{uid} if they have a system login
  profilePhotoUrl?: string;

  // Extended profile fields (from institution records / bulk import)
  gender?: "Male" | "Female" | "Other";
  dateOfBirth?: Timestamp;
  legalName?: string;          // name as per SSC certificates (CAPITAL LETTERS)
  fatherName?: string;         // father or husband name
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  collegeEmail?: string;
  ratificationStatus?: "Ratified" | "Not Ratified";
  ratificationDate?: Timestamp;
  hasPHD?: boolean;
  internalExperience?: number; // years of experience within the institution
  externalExperience?: number; // years of experience outside the institution
  inCampusExperience?: number; // years of on-campus experience
  industryExperience?: number; // years of industry experience
  researchExperience?: number; // years of research experience
  academicProfile?: FacultyProfileFields; // Modules 1-5 extended profile (Management dashboard / role-aware forms)

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Faculty Academic Profile (Management dashboard / role-aware profile forms) ──
// Extended academic/research fields (Modules 1-5), layered on top of FacultyMember
// (facultyMembers/{id}) and FMSUser (colleges/{id}/users/{uid}) as `academicProfile`.
// Identity/contact fields (name, email, phone, employeeId, designation, department,
// dateOfBirth) live on the host doc itself, not here.

export interface DegreeDetail {
  degreeAndBranch: string;
  universityOrInstitute: string;
  percentageOrDivision: string;
  yearOfCompletion: number;
}

export type PhdStatus = "AWARDED" | "PURSUING";
export type PhdMode = "FULL_TIME" | "PART_TIME";

export interface CourseAssignment {
  code: string;
  name: string;
  weeklyCreditHours: number;
}

export interface TeachingAssignmentSummary {
  primaryTeachingRole: string;
  courses: CourseAssignment[]; // up to 3
}

export interface FundedProject {
  title: string;
  fundingAgency: string;
  grantAmountLakhs: number;
  year: number;
  status: string;
}

export interface ConsultancyProject {
  title: string;
  clientOrAgency: string;
  revenueLakhs: number;
  year: number;
  status: string;
}

export interface PatentSummary {
  indianFiled: number;
  indianPublished: number;
  indianGranted: number;
  internationalFiled: number;
  internationalPublished: number;
  internationalGranted: number;
  details?: string;
}

export interface LabEstablished {
  facilityDetails: string;
  outcomes: string;
}

export interface AuthoredBook {
  title: string;
  publisher: string;
  year: number;
}

export interface FacultyProfileFields {
  // Module 1 — Academic Qualification
  highestQualification: string;
  ugDetails?: DegreeDetail;
  pgDetails?: DegreeDetail;
  phdDetails?: DegreeDetail;
  phdStatus?: PhdStatus;
  phdMode?: PhdMode;
  phdSupervisorName?: string;
  fellowshipsReceived?: string;
  gateQualifiedYear?: number;
  gateScore?: number;
  netSletQualificationYear?: number;

  // Module 2 — Tenure & Load
  teachingExperienceBeforeJoiningYears: number;
  teachingExperienceSinceJoiningYears: number;
  researchOrIndustryExperienceYears: number;
  totalProfessionalExperienceYears: number;
  totalWeeklyTeachingLoadHours: number;
  averageStudentFeedbackScore?: number;
  teachingAssignment?: TeachingAssignmentSummary; // omitted for PRINCIPAL / VICE_PRINCIPAL

  // Module 3 — Research Publications
  publicationsFirstOrCorrespondingAuthor: number;
  publicationsQ1OrHighImpact: number;
  sciScopusCount: number;
  wosCount: number;
  conferencePapersCount: number;
  bookChaptersCount: number;
  reviewPublicationsCount: number;
  totalPublications: number;
  totalCitations: number;
  hIndex: number;
  i10Index: number;

  // Module 4 — Grants, Consultancy & IP
  fundedProjects: FundedProject[];
  consultancyProjects: ConsultancyProject[];
  patents: PatentSummary;

  // Module 5 — Mentorship & Institutional Value
  phdScholarsPursuing?: { count: number; universities: string };
  phdScholarsAwarded?: { count: number; universities: string };
  nationalExposure?: string;
  internationalExposure?: string;
  labsEstablished: LabEstablished[];
  administrativeResponsibilities?: string;
  certificationsAndFdps?: string;
  professionalBodyMemberships?: string;
  authoredBooks: AuthoredBook[];
  notableAwards?: string;
}

// PRINCIPAL / VICE_PRINCIPAL form variant — no teaching-assignment sub-object
export type PrincipalAcademicProfile = Omit<FacultyProfileFields, "teachingAssignment">;

// ─── Section ──────────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  collegeId: string;
  department: string;
  name: string;              // "A", "B", "C" etc.
  year: 1 | 2 | 3 | 4;      // academic year (1st year = Basic Science)
  batch: string;             // admission batch e.g. "2023-2027"
  facultyInchargeUid?: string;
  facultyInchargeName?: string;
  studentCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationType =
  // Recruitment
  | "VACANCY_APPROVED"
  | "VACANCY_REJECTED"
  | "INTERVIEW_PLAN_APPROVED"
  | "INTERVIEW_PLAN_MODIFIED"
  | "INTERVIEW_PLAN_REJECTED"
  | "CANDIDATE_ARRIVED"
  | "HIRING_APPROVED"
  | "HIRING_REJECTED"
  | "OFFER_LETTER_GENERATED"
  | "COORDINATOR_ASSIGNED"
  // Leave & Attendance
  | "LEAVE_PENDING_APPROVAL"
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "PERMISSION_APPROVED"
  | "PERMISSION_REJECTED"
  | "ON_DUTY_APPROVED"
  | "ON_DUTY_REJECTED"
  // Payroll
  | "SALARY_PROCESSED"
  | "SALARY_PAID"
  | "ADVANCE_APPROVED"
  // Appraisal
  | "APPRAISAL_INITIATED"
  | "APPRAISAL_REVIEWED"
  // Grievance
  | "GRIEVANCE_UPDATE"
  // Budget
  | "BUDGET_REQUEST_SUBMITTED"
  | "BUDGET_REQUEST_VERIFIED"
  | "BUDGET_REQUEST_RETURNED"
  | "BUDGET_REQUEST_REJECTED"
  | "BUDGET_REQUEST_APPROVED"
  // Indent (HOD → Purchase → Finance)
  | "INDENT_SUBMITTED"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED"
  | "INDENT_REJECTED"
  | "INDENT_APPROVED"
  | "GENERAL";

export interface AppNotification {
  id: string;
  collegeId: string;
  toUid: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  createdAt: Timestamp;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  // Recruitment module
  | "VACANCY_REQUEST_CREATED"
  | "VACANCY_REQUEST_APPROVED"
  | "VACANCY_REQUEST_REJECTED"
  | "CANDIDATE_ADDED"
  | "CANDIDATE_SHORTLISTED"
  | "CANDIDATE_ARRIVED"
  | "CANDIDATE_STAGE_ADVANCED"
  | "HIRING_BATCH_CREATED"
  | "HIRING_BATCH_SUBMITTED"
  | "INTERVIEW_PLAN_APPROVED"
  | "INTERVIEW_PLAN_REJECTED"
  | "INTERVIEW_PLAN_MODIFIED"
  | "FEEDBACK_SUBMITTED"
  | "HIRING_DECISION_MADE"
  | "OFFER_LETTER_GENERATED"
  | "APPOINTMENT_LETTER_GENERATED"
  // User management
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DEACTIVATED"
  // Faculty module
  | "FACULTY_CREATED"
  | "FACULTY_UPDATED"
  | "FACULTY_STATUS_CHANGED"
  // Leave module
  | "LEAVE_APPLIED"
  | "LEAVE_HOD_APPROVED"
  | "LEAVE_PRINCIPAL_APPROVED"
  | "LEAVE_REJECTED"
  | "LEAVE_CANCELLED"
  | "PERMISSION_APPLIED"
  | "PERMISSION_APPROVED"
  | "PERMISSION_REJECTED"
  | "ON_DUTY_APPLIED"
  | "ON_DUTY_APPROVED"
  | "ON_DUTY_REJECTED"
  // Attendance module
  | "ATTENDANCE_MARKED"
  | "ATTENDANCE_CORRECTED"
  // Payroll module
  | "SALARY_STRUCTURE_CREATED"
  | "PAYROLL_PROCESSED"
  | "PAYROLL_APPROVED"
  | "PAYROLL_PAID"
  | "ADVANCE_GRANTED"
  | "SALARY_RECORDED"
  // Appraisal module
  | "APPRAISAL_SUBMITTED"
  | "APPRAISAL_HOD_REVIEWED"
  | "APPRAISAL_PRINCIPAL_REVIEWED"
  // Grievance module
  | "GRIEVANCE_FILED"
  | "GRIEVANCE_ASSIGNED"
  | "GRIEVANCE_RESOLVED"
  // Budget module
  | "BUDGET_REQUEST_SUBMITTED"
  | "BUDGET_REQUEST_VERIFIED"
  | "BUDGET_REQUEST_RETURNED"
  | "BUDGET_REQUEST_REJECTED"
  | "BUDGET_REQUEST_FINANCE_APPROVED"
  | "BUDGET_REQUEST_FINANCE_REJECTED"
  // Indent module
  | "INDENT_SUBMITTED"
  | "INDENT_RETURNED_TO_HOD"
  | "INDENT_REJECTED_BY_PURCHASE"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED_TO_PURCHASE"
  | "INDENT_FINANCE_APPROVED"
  | "INDENT_FINANCE_REJECTED";

export interface AuditLog {
  id: string;
  collegeId: string;
  action: AuditAction;
  performedBy: string;
  performedByName: string;
  targetDoc?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  timestamp: Timestamp;
}

// ─── UI Helper Types ──────────────────────────────────────────────────────────

export type StatusVariant =
  | "pending"
  | "approved"
  | "rejected"
  | "modified"
  | "in_progress"
  | "completed"
  | "waitlisted";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: UserRole[];
}

export interface TableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  hasMore: boolean;
  lastDoc: unknown;
}
