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
  | "DEAN"
  | "IQAC_COORDINATOR"
  | "T_AND_P"
  | "R_AND_D"
  | "PLACEMENT_DEPT"
  | "LIBRARY"
  | "EXAM_CELL"
  | "WEBMASTER"
  | "COLLEGE_ACCOUNTS"
  | "PANEL_MEMBER"
  | "ACCOUNTS"
  | "FINANCE"
  | "PURCHASE_DEPT"
  | "STUDENT"
  | "CLASS_LEADER";

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
  DEAN: "Dean",
  IQAC_COORDINATOR: "IQAC Coordinator",
  T_AND_P: "T&P",
  R_AND_D: "R&D",
  PLACEMENT_DEPT: "Placement Department",
  LIBRARY: "Library",
  EXAM_CELL: "Exam Cell",
  WEBMASTER: "Webmaster",
  COLLEGE_ACCOUNTS: "College Accounts",
  PANEL_MEMBER: "Faculty",
  ACCOUNTS: "Accounts",
  FINANCE: "Finance",
  PURCHASE_DEPT: "Purchase Department",
  STUDENT: "Student",
  CLASS_LEADER: "Class Leader",
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
  DEAN: "/dean",
  IQAC_COORDINATOR: "/iqac-coordinator",
  T_AND_P: "/t-and-p",
  R_AND_D: "/r-and-d",
  PLACEMENT_DEPT: "/placement-dept",
  LIBRARY: "/library",
  EXAM_CELL: "/exam-cell",
  WEBMASTER: "/webmaster",
  COLLEGE_ACCOUNTS: "/college-accounts",
  PANEL_MEMBER: "/panel",
  ACCOUNTS: "/accounts",
  FINANCE: "/finance",
  PURCHASE_DEPT: "/purchase",
  STUDENT: "/feedback",
  CLASS_LEADER: "/class-leader",
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
  DEAN: 4,
  IQAC_COORDINATOR: 4,
  T_AND_P: 4,
  R_AND_D: 4,
  PLACEMENT_DEPT: 4,
  LIBRARY: 4,
  EXAM_CELL: 4,
  WEBMASTER: 4,
  COLLEGE_ACCOUNTS: 4,
  PANEL_MEMBER: 5,
  STUDENT: 6,
  CLASS_LEADER: 6,
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
  DEAN: "COLLEGE",
  IQAC_COORDINATOR: "COLLEGE",
  T_AND_P: "COLLEGE",
  R_AND_D: "COLLEGE",
  PLACEMENT_DEPT: "COLLEGE",
  LIBRARY: "COLLEGE",
  EXAM_CELL: "COLLEGE",
  WEBMASTER: "COLLEGE",
  COLLEGE_ACCOUNTS: "COLLEGE",
  PANEL_MEMBER: "COLLEGE",
  STUDENT: "COLLEGE",
  CLASS_LEADER: "COLLEGE",
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
      ROLE_LEVEL[r] > selfLevel && scopeRank(ROLE_SCOPE[r]) >= selfScopeRank,
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

// Religion/Caste - shared by every role's Personal Details (FMSUser and
// FacultyMember both use these same coded values, not free text, so exports/
// PDFs/CSV can render a consistent label regardless of which record type it
// came from). "OTHER" is also what a legacy free-text value not matching any
// code here falls back to until the record is next saved (see subCaste for
// caste sub-classification, which stays free text since it isn't a fixed list).
export type Religion =
  | "HINDU"
  | "MUSLIM"
  | "CHRISTIAN"
  | "SIKH"
  | "JAIN"
  | "PARSI"
  | "BUDDHIST"
  | "OTHER";
export const RELIGION_LABELS: Record<Religion, string> = {
  HINDU: "Hindu",
  MUSLIM: "Muslim",
  CHRISTIAN: "Christian",
  SIKH: "Sikh",
  JAIN: "Jain",
  PARSI: "Parsi",
  BUDDHIST: "Buddhist",
  OTHER: "Other",
};
export type Caste = "OC" | "EBC" | "EPC" | "BC" | "SC" | "ST" | "OTHER";
export const CASTE_LABELS: Record<Caste, string> = {
  OC: "OC",
  EBC: "EBC",
  EPC: "EPC",
  BC: "BC",
  SC: "SC",
  ST: "ST",
  OTHER: "Other",
};

// Sub-caste picklist per Caste (state reservation sub-categories) - values
// are stored and displayed verbatim (no separate code/label split, unlike
// Religion/Caste above) since they're only ever used as freeform sub-
// classification text. EPC has no fixed list here - its Sub Caste field
// falls back to free text, same as "OTHER" does for every caste.
export const SUB_CASTES_BY_CASTE: Partial<Record<Caste, string[]>> = {
  OC: [
    "Brahmin", "Kshatriya", "Vysya", "Kapu", "Reddy", "Aryavysya", "Kamma", "Naidu",
    "Adi Velama", "Arya Vyshya", "Marvadi", "Veerashaiva Lingayat", "Balija",
    "Padmanayaka Velamadoralu", "Vellama",
  ],
  EBC: ["Faqir", "Muslim", "Shaik"],
  BC: [
    "Devanga", "Kummari", "Nai Brahmin", "Kalinga", "Gowda", "Cristian", "Kurama",
    "Korpula Velama", "Vishwa Brahmin", "Agnikula Kshatriya", "Turupu Kapu",
    "Karnibakthulu", "Settibalija", "Padmasali", "Rajaka", "Sri Sayana",
    "Munnurukapu", "Yadava", "Velama", "Surya Balija", "Kummara", "Poosala",
    "Jangam", "Perika", "Sagara", "Christian Mala", "Bhatraju", "Kambali",
    "Uppara", "Bondili", "Vyshnavas", "Bukka", "Mutrasi", "Adi Andhra Christian",
    "Telukula",
  ],
  SC: ["Mala", "Madiga", "Mala Dasu"],
  ST: ["Koya"],
};

export interface FMSUser {
  uid: string;
  collegeId: string;
  locationId?: string; // set for location-scoped roles; also present on college roles
  name: string;
  email: string;
  collegeEmail?: string; // same field name as FacultyMember below, for consistency
  phone?: string;
  role: UserRole;
  department?: string; // for HOD / LOCATION_DEPT_HEAD
  locationDeptId?: string; // for LOCATION_DEPT_HEAD
  sectionId?: string; // for CLASS_LEADER - the one Section this login is bound to
  sectionName?: string; // for CLASS_LEADER - denormalized Section.name
  employeeId?: string; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  designation?: string; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  dateOfBirth?: Timestamp; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  // Collected at account-creation time (see api/college/users, api/administration/
  // college-staff) so a role with no FacultyMember/SupportingStaff record of its
  // own (HOD/PRINCIPAL/VICE_PRINCIPAL/DEAN/COLLEGE_OFFICE/ACCOUNTS/FINANCE/IQAC/
  // T&P/R&D/Library/Exam Cell/Webmaster/Placement Dept, ...) doesn't wrongly
  // default into the leave module's "new joining" category from its login's own
  // createdAt - see resolveEmployeeIdentity in lib/leave/identity.ts.
  dateOfJoining?: Timestamp;
  profilePhotoUrl?: string; // Firebase Storage download URL, same field name as FacultyMember below

  // Personal / statutory details (same field names as FacultyMember below, for consistency)
  gender?: "Male" | "Female" | "Other";
  legalName?: string; // name as per SSC certificates (CAPITAL LETTERS)
  fatherName?: string; // father or husband name
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
  referral?: string; // referral source/person, if any
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string; // ignored/blank when permanentSameAsTemporary is true
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
  name: string; // Electrical, Civil, Accounts, etc.
  deptHeadUid?: string;
  deptHeadName?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── College ──────────────────────────────────────────────────────────────────

export type CollegeType =
  | "ENGINEERING"
  | "SCHOOL"
  | "DENTAL"
  | "PHARMACY"
  | "POLYTECHNIC"
  | "DEGREE";

export const COLLEGE_TYPE_LABELS: Record<CollegeType, string> = {
  ENGINEERING: "Engineering",
  SCHOOL: "School",
  DENTAL: "Dental",
  PHARMACY: "Pharmacy",
  POLYTECHNIC: "Polytechnic",
  DEGREE: "Degree",
};

export interface College {
  id: string;
  locationId?: string; // which location this college belongs to
  name: string;
  type?: CollegeType; // institution category - optional so older records without one still load
  logoUrl?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
  isActive: boolean;
  // Campus geofence for face+geo self-attendance check-in/out. Super Admin
  // only (see PATCH /api/admin/colleges) — faculty must be within the circle
  // radius, or literally inside the polygon boundary, depending on shape.
  campusLocation?:
    | { shape: "circle"; latitude: number; longitude: number; radiusMeters: number }
    | { shape: "polygon"; points: { latitude: number; longitude: number }[] };
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
  // Which of the college's open AcademicYears this department currently
  // teaches — set by Principal/VP, dynamic per college (not hardcoded).
  // e.g. a Basic Science dept holds [1] while core branch depts each hold
  // [2, 3, 4] concurrently for their own batches.
  assignedYears?: number[];
  // Sub-department support: a parent department (Principal-created) can be
  // split into several sub-departments (e.g. Basic Science → BS-Maths,
  // BS-English, ...), each with its own HOD ("sub-HOD" — just a normal HOD
  // account on this child Department doc, no separate role). The parent's HOD
  // has FULL control over every child as well as their own department — they
  // can create sections, add subjects, add faculty and make teaching
  // assignments in any of them, alongside the sub-HOD who runs it day to day.
  // Authority flows down the tree only: a sub-HOD never reaches the parent or a
  // sibling. Enforced via canHodEditDepartment() in src/lib/departments/scope.ts.
  // One level deep only — child departments never set `hasSubDepartments`.
  parentDepartmentId?: string;
  hasSubDepartments?: boolean;
  // Cross-listing: other departments whose HODs each get automatic view-only
  // access to every section (and its roster/faculty) created under this
  // department — set once here by Principal/VP instead of being re-picked
  // by College Office at every section's creation. Mirrors what used to be
  // `Section.secondaryDepartment`, which every new section now inherits
  // from its own department instead of having it chosen per-section. A
  // department can have more than one — e.g. a shared first-year "Basic
  // Science" department feeds students on to both CSE and ECE, so both
  // HODs need visibility into its sections ahead of promotion.
  secondaryDepartments?: string[];
  // Per-course override of assignedYears/secondaryDepartments above, keyed by
  // CourseCatalogItem.id - a department can offer several courses (e.g. a
  // B.Tech with a common first year through this department, and an M.Tech
  // it runs independently end to end), and the flat fields above can't tell
  // them apart. Stable across a delete/recreate of this department's own
  // Course doc for that catalog entry (deliberate, so a careful cross-listing
  // setup survives a course being re-added). A course with no entry here
  // follows the flat fields above, which remain the permanent default - not a
  // migration crutch - for a brand-new department or any course that never
  // needs to diverge. Resolve through resolveDepartmentCourseScope()
  // (src/lib/college/academicStructure.ts), never read directly. Deliberately
  // does NOT cover hasSubDepartments or managedDepartments - see that
  // function's doc-comment for why.
  courseScopes?: Record<string, DepartmentCourseScope>;
  // Grouped/managed branches: on a sub-department, the top-level departments
  // (e.g. IT, CSBS) whose students, sections and academics its Sub-HOD fully
  // manages. Distinct from `secondaryDepartments` (view-only cross-listing) -
  // these grant full control, resolved into the Sub-HOD's editable scope via
  // getHodDepartmentScope (src/lib/departments/scope.ts). Set by the parent
  // department's HOD on the Sub-Departments settings page.
  managedDepartments?: string[];
  // Approximate period the shared first year runs for, on a common-year
  // department (yyyy-mm-dd, same shape as StudentRecord.dateOfBirth). Advisory
  // only: it gives the Principal's cohort-advance screen its context and is
  // never a gate on any write. See src/lib/college/academicStructure.ts for how
  // a common-year department is identified.
  commonYearStart?: string;
  commonYearEnd?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface DepartmentCourseScope {
  assignedYears: number[];
  secondaryDepartments: string[];
}

// ─── Course Catalog (college-wide master list of course definitions the Principal
// fixes once in Settings — the single source of truth for course names/codes so a
// department can only *select* a course, never re-type it. Prevents duplicates like
// "Bachelor of Technology" vs "Bachelors of Technology"). ──

export interface CourseCatalogItem {
  id: string;
  collegeId: string;
  name: string; // canonical name, e.g. "Bachelor of Technology"
  code: string; // "BTECH"
  durationYears: number; // e.g. 4, 2
  // Subset of the college's declared AcademicRegulationSettings.regulations
  // (colleges/{collegeId}/settings/academicRegulations) that this course
  // actually uses (e.g. B.Tech -> R20/R23, B.Pharm -> R19/R22) - a different
  // course can have an entirely different set. Empty/absent until the
  // Principal assigns at least one here, which blocks the Dean from adding
  // subjects to any Course created from this catalog entry (see
  // api/college/subjects POST) until it's set.
  regulations?: string[];
  isActive: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Course (a program offered by a Department — engineering, pharmacy, dental, etc.) ──

export interface Course {
  id: string;
  collegeId: string;
  departmentId: string;
  catalogId?: string; // → CourseCatalogItem.id it was created from (source of truth)
  name: string; // "B.Tech", "B.Pharm", "BDS", "MBA", ...
  code: string; // "BTECH"
  durationYears: number; // e.g. 4, 2
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Course-Year Timing (college timings, periods, breaks — per course, per year) ──

export interface BreakConfig {
  afterPeriod: number; // e.g. break happens after period 4
  durationMinutes: number;
}

// One period's explicit clock range, set by the HOD (see
// api/college/course-year-timings/route.ts PATCH) - free-form, not required
// to be equal-length or back-to-back, but validated to fall within
// [collegeStartTime, collegeEndTime]. `period` is 1-based and must be
// contiguous from 1 - there's no such thing as a gap in the period numbering
// itself, only possibly a gap in clock time between two periods' start/end
// (e.g. an unlisted break).
export interface PeriodTiming {
  period: number;
  startTime: string; // "HH:MM" 24h
  endTime: string; // "HH:MM" 24h
}

export interface CourseYearTiming {
  id: string; // `${courseId}_year${year}`
  collegeId: string;
  departmentId: string;
  courseId: string;
  year: number;
  collegeStartTime: string; // "HH:MM" 24h - the day's outer bound, Principal-set
  collegeEndTime: string; // "HH:MM" 24h - the day's outer bound, Principal-set
  numberOfPeriods: number;
  periodDurationMinutes: number;
  lunchBreak: BreakConfig;
  shortBreaks: BreakConfig[];
  // The HOD's own period-by-period breakdown within [collegeStartTime,
  // collegeEndTime] - absent until an HOD sets it (see PATCH, HOD-only),
  // at which point it's the source of truth for numberOfPeriods and for each
  // period's displayed clock range (see buildGrid.ts's buildRows) instead of
  // the numberOfPeriods/periodDurationMinutes formula above. That formula
  // stays in place as the fallback for a course-year an HOD hasn't broken
  // down yet, so nothing already relying on it (isContiguousBlockAvailable,
  // the timetable solver, ...) has to change.
  periods?: PeriodTiming[];
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Course Academic Year (per course, per year — advancing it bumps active faculty
// experience). Distinct from AcademicYear below (a college-wide 1-4 year open/close
// gate) — the two are unrelated features that happen to share a similar name.

export interface CourseAcademicYear {
  id: string; // `${courseId}_year${year}`
  collegeId: string;
  departmentId: string;
  courseId: string;
  year: number;
  label: string; // "2025-2026"
  advancedAt?: Timestamp; // set on every advance (not on first creation)
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
  // Years of service a "new joining" employee (leave profile: CL + OD only)
  // must complete before converting into their vacation/non-vacation leave
  // category - see src/lib/leave/categoryEngine.ts.
  newJoiningYears: number;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

// ─── Academic Regulations ─────────────────────────────────────────────────────
// A college's curriculum "regulation" (e.g. R20, R23) usually changes only for
// incoming batches, so the 1st through 4th year of study can each be running a
// different regulation at the same time. The Principal maintains the list of
// regulation names in use and fixes which one applies to each year.
export interface AcademicRegulationSettings {
  regulations: string[];
  // Year of study ("1".."4") -> one of `regulations`. Omitted/empty until fixed.
  yearRegulations: Record<string, string>;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

// ─── Nav visibility (Super Admin controlled module/item hiding) ───────────────
// hiddenModules hides an entire `NavItem.section` group for a role (every item
// whose nearest preceding `section` header matches); hiddenItems hides one
// specific item by href regardless of its module — the mechanism the HOD "My
// Work" submodules use to be hidden individually rather than as a whole group.
// See computeItemModule / filterVisibleNavItems in components/layout/navConfig.ts.
export interface NavVisibilitySettings {
  hiddenModules: Partial<Record<UserRole, string[]>>;
  hiddenItems: Partial<Record<UserRole, string[]>>;
  updatedAt?: Timestamp;
  updatedByName?: string;
}

// ─── Faculty Member (central entity across all modules) ───────────────────────
// All leave, attendance, payroll, appraisal records reference facultyId

// Free text, not a closed enum - real designation ladders vary by
// College.type (see src/lib/designations/config.ts, the single source of
// truth for which values each college type's Add/Edit pickers offer). The
// original fixed codes below ("PROFESSOR" etc.) are still what Engineering/
// Pharmacy/Dental colleges use and what every pre-existing FacultyMember
// record holds - DESIGNATION_LABELS keeps them displaying as words; any
// other college type's designation is already a human-readable string
// (e.g. "PGT", "Controller of Examinations") and needs no label lookup.
export type Designation = string;

export const DESIGNATION_LABELS: Record<string, string> = {
  PROFESSOR: "Professor",
  ASSOCIATE_PROFESSOR: "Associate Professor",
  ASSISTANT_PROFESSOR: "Assistant Professor",
  LECTURER: "Lecturer",
  VISITING_FACULTY: "Visiting Faculty",
  ADJUNCT_FACULTY: "Adjunct Faculty",
  // Technical designations moved to Supporting Staff - kept here too so any
  // FacultyMember record not yet moved by the migration script still
  // displays as a word instead of the raw code.
  LAB_ASSISTANT: "Lab Assistant",
  PROGRAMMER: "Programmer",
  SYSTEM_ADMINISTRATOR: "System Administrator",
  NETWORK_ENGINEER: "Network Engineer",
  OTHER: "Other",
};

export type EmploymentType = "PERMANENT" | "CONTRACT" | "VISITING" | "PART_TIME";

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  VISITING: "Visiting",
  PART_TIME: "Part-Time",
};

// INTERVIEW_DONE — set by provisionFacultyFromOffer the moment an offer letter is
// sent (a FacultyMember + login already exist at that point, well before the
// candidate has actually accepted or joined) and flipped to ACTIVE once the offer
// is marked ACCEPTED (see offer-letters/[id]/route.ts PATCH). Faculty in this
// status haven't joined yet, so their joiningDate is a proposed/expected date —
// UI should read "Expected to join on <date>", not "Joined".
export type FacultyStatus =
  | "INTERVIEW_DONE"
  | "ACTIVE"
  | "ON_LEAVE"
  | "RESIGNED"
  | "RETIRED";

export const FACULTY_STATUS_LABELS: Record<FacultyStatus, string> = {
  INTERVIEW_DONE: "Interview Done",
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
  apaarFacultyId?: string; // NBA/AICTE — APAAR Faculty ID
  name: string;
  email?: string; // personal email — optional, contact only
  phone?: string;
  designation: Designation;
  qualification: string;
  specialization?: string;
  experienceYears: number;
  joiningDate: Timestamp; // Date of Joining Institution
  dateOfJoiningDepartment?: Timestamp; // Date of Joining Department (NBA/AICTE — may differ from institution)
  employmentType: EmploymentType;
  aicteEligible?: boolean; // AICTE Eligibility
  status: FacultyStatus;
  userUid?: string; // links to users/{uid} if they have a system login
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
  legalName?: string; // name as per SSC certificates (CAPITAL LETTERS)
  fatherName?: string; // father or husband name
  motherName?: string;
  religion?: Religion;
  caste?: Caste;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNumber?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  collegeEmail: string; // required — this is the faculty member's login username
  ratificationStatus?: "Ratified" | "Not Ratified";
  ratificationDate?: Timestamp;
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  referral?: string; // referral source/person, if any
  nativePlace?: string;
  temporaryAddress?: string;
  permanentSameAsTemporary?: boolean;
  permanentAddress?: string; // ignored/blank when permanentSameAsTemporary is true
  bloodGroup?: string;
  hasPHD?: boolean;
  internalExperience?: number; // years of experience within the institution
  externalExperience?: number; // years of experience outside the institution
  inCampusExperience?: number; // years of on-campus experience
  industryExperience?: number; // years of industry experience
  researchExperience?: number; // years of research experience
  academicProfile?: FacultyProfileFields; // Modules 1-5 extended profile

  joiningLetterUrl?: string; // Firebase Storage URL for the signed joining letter (uploaded by HOD)
  appointmentLetterUrl?: string; // Firebase Storage URL for the appointment order (uploaded by HOD)
  resumeUrl?: string; // Resume/CV — Teaching Faculty only, no equivalent on SupportingStaffMember
  officialEmail?: string; // institutional email address, if assigned — distinct from collegeEmail (the FMS login username)

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Faculty Academic Profile (Management dashboard / role-aware profile forms) ──
// Extended academic/research fields (Modules 1-5), layered on top of FacultyMember
// (facultyMembers/{id}) and FMSUser (colleges/{id}/users/{uid}) as `academicProfile`.
// Identity/contact fields (name, email, phone, employeeId, designation, department,
// dateOfBirth) live on the host doc itself, not here.

export interface DegreeDetail {
  domain?: string; // Management / Engineering / Arts & Science / Medicine / Law / Others - not applicable to School/Intermediate
  degree: string;
  branch: string;
  specialization?: string; // Doctoral only - replaces the Course/Branch fields for PhD entries
  universityOrInstitute: string;
  percentageOrDivision: string;
  yearOfCompletion: number;
  certificateUrl?: string; // Google Drive public-view link for the degree/transcript certificate
}

// Shared with SupportingStaffProfileFields.qualifications (supportingStaff.ts) -
// reuses DegreeDetail's shape + a free `level` label (e.g. "SSC", "Intermediate",
// "Degree", "Post Graduation") for a repeating list of qualification entries.
// Used by FacultyProfileFields.schoolQualifications for School-type colleges,
// which don't fit the fixed UG/PG/PhD DegreeFields slots below (see
// src/lib/designations/config.ts's SCHOOL_TEACHING_QUALIFICATION_LEVELS /
// SCHOOL_SUPPORTING_QUALIFICATION_LEVELS).
export interface StaffQualification extends DegreeDetail {
  level: string;
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

export interface PreviousInstitution {
  institutionName: string;
  designation?: string;
  fromYear?: number;
  toYear?: number;
  experienceCertificateUrl?: string;
}

// Employment Details — Promotion History (NBA/AICTE).
export interface PromotionRecord {
  fromDesignation: string;
  toDesignation: string;
  effectiveYear: number;
  orderUrl?: string; // promotion order document
}

export interface Publication {
  title: string;
  coAuthors: string;
  journalOrConference: string;
  publicationYear: number;
  indexing?: string; // e.g. SCI, Scopus, WoS, UGC-CARE
  driveLink?: string; // Google Drive public-view link for the published paper
}

// R&D-managed official publication record - attaches to any staff login
// (colleges/{collegeId}/users/{uid}), regardless of role, not just Faculty.
// Stored at colleges/{collegeId}/publications/{id}. Only R_AND_D can write;
// the owner (`uid`) can only read their own rows - see
// src/app/api/college/publications/route.ts. Reuses Publication's field
// names so it renders as a drop-in for the existing Research module UI.
export interface ResearchPublication {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - any role
  ownerName: string;
  ownerRole: UserRole;
  title: string;
  coAuthors: string;
  journalOrConference: string;
  publicationYear: number;
  indexing?: string;
  driveLink?: string;
  // Full citation as one block - authors, "Title", journal, volume/issue/
  // pages, year, doi - exactly as printed on R&D's own report ("Publication
  // Details" column, see src/lib/research/publicationsCsvColumns.ts). title
  // and coAuthors above are parsed out of this at import time (see
  // buildCitationParts in api/college/publications/import/route.ts) so
  // search/sort/the compact list view keep working; this is the rich,
  // display-ready version shown in full on the publication's own view.
  citation?: string;
  // Extra report columns carried by SVECW's own report (see
  // publicationsCsvColumns.ts) - all optional, populated only when the
  // import file (or a later edit) supplies them.
  authorPosition?: string; // First Author / Co-Author / Corresponding Author
  department?: string; // SVECW-First Author's department, as printed on the report
  facultyOrStudent?: string; // "Faculty" or "Student"
  venueType?: string; // Journal / Conference / Book Chapter
  impactFactor?: string; // kept as string - the source report uses "NA" freely
  sjr?: string;
  quartile?: string;
  isbnIssn?: string;
  addedBy: string; // R&D uid who created/last edited it
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface FundedProject {
  title: string;
  fundingAgency: string;
  grantAmountLakhs: number;
  year: number;
  status: string;
  piOrCoPi?: "PI" | "CO_PI";
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

// Shared structured "training/FDP" entry — used by Teaching Faculty Module 5 AND both
// Supporting Staff categories' Training sections (their category-specific types apply).
export type TrainingEntryType =
  | "FDP"
  | "WORKSHOP"
  | "MOOC"
  | "CERTIFICATION"
  | "SKILL_DEVELOPMENT"
  | "ADMINISTRATIVE"
  | "ERP"
  | "OFFICE_AUTOMATION"
  | "OTHER";
export const TRAINING_ENTRY_TYPE_LABELS: Record<TrainingEntryType, string> = {
  FDP: "FDP",
  WORKSHOP: "Workshop",
  MOOC: "MOOC",
  CERTIFICATION: "Certification",
  SKILL_DEVELOPMENT: "Skill Development",
  ADMINISTRATIVE: "Administrative Training",
  ERP: "ERP Training",
  OFFICE_AUTOMATION: "Office Automation Training",
  OTHER: "Other",
};
export type TrainingParticipationRole = "PARTICIPATED" | "CONDUCTED";
export const TRAINING_PARTICIPATION_ROLE_LABELS: Record<
  TrainingParticipationRole,
  string
> = {
  PARTICIPATED: "Participated",
  CONDUCTED: "Conducted",
};
export interface TrainingEntry {
  type: TrainingEntryType;
  role?: TrainingParticipationRole; // did they attend, or run it themselves - applies to any type, not just FDP
  title: string;
  organizer: string;
  year: number;
  durationDays?: number;
  certificateUrl?: string;
}

export type ProfessionalBody =
  | "IEEE"
  | "ISTE"
  | "CSI"
  | "ACM"
  | "IEI"
  | "OTHER";
export const PROFESSIONAL_BODY_LABELS: Record<ProfessionalBody, string> = {
  IEEE: "IEEE",
  ISTE: "ISTE",
  CSI: "CSI",
  ACM: "ACM",
  IEI: "IEI",
  OTHER: "Other",
};
export interface ProfessionalMembership {
  body: ProfessionalBody;
  otherName?: string; // when body === "OTHER"
  membershipId?: string;
  sinceYear?: number;
}

export type AdminResponsibilityCategory =
  | "COORDINATOR"
  | "COMMITTEE_MEMBER"
  | "NBA_NAAC"
  | "IQAC"
  | "EXAMINATION_DUTY"
  | "OTHER";
export const ADMIN_RESPONSIBILITY_CATEGORY_LABELS: Record<
  AdminResponsibilityCategory,
  string
> = {
  COORDINATOR: "Coordinator Role",
  COMMITTEE_MEMBER: "Committee Membership",
  NBA_NAAC: "NBA / NAAC Work",
  IQAC: "IQAC",
  EXAMINATION_DUTY: "Examination Duty",
  OTHER: "Other",
};
export interface AdminResponsibilityEntry {
  category: AdminResponsibilityCategory;
  description: string;
  fromYear?: number;
  toYear?: number; // blank = ongoing
}

// Shared award/recognition entry — Teaching Faculty AND both Supporting Staff categories.
export type AwardCategory =
  | "BEST_TEACHER"
  | "RESEARCH_AWARD"
  | "APPRECIATION_CERTIFICATE"
  | "OTHER";
export const AWARD_CATEGORY_LABELS: Record<AwardCategory, string> = {
  BEST_TEACHER: "Best Teacher Award",
  RESEARCH_AWARD: "Research Award",
  APPRECIATION_CERTIFICATE: "Appreciation Certificate",
  OTHER: "Other",
};
export interface AwardEntry {
  category: AwardCategory;
  title: string;
  awardingBody: string;
  year: number;
  certificateUrl?: string;
}

export interface FacultyProfileFields {
  // Module 1 — Academic Qualification (Engineering/Degree/Polytechnic/Pharmacy/
  // Dental colleges). School-type colleges use schoolQualifications instead -
  // UG/PG/PhD and the PhD-specific fields below don't apply to school teachers
  // (see College.type and src/lib/designations/config.ts).
  highestQualification: string;
  highSchoolDetails?: DegreeDetail; // 10th
  intermediateDetails?: DegreeDetail; // 12th
  ugDetails?: DegreeDetail;
  pgDetails?: DegreeDetail;
  // Extra PG/PhD degrees beyond the primary one above (e.g. a second Master's
  // or a second doctorate). Kept as separate arrays rather than turning
  // pgDetails/phdDetails into arrays so every existing record, export, resume
  // and view that reads the single field keeps working unchanged.
  additionalPgDetails?: DegreeDetail[];
  phdDetails?: DegreeDetail;
  additionalPhdDetails?: DegreeDetail[];
  postDoctoralDetails?: DegreeDetail;
  phdStatus?: PhdStatus;
  phdMode?: PhdMode;
  phdSupervisorName?: string;
  fellowshipsReceived?: string;
  gateQualifiedYear?: number;
  gateScore?: number;
  netSletQualificationYear?: number;
  // School-type colleges only - see SCHOOL_TEACHING_QUALIFICATION_LEVELS.
  schoolQualifications?: StaffQualification[];

  // Previous Institutions Worked / Current Teaching Assignment
  teachingAssignment?: TeachingAssignmentSummary; // omitted for PRINCIPAL / VICE_PRINCIPAL
  previousInstitutions: PreviousInstitution[]; // prior institutions worked at, before this one
  promotionHistory: PromotionRecord[]; // Employment Details — promotions within this institution

  // Module 3 — Research Publications
  publications: Publication[]; // individual publication records — title/co-authors/journal/year
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
  googleScholarId?: string;
  scopusAuthorId?: string;
  orcidId?: string;

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
  // Legacy free-text fields — kept for backward-compat display of pre-existing data only.
  // New entries go into the structured lists below instead (trainingEntries etc.).
  administrativeResponsibilities?: string;
  certificationsAndFdps?: string;
  professionalBodyMemberships?: string;
  authoredBooks: AuthoredBook[];
  notableAwards?: string;
  // Structured NBA/AICTE replacements for the 4 free-text fields above.
  trainingEntries: TrainingEntry[];
  professionalMemberships: ProfessionalMembership[];
  adminResponsibilityEntries: AdminResponsibilityEntry[];
  awardEntries: AwardEntry[];

  // Module 6 — Financial Standing & Budgetary Impact
  presentSalary?: number; // Current Financial Standing — present salary drawn by the faculty member
  grossAnnualCTC?: number; // Budgetary Impact
  incrementsAwarded?: number;
  fundingConsultancyRevenue?: number; // offsets salary cost against research/consultancy grants brought into the institution

  // Module 7 — Others
  otherInformation?: string;
}

// PRINCIPAL / VICE_PRINCIPAL form variant — no teaching-assignment sub-object
export type PrincipalAcademicProfile = Omit<
  FacultyProfileFields,
  "teachingAssignment"
>;

// ─── Academic Year ──────────────────────────────────────────────────────────
// Which years of study exist for a college — added sequentially (1, 2, 3, …)
// by Location Admin / Principal, not toggled from a fixed set. A program can
// have any number of years (3-year diploma, 4-year B.Tech, 5-year, etc.), so
// `yearNumber` is a plain positive integer, not a fixed 1|2|3|4 union.
// Section.year / StudentRecord.year / Department.assignedYears follow the
// same convention for the same reason.

export interface AcademicYear {
  id: string;
  collegeId: string;
  yearNumber: number;
  label: string; // e.g. "1st Year"
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Academic Session ───────────────────────────────────────────────────────
// A calendar academic session for a college (e.g. "2025-26"), distinct from
// AcademicYear above (which models year-of-study 1st–4th, not a calendar
// session). Location Admin (and Principal/Super Admin) create these per
// college; at most one is marked current at a time.

export interface AcademicSession {
  id: string;
  collegeId: string;
  label: string; // e.g. "2025-26"
  isCurrent: boolean;
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
  name: string; // "A", "B", "C" etc.
  year: number; // academic year within the course (1..course.durationYears)
  batch: string; // admission batch e.g. "2023-2027"
  facultyInchargeUid?: string;
  facultyInchargeName?: string;
  classLeaderUid?: string;
  classLeaderName?: string;
  studentCount: number;
  // Secondary — the branch this section feeds, e.g. a shared first-year Basic
  // Science section whose cohort promotes into CSE. Chosen per section from the
  // owning Department's configured `secondaryDepartments` via the Add/Edit
  // Section branch picker (see college/sections POST + [id] PATCH); when the
  // department cross-lists to exactly one branch it's auto-filled. Grants that
  // branch's HOD view-only access, and every student imported into this section
  // inherits it as StudentRecord.secondaryDepartment (their promotion target).
  // Stored plural for legacy shape, but a section commits to a single branch.
  secondaryDepartments?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// GET /api/college/sections response shape — `accessLevel` is computed by the
// route per caller, never persisted. "primary" = caller's own department (or
// caller role sees everyone unscoped, e.g. Principal); "secondary" = view-only,
// for a parent department's HOD looking at a child sub-department's section.
export type SectionListItem = Section & {
  accessLevel: "primary" | "secondary";
};

// ─── Student Record ─────────────────────────────────────────────────────────
// Enrolled-student roster row, independent of any login account. Faculty manage
// this for the sections they're in charge of (Section.facultyInchargeUid).

export type StudentStatus = "REGULAR" | "DETAINED" | "GRADUATED";

export interface StudentRecord {
  id: string;
  collegeId: string;
  department: string; // primary — full access/control (roster, sections, promotion)
  section: string; // Section.name — "A", "B", etc.
  year: number;
  rollNumber: string;
  name: string;
  status: StudentStatus;
  gender?: string;
  dateOfBirth?: string; // yyyy-mm-dd, kept as string (no statutory-date math needed)
  guardianContact?: string;
  email?: string;
  // Secondary — view-only access, for a student pre-registered to a core
  // branch (e.g. CSE) while physically enrolled under Basic Science in 1st
  // year. Only ever set by the College Office bulk import for exactly this
  // case; cleared automatically when the student is promoted into that
  // department (see students/promote/route.ts), at which point it becomes
  // their primary `department` instead.
  secondaryDepartment?: string;
  // ─── Admission-detail fields ────────────────────────────────────────────
  // All optional, all set only via the College Office bulk import (see
  // src/lib/students/importRow.ts) - there is no per-student edit form for
  // any of these today, same as the older gender/dateOfBirth/etc. fields
  // above. Photo is intentionally not collected via CSV import at all.
  //
  // The programme the student is admitted into (B.Tech, M.Tech …), as written
  // on the admission sheet. Free text and purely a record of what that sheet
  // said - it is NOT resolved against the college's `courses` collection, and
  // nothing keys off it; the student's academic scope comes from `department`
  // + `year` as before. "Branch" remains an alias of `department`, but
  // "Course" no longer is: the roster template carries both columns, so
  // reading them as the same field would have made a sheet naming its
  // programme in one and its branch in the other silently unimportable.
  course?: string;
  semester?: number;
  dateOfAdmission?: string; // yyyy-mm-dd
  admissionNo?: string;
  hallTicketNo?: string;
  admissionType?: string; // e.g. Direct, Management, Convenor
  entranceType?: string; // e.g. EAMCET, ECET
  entranceRank?: string;
  seatType?: string; // e.g. Convenor, Management
  scholarship?: boolean;
  category?: string; // caste-reservation category, e.g. OC/BC/SC/ST
  religion?: string;
  nationality?: string;
  motherTongue?: string;
  bloodGroup?: string;
  mobileNo?: string;
  landLineNo?: string;
  aadharNo?: string;
  rationCardNo?: string;
  bankAccountNo?: string;
  lastAttendedInstitution?: string;
  distanceFromResidenceKm?: number;
  hosteller?: boolean;
  physicallyHandicapped?: boolean;
  handicappedType?: "H" | "V" | "O"; // Hearing / Visual / Other - only meaningful when physicallyHandicapped
  identificationMarks?: string;
  remarks?: string;
  // ─── Graduation snapshot ────────────────────────────────────────────────
  // Set once, when `status` flips to GRADUATED (students/promote route). The
  // student's department/section/year are left untouched by graduation (they
  // stay whatever their final-year section was), so these three exist purely
  // to make that final cohort's programme + batch queryable/displayable
  // without joining back to a Section doc that could later be edited or
  // removed - a graduate's record shouldn't be able to drift after the fact.
  graduatedAt?: Timestamp;
  graduationBatch?: string; // Section.batch at graduation, e.g. "2021-2025"
  graduationCourseId?: string;
  graduationCourseName?: string; // e.g. "B.Tech"
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// GET /api/college/students response shape — `accessLevel` is computed by the
// route per caller, never persisted to Firestore. "primary" = full control
// (own department, or caller role sees everyone unscoped e.g. Principal);
// "secondary" = view-only (caller's department matches secondaryDepartment).
export type StudentListItem = StudentRecord & {
  accessLevel: "primary" | "secondary";
};

// Append-only — one entry per (department, section, year) a student has ever
// been enrolled in, written at creation and at every promotion. There is no
// `to` field: an entry's end is implicitly the next entry's `from` (or "now"
// if it's the latest). Lives at
// colleges/{collegeId}/students/{studentId}/departmentHistory/{id}.
export interface StudentDepartmentHistoryEntry {
  id: string;
  department: string;
  section: string;
  year: number;
  from: Timestamp;
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
  | "OFFER_RESPONSE_RECEIVED"
  | "CREDENTIAL_REQUESTED"
  | "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED"
  | "FACULTY_ACCOUNT_REQUEST_COMPLETED"
  | "CANDIDATE_HIRED"
  | "COORDINATOR_ASSIGNED"
  // Teaching (cross-department faculty assignment requests)
  | "FACULTY_ASSIGNMENT_REQUESTED"
  | "FACULTY_ASSIGNMENT_ALLOCATED"
  | "FACULTY_ASSIGNMENT_DECLINED"
  // Leave & Attendance
  | "LEAVE_PENDING_APPROVAL"
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "ATTENDANCE_MANUALLY_MARKED"
  // Permission & On-Duty
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
  // Budget Cycle (Finance → Principal → departments)
  | "BUDGET_CYCLE_RELEASED"
  | "BUDGET_CYCLE_APPROVED"
  | "BUDGET_CYCLE_REJECTED"
  | "BUDGET_CYCLE_RETURNED"
  | "DEPARTMENT_BUDGET_PENDING"
  // Indent (HOD → Purchase → Finance)
  | "INDENT_SUBMITTED"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED"
  | "INDENT_REJECTED"
  | "INDENT_APPROVED"
  | "INDENT_RECEIPT_UPLOADED"
  | "INDENT_GRN_UPLOADED"
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
  // Teaching (cross-department faculty assignment requests)
  | "FACULTY_ASSIGNMENT_REQUESTED"
  | "FACULTY_ASSIGNMENT_ALLOCATED"
  | "FACULTY_ASSIGNMENT_DECLINED"
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
  // ─── Workflow notification framework (optional — absent on older docs) ────
  // See src/lib/notifications/workflowNotifications.ts. `actionable` marks a
  // notification as one that should surface as a login popup until the
  // linked workflow step is completed, at which point the emitting route
  // marks it `resolved` (kept for history, just no longer popped up).
  actionable?: boolean;
  resolved?: boolean;
  entityType?: string;
  entityId?: string;
  dedupeKey?: string;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  // Recruitment module. CANDIDATE_SHORTLISTED/CANDIDATE_ARRIVED/CANDIDATE_STAGE_ADVANCED/
  // HIRING_DECISION_MADE/DOCUMENTS_VERIFIED/JOINING_LETTER_UPLOADED all log targetId as
  // the CandidateApplication id (not the Candidate id) since that's where this state lives.
  | "VACANCY_REQUEST_CREATED"
  | "VACANCY_REQUEST_APPROVED"
  | "VACANCY_REQUEST_REJECTED"
  | "VACANCY_REQUEST_DELETED"
  | "CANDIDATE_ADDED"
  | "CANDIDATE_APPLICATION_CREATED" // candidate attached to a VacancyRequest; targetId is the CandidateApplication id
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
  | "DOCUMENTS_VERIFIED"
  | "JOINING_LETTER_UPLOADED"
  | "CREDENTIAL_REQUESTED"
  | "CREDENTIAL_REQUEST_FULFILLED"
  | "OFFER_ACCEPTED_BY_CANDIDATE"
  | "OFFER_REJECTED_BY_CANDIDATE"
  | "FACULTY_ACCOUNT_REQUEST_SUBMITTED"
  | "FACULTY_ACCOUNT_REQUEST_IN_PROGRESS"
  | "FACULTY_ACCOUNT_REQUEST_CREDENTIALS_CREATED"
  | "FACULTY_ACCOUNT_REQUEST_COMPLETED"
  // User management
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DEACTIVATED"
  | "USER_PASSWORD_RESET"
  | "PROFILE_PHOTO_UPDATED"
  // Faculty module
  | "FACULTY_CREATED"
  | "FACULTY_UPDATED"
  | "FACULTY_STATUS_CHANGED"
  | "FACULTY_DELETED"
  // Supporting Staff module
  | "SUPPORTING_STAFF_CREATED"
  | "SUPPORTING_STAFF_UPDATED"
  | "SUPPORTING_STAFF_DELETED"
  // Leave module
  | "LEAVE_APPLIED"
  | "LEAVE_HOD_APPROVED"
  | "LEAVE_HOD_FORWARDED"
  | "LEAVE_PRINCIPAL_APPROVED"
  | "LEAVE_REJECTED"
  | "LEAVE_CANCELLED"
  | "LEAVE_HISTORY_IMPORTED"
  // Permission & On-Duty
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
  // Budget Cycle (Finance → Principal → departments)
  | "BUDGET_CYCLE_RELEASED"
  | "BUDGET_CYCLE_APPROVED"
  | "BUDGET_CYCLE_REJECTED"
  | "BUDGET_CYCLE_RETURNED"
  // Indent module
  | "INDENT_SUBMITTED"
  | "INDENT_RETURNED_TO_HOD"
  | "INDENT_REJECTED_BY_PURCHASE"
  | "INDENT_SENT_TO_FINANCE"
  | "INDENT_RETURNED_TO_PURCHASE"
  | "INDENT_FINANCE_APPROVED"
  | "INDENT_FINANCE_REJECTED"
  | "INDENT_RECEIPT_UPLOADED"
  | "INDENT_GRN_UPLOADED"
  // Purchase Finance Clearance module
  | "PURCHASE_CLEARANCE_SUBMITTED"
  | "PURCHASE_CLEARANCE_RESUBMITTED"
  | "PURCHASE_CLEARANCE_REJECTED_BY_PURCHASE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_HOD"
  | "PURCHASE_CLEARANCE_SENT_TO_FINANCE"
  | "PURCHASE_CLEARANCE_RETURNED_TO_PURCHASE"
  | "PURCHASE_CLEARANCE_FINANCE_APPROVED"
  | "PURCHASE_CLEARANCE_FINANCE_REJECTED"
  | "PURCHASE_CLEARANCE_GOODS_PURCHASED"
  | "PURCHASE_CLEARANCE_GRN_UPLOADED"
  // Academic Year module
  | "ACADEMIC_YEAR_ADVANCED"
  // Student promotion module
  | "STUDENT_PROMOTED"
  | "STUDENT_GRADUATED";

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
