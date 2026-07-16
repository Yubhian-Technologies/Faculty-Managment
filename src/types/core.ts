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
  | "COLLEGE_STAFF"
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
  COLLEGE_STAFF: "College Staff",
  PANEL_MEMBER: "Faculty",
  ACCOUNTS: "Accounts",
  FINANCE: "Finance",
  PURCHASE_DEPT: "Purchase Department",
  STUDENT: "Student",
};

export const ROLE_DASHBOARD_PATHS: Record<UserRole, string> = {
  SUPER_ADMIN: "/super-admin",
  MANAGEMENT: "/management/dashboard",
  ADMINISTRATION: "/administration",
  HR_ADMIN: "/hr-admin",
  ADMIN_OFFICE: "/admin-office",
  LOCATION_DEPT_HEAD: "/location-dept-head",
  PRINCIPAL: "/principal",
  VICE_PRINCIPAL: "/vice-principal",
  HOD: "/hod",
  COLLEGE_OFFICE: "/college-office",
  COLLEGE_STAFF: "/college-staff",
  PANEL_MEMBER: "/panel",
  ACCOUNTS: "/accounts",
  FINANCE: "/finance",
  PURCHASE_DEPT: "/purchase",
  STUDENT: "/feedback",
};

// ─── Role Level & Scope hierarchy (L0–L6) ────────────────────────────────────
// Level is the seniority rank; Scope is the tenancy tier. Level is monotonic with
// scope (L0–L1 GLOBAL, L2 LOCATION, L3–L6 COLLEGE), which is what makes clean
// scope-bounded inheritance possible. See docs/AGENTS.md "Level-wise login flow".

export type RoleScope = "GLOBAL" | "LOCATION" | "COLLEGE";

export const ROLE_LEVEL: Record<UserRole, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  SUPER_ADMIN: 0,
  MANAGEMENT: 1,
  FINANCE: 1,
  PURCHASE_DEPT: 1,
  ADMINISTRATION: 2,
  HR_ADMIN: 2,
  ADMIN_OFFICE: 2,
  LOCATION_DEPT_HEAD: 2,
  ACCOUNTS: 2,
  PRINCIPAL: 3,
  VICE_PRINCIPAL: 3,
  HOD: 4,
  COLLEGE_OFFICE: 4,
  COLLEGE_STAFF: 4,
  PANEL_MEMBER: 5,
  STUDENT: 6,
};

// Human-readable header for each level, used to group role pickers (Add User).
export const LEVEL_LABELS: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string> = {
  0: "L0 · System Administration",
  1: "L1 · Global (Management / Finance / Purchase)",
  2: "L2 · Location",
  3: "L3 · College Leadership",
  4: "L4 · Departments & Offices",
  5: "L5 · Faculty & Staff",
  6: "L6 · Students",
};

// Tenancy tier a role belongs to. FINANCE/PURCHASE_DEPT are GLOBAL (profiles in
// systemUsers, act on any college via an explicit collegeId context); ACCOUNTS is
// LOCATION-scoped (profiles in locations/{id}/locationUsers). Keep this in lockstep
// with where the profile docs actually live, or the session/login profile-fetch
// branch (which keys off LOCATION_SCOPED_ROLES / this map) looks in the wrong place.
export const ROLE_SCOPE: Record<UserRole, RoleScope> = {
  SUPER_ADMIN: "GLOBAL",
  MANAGEMENT: "GLOBAL",
  FINANCE: "GLOBAL",
  PURCHASE_DEPT: "GLOBAL",
  ADMINISTRATION: "LOCATION",
  HR_ADMIN: "LOCATION",
  ADMIN_OFFICE: "LOCATION",
  LOCATION_DEPT_HEAD: "LOCATION",
  ACCOUNTS: "LOCATION",
  PRINCIPAL: "COLLEGE",
  VICE_PRINCIPAL: "COLLEGE",
  HOD: "COLLEGE",
  COLLEGE_OFFICE: "COLLEGE",
  COLLEGE_STAFF: "COLLEGE",
  PANEL_MEMBER: "COLLEGE",
  STUDENT: "COLLEGE",
};

function scopeRank(scope: RoleScope): 0 | 1 | 2 {
  return scope === "GLOBAL" ? 0 : scope === "LOCATION" ? 1 : 2;
}

// Roles a given role inherits access to: strictly lower in level (higher number)
// AND same-or-narrower tenancy scope. A GLOBAL role inherits everything below it;
// a LOCATION role inherits lower LOCATION/COLLEGE roles; a COLLEGE role inherits
// only lower COLLEGE roles. Real tenant/data isolation is still enforced by the
// API guards — this drives coarse path/nav access only.
export function rolesInheritedBy(role: UserRole): UserRole[] {
  const selfLevel = ROLE_LEVEL[role];
  const selfScopeRank = scopeRank(ROLE_SCOPE[role]);
  return (Object.keys(ROLE_LEVEL) as UserRole[]).filter(
    (r) =>
      ROLE_LEVEL[r] > selfLevel &&
      scopeRank(ROLE_SCOPE[r]) >= selfScopeRank
  );
}

// True if `actor` may access resources belonging to `target` (self, or an
// inherited lower-level role within scope).
export function canRoleAccessRole(actor: UserRole, target: UserRole): boolean {
  return actor === target || rolesInheritedBy(actor).includes(target);
}

// Roles that are scoped to a Location (not a specific college).
// Derived from ROLE_SCOPE so there is a single source of truth.
export const LOCATION_SCOPED_ROLES: UserRole[] = (
  Object.keys(ROLE_SCOPE) as UserRole[]
).filter((r) => ROLE_SCOPE[r] === "LOCATION");

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
  profilePhotoUrl?: string; // Firebase Storage download URL, same field name as FacultyMember below

  // Personal / statutory details (same field names as FacultyMember below, for consistency)
  gender?: "Male" | "Female" | "Other";
  legalName?: string;          // name as per SSC certificates (CAPITAL LETTERS)
  fatherName?: string;         // father or husband name
  motherName?: string;
  religion?: string;
  caste?: string;
  aadharNo?: string;
  panNo?: string;
  ratificationStatus?: "Ratified" | "Not Ratified";
  ratificationDate?: Timestamp;
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;              // referral source/person, if any
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;      // ignored/blank when permanentSameAsTemporary is true
  bloodGroup?: string;

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

// ─── Course (a program offered by a Department — engineering, pharmacy, dental, etc.) ──

export interface Course {
  id: string;
  collegeId: string;
  departmentId: string;
  name: string;          // "B.Tech", "B.Pharm", "BDS", "MBA", ...
  code: string;           // "BTECH"
  durationYears: number;  // e.g. 4, 2
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Course-Year Timing (college timings, periods, breaks — per course, per year) ──

export interface BreakConfig {
  afterPeriod: number;      // e.g. break happens after period 4
  durationMinutes: number;
}

export interface CourseYearTiming {
  id: string;                // `${courseId}_year${year}`
  collegeId: string;
  departmentId: string;
  courseId: string;
  year: number;
  collegeStartTime: string;  // "HH:MM" 24h
  collegeEndTime: string;    // "HH:MM" 24h
  numberOfPeriods: number;
  periodDurationMinutes: number;
  lunchBreak: BreakConfig;
  shortBreaks: BreakConfig[];
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Course Academic Year (per course, per year — advancing it bumps active faculty
// experience). Distinct from AcademicYear below (a college-wide 1-4 year open/close
// gate) — the two are unrelated features that happen to share a similar name.

export interface CourseAcademicYear {
  id: string;                // `${courseId}_year${year}`
  collegeId: string;
  departmentId: string;
  courseId: string;
  year: number;
  label: string;              // "2025-2026"
  advancedAt?: Timestamp;     // set on every advance (not on first creation)
  advancedByName?: string;
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
  | "LAB_ASSISTANT"
  | "TECHNICAL"
  | "NON_TECHNICAL"
  | "OTHER";

export const DESIGNATION_LABELS: Record<Designation, string> = {
  PROFESSOR: "Professor",
  ASSOCIATE_PROFESSOR: "Associate Professor",
  ASSISTANT_PROFESSOR: "Assistant Professor",
  LECTURER: "Lecturer",
  VISITING_FACULTY: "Visiting Faculty",
  ADJUNCT_FACULTY: "Adjunct Faculty",
  LAB_ASSISTANT: "Lab Assistant",
  TECHNICAL: "Technical",
  NON_TECHNICAL: "Non-Technical",
  OTHER: "Other",
};

// Which Designation options the "Staff Type" picker (Teaching / Supporting) offers.
export const TEACHING_DESIGNATIONS: Designation[] = [
  "PROFESSOR", "ASSOCIATE_PROFESSOR", "ASSISTANT_PROFESSOR", "LECTURER", "VISITING_FACULTY", "ADJUNCT_FACULTY", "LAB_ASSISTANT",
];
export const SUPPORTING_STAFF_DESIGNATIONS: Designation[] = ["TECHNICAL", "NON_TECHNICAL", "OTHER"];

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

  // Carried over from the hiring pipeline when a candidate had a course/subject preference set —
  // consumed once by the faculty edit page to pre-fill TeachingAssignmentsEditor rows (course/year/subject
  // known, section left for the HOD to pick). Not cleared automatically; harmless to leave once assignments exist.
  pendingTeachingPreference?: {
    courseId: string;
    courseName: string;
    year: number;
    subjectIds: string[];
    subjectNames: string[];
  };

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
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string;              // referral source/person, if any
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string;      // ignored/blank when permanentSameAsTemporary is true
  bloodGroup?: string;
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

  // Module 6 — Financial Standing & Budgetary Impact
  presentSalary?: number;              // Current Financial Standing — present salary drawn by the faculty member
  grossAnnualCTC?: number;             // Budgetary Impact
  incrementsAwarded?: number;
  fundingConsultancyRevenue?: number;  // offsets salary cost against research/consultancy grants brought into the institution

  // Module 7 — Others
  otherInformation?: string;
}

// PRINCIPAL / VICE_PRINCIPAL form variant — no teaching-assignment sub-object
export type PrincipalAcademicProfile = Omit<FacultyProfileFields, "teachingAssignment">;

// ─── Academic Year ──────────────────────────────────────────────────────────
// Which of the 1st–4th year slots are currently open for a college. Section.year
// stays a plain 1|2|3|4 union (unchanged) — this entity is what Location Admin /
// Principal configure to control which of those year numbers are actually in use,
// validated against on Section creation.

export interface AcademicYear {
  id: string;
  collegeId: string;
  yearNumber: 1 | 2 | 3 | 4;
  label: string;   // e.g. "1st Year"
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Section ──────────────────────────────────────────────────────────────────

export interface Section {
  id: string;
  collegeId: string;
  department: string;
  courseId: string;
  courseName?: string;
  name: string;              // "A", "B", "C" etc.
  year: number;              // academic year within the course (1..course.durationYears)
  batch: string;             // admission batch e.g. "2023-2027"
  facultyInchargeUid?: string;
  facultyInchargeName?: string;
  studentCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Student Record ─────────────────────────────────────────────────────────
// Enrolled-student roster row, independent of any login account. Faculty manage
// this for the sections they're in charge of (Section.facultyInchargeUid).

export type StudentStatus = "REGULAR" | "DETAINED";

export interface StudentRecord {
  id: string;
  collegeId: string;
  department: string;
  section: string;      // Section.name — "A", "B", etc.
  year: 1 | 2 | 3 | 4;
  rollNumber: string;
  name: string;
  status: StudentStatus;
  gender?: string;
  dateOfBirth?: string;        // yyyy-mm-dd, kept as string (no statutory-date math needed)
  guardianContact?: string;
  email?: string;
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
  | "BUDGET_REQUEST_REPORT_UPLOADED"
  // Indent (HOD → Purchase → Finance)
  | "INDENT_SUBMITTED"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED"
  | "INDENT_REJECTED"
  | "INDENT_APPROVED"
  | "INDENT_RECEIPT_UPLOADED"
  // Purchase Finance Clearance
  | "PURCHASE_CLEARANCE_SUBMITTED"
  | "PURCHASE_CLEARANCE_REJECTED_BY_PURCHASE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_HOD"
  | "PURCHASE_CLEARANCE_SENT_TO_FINANCE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_PURCHASE"
  | "PURCHASE_CLEARANCE_FINANCE_APPROVED"
  | "PURCHASE_CLEARANCE_FINANCE_REJECTED"
  | "PURCHASE_CLEARANCE_GOODS_PURCHASED"
  | "PURCHASE_CLEARANCE_GRN_UPLOADED"
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
  | "PROFILE_PHOTO_UPDATED"
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
  | "BUDGET_REQUEST_MANAGEMENT_APPROVED"
  | "BUDGET_REQUEST_MANAGEMENT_REJECTED"
  | "BUDGET_REQUEST_REPORT_UPLOADED"
  // Indent module
  | "INDENT_SUBMITTED"
  | "INDENT_RETURNED_TO_HOD"
  | "INDENT_REJECTED_BY_PURCHASE"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED_TO_PURCHASE"
  | "INDENT_FINANCE_APPROVED"
  | "INDENT_FINANCE_REJECTED"
  | "INDENT_RECEIPT_UPLOADED"
  // Purchase Finance Clearance module
  | "PURCHASE_CLEARANCE_SUBMITTED"
  | "PURCHASE_CLEARANCE_REJECTED_BY_PURCHASE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_HOD"
  | "PURCHASE_CLEARANCE_SENT_TO_FINANCE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_PURCHASE"
  | "PURCHASE_CLEARANCE_FINANCE_APPROVED"
  | "PURCHASE_CLEARANCE_FINANCE_REJECTED"
  | "PURCHASE_CLEARANCE_GOODS_PURCHASED"
  | "PURCHASE_CLEARANCE_GRN_UPLOADED"
  // Academic Year module
  | "ACADEMIC_YEAR_ADVANCED";

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
