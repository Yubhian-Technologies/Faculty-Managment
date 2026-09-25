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
  // College Admin mirrors Principal's authority end-to-end (same dashboard,
  // same permissions) - normalized to "PRINCIPAL" for auth purposes in
  // src/app/api/auth/session/route.ts and src/hooks/useAuth.ts, so it stays
  // out of the ~130 file-by-file role===PRINCIPAL checks. Created by the
  // Principal via /principal/staff/new, alongside the non-technical/office roles.
  | "COLLEGE_ADMIN"
  // Provisioned by Super Admin (Add User, L3 · College Leadership) rather
  // than by the Principal, but authority-wise follows the exact same
  // COLLEGE_ADMIN -> PRINCIPAL normalization pattern: same dashboard, same
  // permissions, `role` always reads "PRINCIPAL" once logged in, and the
  // Firestore doc keeps its real "DIRECTOR" role so it still shows up as its
  // own entry in staff lists.
  | "DIRECTOR"
  | "HOD"
  // A department's own office head, appointed by its HOD. Carries the SAME
  // authority as that HOD over that department, so it is normalized to "HOD"
  // for auth purposes in src/app/api/auth/session/route.ts and
  // src/hooks/useAuth.ts - exactly the COLLEGE_ADMIN -> PRINCIPAL pattern
  // above, and for the same reason: it keeps the role out of the ~420
  // file-by-file role==="HOD" checks, which can never drift out of step as a
  // result. `realRole` still reports the truth, which is what fences off the
  // few things they may NOT do (appoint another one, remove a Sub-HOD).
  | "DEPARTMENT_OFFICE"
  | "COLLEGE_OFFICE"
  | "COLLEGE_STAFF"
  | "ACADEMICS"
  | "IQAC_COORDINATOR"
  | "T_AND_P"
  | "R_AND_D"
  // Per-department seat: first-level reviewer of that department's Research &
  // Innovation submissions before they reach R&D. Held on top of a faculty login.
  | "RND_COORDINATOR"
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
  COLLEGE_ADMIN: "College Admin",
  DIRECTOR: "Director",
  HOD: "Head of Department",
  DEPARTMENT_OFFICE: "Department Office",
  COLLEGE_OFFICE: "College Office",
  COLLEGE_STAFF: "College Staff",
  ACADEMICS: "Academics",
  IQAC_COORDINATOR: "IQAC Coordinator",
  T_AND_P: "T&P",
  R_AND_D: "R&D",
  RND_COORDINATOR: "R&D Coordinator",
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

// Every role a Principal/VP can already view/edit/deactivate (see
// loadTargetInScope in api/college/users/[uid]/route.ts) - also every role a
// staff member can be PROMOTED into from the Staff tab on Promotions
// (any-to-any, no fixed ladder). Exported here (rather than duplicated
// client + server) since it's shared by that server route and the client
// Staff Promotions panel. Deliberately excludes PRINCIPAL/SUPER_ADMIN/DIRECTOR
// - Principal-tier accounts are provisioned by Super Admin, separately from
// this Principal/VP-managed staff roster (COLLEGE_ADMIN stays included: it's
// the one Principal-tier role a Principal itself appoints).
export const MANAGEABLE_STAFF_ROLES: UserRole[] = [
  "HOD", "DEPARTMENT_OFFICE", "COLLEGE_OFFICE", "VICE_PRINCIPAL", "COLLEGE_ADMIN", "COLLEGE_STAFF",
  "ACADEMICS", "IQAC_COORDINATOR", "T_AND_P", "R_AND_D", "RND_COORDINATOR", "PLACEMENT_DEPT", "LIBRARY", "EXAM_CELL",
  "PANEL_MEMBER", "WEBMASTER", "COLLEGE_ACCOUNTS",
];

export const ROLE_DASHBOARD_PATHS: Record<UserRole, string> = {
  SUPER_ADMIN: "/super-admin",
  MANAGEMENT: "/management/dashboard",
  ADMINISTRATION: "/administration",
  HR_ADMIN: "/hr-admin",
  ADMIN_OFFICE: "/admin-office",
  LOCATION_DEPT_HEAD: "/location-dept-head",
  PRINCIPAL: "/principal",
  VICE_PRINCIPAL: "/vice-principal",
  COLLEGE_ADMIN: "/principal",
  DIRECTOR: "/principal",
  HOD: "/hod",
  DEPARTMENT_OFFICE: "/hod",
  COLLEGE_OFFICE: "/college-office",
  COLLEGE_STAFF: "/college-staff",
  ACADEMICS: "/academics",
  IQAC_COORDINATOR: "/iqac-coordinator",
  T_AND_P: "/t-and-p",
  R_AND_D: "/r-and-d",
  RND_COORDINATOR: "/rnd-coordinator",
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
  COLLEGE_ADMIN: 3,
  DIRECTOR: 3,
  HOD: 4,
  DEPARTMENT_OFFICE: 4,
  COLLEGE_OFFICE: 4,
  COLLEGE_STAFF: 4,
  ACADEMICS: 4,
  IQAC_COORDINATOR: 4,
  T_AND_P: 4,
  R_AND_D: 4,
  RND_COORDINATOR: 4,
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
  COLLEGE_ADMIN: "COLLEGE",
  DIRECTOR: "COLLEGE",
  HOD: "COLLEGE",
  DEPARTMENT_OFFICE: "COLLEGE",
  COLLEGE_OFFICE: "COLLEGE",
  COLLEGE_STAFF: "COLLEGE",
  ACADEMICS: "COLLEGE",
  IQAC_COORDINATOR: "COLLEGE",
  T_AND_P: "COLLEGE",
  R_AND_D: "COLLEGE",
  RND_COORDINATOR: "COLLEGE",
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
// BC (Backward Class) is split straight into its AP/Telangana reservation
// groups (BC-A/B/C/D/E) rather than a single "BC" value with a separate BC
// Category field - there is no longer a bare "BC" option.
export type Caste = "OC" | "EBC" | "EPC" | "BC-A" | "BC-B" | "BC-C" | "BC-D" | "BC-E" | "SC" | "ST" | "OTHER";
export const CASTE_LABELS: Record<Caste, string> = {
  OC: "OC",
  EBC: "EBC",
  EPC: "EPC",
  "BC-A": "BC-A",
  "BC-B": "BC-B",
  "BC-C": "BC-C",
  "BC-D": "BC-D",
  "BC-E": "BC-E",
  SC: "SC",
  ST: "ST",
  OTHER: "Other",
};

// Sub-caste picklist per Caste (state reservation sub-categories) - values
// are stored and displayed verbatim (no separate code/label split, unlike
// Religion/Caste above) since they're only ever used as freeform sub-
// classification text. EPC has no fixed list here - its Sub Caste field
// falls back to free text, same as "OTHER" does for every caste.
//
// The BC-A/B/C/D/E lists below are all the same, full set of sub-castes that
// used to sit under one shared "BC" value - the real per-category split
// hasn't been captured yet, so each of the five picks from this same list for
// now until that mapping is defined.
const BC_SUB_CASTES = [
  "Devanga", "Kummari", "Nai Brahmin", "Kalinga", "Gowda", "Cristian", "Kurama",
  "Korpula Velama", "Vishwa Brahmin", "Agnikula Kshatriya", "Turupu Kapu",
  "Karnibakthulu", "Settibalija", "Padmasali", "Rajaka", "Sri Sayana",
  "Munnurukapu", "Yadava", "Velama", "Surya Balija", "Kummara", "Poosala",
  "Jangam", "Perika", "Sagara", "Christian Mala", "Bhatraju", "Kambali",
  "Uppara", "Bondili", "Vyshnavas", "Bukka", "Mutrasi", "Adi Andhra Christian",
  "Telukula",
];
export const SUB_CASTES_BY_CASTE: Partial<Record<Caste, string[]>> = {
  OC: [
    "Brahmin", "Kshatriya", "Vysya", "Kapu", "Reddy", "Aryavysya", "Kamma", "Naidu",
    "Adi Velama", "Arya Vyshya", "Marvadi", "Veerashaiva Lingayat", "Balija",
    "Padmanayaka Velamadoralu", "Vellama",
  ],
  EBC: ["Faqir", "Muslim", "Shaik"],
  "BC-A": BC_SUB_CASTES,
  "BC-B": BC_SUB_CASTES,
  "BC-C": BC_SUB_CASTES,
  "BC-D": BC_SUB_CASTES,
  "BC-E": BC_SUB_CASTES,
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
  // The Firestore doc's real, un-normalized role - only ever differs from
  // `role` for COLLEGE_ADMIN or DIRECTOR, which `role` always reports as
  // "PRINCIPAL" (see useAuth.ts / api/auth/session). Exists solely so a
  // specific feature can opt out College Admin from something Principal sees
  // (e.g. navConfig's NavItem.hideForRealRoles) without disturbing the
  // "College Admin behaves exactly like Principal" normalization everywhere
  // else. Don't use this for
  // anything other than that kind of narrow exclusion - `role` remains the
  // one source of truth for permissions.
  realRole?: UserRole;
  // Every role this login can act as: `role` (the primary one) plus the role of
  // each seat they hold (see types/roleSeats.ts). Set by /api/auth/session; the
  // sidebar and page access are the union of all of them.
  roles?: UserRole[];
  // Denormalized from the seats this person holds (maintained by
  // lib/roles/seats.ts) - `seatRoles` is what guards and role lookups read.
  seatIds?: string[];
  seatRoles?: UserRole[];
  // for HOD / LOCATION_DEPT_HEAD - kept as the first entry of `departments`
  // (the HOD's "primary" department) for every screen that hasn't been
  // updated to the multi-department list below; always write both together.
  department?: string;
  // Every department this HOD heads (HOD only - a college HOD can now run
  // more than one department at once, assigned from the Principal's
  // Departments page; see src/lib/departments/scope.ts). Falls back to
  // `[department]` wherever a doc predates this field.
  departments?: string[];
  locationDeptId?: string; // for LOCATION_DEPT_HEAD - exactly one department they head
  // For HR_ADMIN / ADMIN_OFFICE / ACCOUNTS only - which location department(s)
  // this staff member covers. `allLocationDepts` (when true) takes precedence
  // over `locationDeptIds` and is resolved dynamically against whatever
  // departments exist at read time - never a denormalized snapshot, so a
  // department created after this was set is still covered, unlike freezing
  // today's department id list into the doc.
  locationDeptIds?: string[];
  allLocationDepts?: boolean;
  sectionId?: string; // for CLASS_LEADER - the one Section this login is bound to
  sectionName?: string; // for CLASS_LEADER - denormalized Section.name
  employeeId?: string; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  designation?: string; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  dateOfBirth?: Timestamp; // for PRINCIPAL / VICE_PRINCIPAL / HOD profile forms
  // Collected at account-creation time (see api/college/users, api/administration/
  // college-staff) so a role with no FacultyMember/SupportingStaff record of its
  // own (HOD/PRINCIPAL/VICE_PRINCIPAL/ACADEMICS/COLLEGE_OFFICE/ACCOUNTS/FINANCE/IQAC/
  // T&P/R&D/Library/Exam Cell/Webmaster/Placement Dept, ...) doesn't wrongly
  // default into the leave module's "new joining" category from its login's own
  // createdAt - see resolveEmployeeIdentity in lib/leave/identity.ts.
  dateOfJoining?: Timestamp;
  profilePhotoUrl?: string; // Firebase Storage download URL, same field name as FacultyMember below

  // Personal / statutory details (same field names as FacultyMember below, for consistency)
  gender?: "Male" | "Female" | "Other";
  legalName?: string; // name as per SSC certificates (CAPITAL LETTERS)
  fatherName?: string;
  motherName?: string;
  religion?: Religion;
  caste?: Caste;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNo?: string;
  bankAccountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  bankBranch?: string;
  bankOtherDetails?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string; // relation of the emergency contact to this person
  emergencyContactMobileNo?: string;
  ratificationStatus?: "Ratified" | "Not Ratified";
  ratificationProceedingsNumber?: string;
  ratificationDate?: Timestamp; // Ratification Proceedings Date
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  temporaryAddress?: string;
  permanentAddressSameAsTemporary?: boolean;
  permanentAddress?: string; // ignored/blank when permanentAddressSameAsTemporary is true
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
  // Only meaningful when hasSubDepartments is true: does THIS department also
  // enroll students / run sections directly under its own name, in addition
  // to its sub-departments? True for e.g. an "ECE" that has real ECE sections
  // AND a further-specialized "ECE-VLSI" sub-department with sections of its
  // own. False for a department that exists only to organize its
  // sub-departments and never houses a student directly - e.g. a "Basic
  // Science" whose sub-departments (Maths, Physics, Chemistry, English) are
  // the only place a 1st-year student actually sits, with the real branch
  // they're headed for named via that student's own secondaryDepartment
  // instead (see freshmanLandingDepartmentNames's own doc-comment,
  // src/lib/college/academicStructure.ts). The two shapes are structurally
  // IDENTICAL otherwise (both hasSubDepartments:true, both can have a parent
  // that claims year 1 with real children) - not inferable from any other
  // field, so this is a deliberate, Principal-set exception to this file's
  // usual "infer everything, never store a flag" rule. UNSET is treated as
  // `true` everywhere it's read - the behavior every department had before
  // this field existed - so no already-configured department's behavior
  // changes until a Principal explicitly unchecks it for one specific parent.
  parentRunsOwnSections?: boolean;
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
  // Sub-departments only: CourseCatalogItem.ids the parent offers that THIS
  // sub-department does not. A sub-department shows its parent's courses by
  // default (it owns no Course doc of its own until it customises one), which
  // is right when every child runs the same programmes - but not when they
  // diverge, e.g. an AI department whose AIML child runs both B.Tech and
  // M.Tech while its AIDS child runs only the B.Tech. Removing a shared
  // course from a child records it here rather than deleting the parent's
  // Course doc, which is shared by every sibling.
  //
  // Deliberately keyed by catalogId, not courseId: it has to survive the
  // parent deleting and re-adding its own Course doc for the same programme,
  // exactly like courseScopes above. Resolve through
  // resolveSubDepartmentCourses() (src/lib/departments/subDepartmentCourses.ts),
  // never read directly - an exclusion is only one of the three things that
  // decide whether a child shows a parent's course.
  excludedCourseCatalogIds?: string[];
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
  // Curriculum regulation codes (e.g. R20, R23) this course uses - a different
  // course can have an entirely different set. Created directly here (typing a
  // new code registers it, typing an existing one reuses it - no separate
  // college-wide "declare a regulation" step). Empty/absent until the Academics
  // (or Principal/Super Admin) assigns at least one here - regulation is
  // OPTIONAL though, never a gate: a subject can still be added to a Course
  // from this catalog entry even with no regulation resolved for it (see
  // api/college/subjects POST, which tags the subject with whatever
  // regulation resolves, or none).
  regulations?: string[];
  // Every intake batch each of the above `regulations` covers, as a
  // comma-separated list of "start-end" ranges (e.g. R23 ->
  // "2023-2027,2024-2028,2025-2029" - a regulation adopted for the 2023
  // intake still covering the 2024 and 2025 intakes until superseded). Each
  // entry's END year is descriptive only (this course's own durationYears at
  // the time it was added) - only the START year is ever read
  // (parseBatchStartYear/regulationsForCourseYearByBatch), so which ordinal
  // year of THIS course a regulation currently governs is resolved from the
  // start year versus today's session, not stored directly - the same
  // student cohort's ordinal year keeps advancing every session while their
  // regulation stays fixed to their intake year.
  regulationBatches?: Record<string, string>;
  isActive: boolean;
  createdBy?: string;
  createdByName?: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Designation Catalog (admin-curated job titles — same "add it here once,
// pick it everywhere else" model as CourseCatalogItem above) ──────────────────
// Nothing hardcoded per college type any more (see src/lib/designations/config.ts's
// now-removed per-college-type lists) - each college's own admin builds their own
// list, starting empty for a new college. Faculty/Add Technical Staff/Add
// Non-Technical Staff, CSV import validation, and the Hiring role picker all read
// this same collection, filtered by `category`, instead of a picker offering an
// "Other" free-text escape hatch.
export type DesignationCategory = "FACULTY" | "TECHNICAL" | "NON_TECHNICAL";
export type DesignationCadre = "PROFESSOR" | "ASSOCIATE_PROFESSOR" | "ASSISTANT_PROFESSOR";

export interface DesignationCatalogItem {
  id: string;
  collegeId: string;
  name: string; // admin-entered, e.g. "Professor", "Senior Lab Technician"
  category: DesignationCategory;
  // Optional AICTE cadre-ratio tag (Faculty only) - lets a fully custom title
  // still count toward Professor/Associate/Assistant Professor compliance
  // reporting (api/college/faculty-requirement) instead of that route needing
  // to match a fixed literal string like the old hardcoded codes did.
  cadre?: DesignationCadre;
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
  // Response-only, never persisted - set by GET /api/college/courses when this
  // doc represents a group of duplicate Course docs for the same department +
  // conceptual course (see lib/departments/courseGrouping.ts). Every doc id in
  // the group, including this course's own `id` - callers that filter
  // Firestore queries by an exact courseId picked from this list should widen
  // to `where("courseId", "in", mergedCourseIds)` instead of a single `==`,
  // since teachingAssignments/sections/etc. may be split across the group
  // (a legacy pre-catalog course doc alongside a properly catalog-linked one -
  // see scripts/fix-course-catalog-duplicates.mjs for the root cause).
  mergedCourseIds?: string[];
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

// One semester's calendar span (not to be confused with the daily
// collegeStartTime/collegeEndTime above, which bound a single DAY, not a
// date range). `semester` is a free-standing number, not fixed at 2 -
// Office/Principal decides how many semesters a given course-year has and
// adds/removes entries accordingly (see CourseYearTimingForm.tsx).
export interface SemesterDuration {
  semester: number; // 1, 2, 3, ...
  startDate: Timestamp;
  endDate: Timestamp;
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
  // This academic year's semester date ranges - however many Office/
  // Principal has configured, sorted by `semester`. Which one is "current"
  // for a given date resolves via lib/college/semester.ts's
  // resolveCurrentSemester. Absent/empty means this year has no semester
  // concept yet - the timetable behaves as one continuous whole-year
  // timetable until at least one semester is added.
  semesters?: SemesterDuration[];
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// ─── Timetable Incharge ────────────────────────────────────────────────────────
// One person - either a PANEL_MEMBER (teaching faculty, from `facultyMembers`)
// or a COLLEGE_STAFF member with `staffCategory === "TECHNICAL"` (from
// `supportingStaff`; NON_TECHNICAL supporting staff are Principal/College-
// Office-managed and college-wide, so not eligible here) - the HOD delegates
// a specific course-year's Timetable AND Teaching Assignments to - a
// co-editor, not a handoff: the HOD keeps full access too. Doc id matches
// CourseYearTiming's own convention
// (`${courseId}_year${year}`) so a department can hand off different years to
// different people (e.g. 2nd Year to one person, 3rd Year to another) - see
// lib/departments/timetableIncharge.ts for the authorization check every
// Timetable/Teaching-Assignments write route uses alongside its existing
// HOD-scope check.
export interface TimetableIncharge {
  id: string; // `${courseId}_year${year}`
  collegeId: string;
  departmentId: string;
  departmentName: string;
  courseId: string;
  courseName: string;
  year: number;
  // The person's LOGIN uid (matches session.uid in every authorization check
  // - see lib/departments/timetableIncharge.ts), NOT their FacultyMember
  // DOCUMENT id - deliberately distinct naming from TeachingAssignment.
  // facultyId/TimetableSlot.facultyId, which key off the FacultyMember doc id
  // instead (see resolveFacultyMemberId). A FacultyMember with no `userUid`
  // (no system login yet) can't be made Incharge - nothing to authenticate as.
  uid: string;
  facultyName: string;
  assignedBy: string;
  assignedByName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  // Which approval tier each requester role's leave request goes to first
  // (see src/lib/leave/approvalRouting.ts). A role with no entry here uses the
  // built-in default for that role.
  leaveApprovalRouting?: Partial<Record<UserRole, "HOD" | "PRINCIPAL" | "VICE_PRINCIPAL" | "MANAGEMENT">>;
  // Per requester role: true = vacation staff (teaching-style leave), false =
  // non-vacation (see src/lib/leave/staffCategoryRouting.ts). A role with no
  // entry keeps its built-in default.
  leaveVacationRoles?: Partial<Record<UserRole, boolean>>;
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

// Free text, not a closed enum - each college's own admin decides its real
// designation ladder via the Designation Catalog (colleges/{id}/designations,
// category "FACULTY" - see DesignationCatalogCard), so a value here is
// whatever that college's admin typed in. The fixed codes below ("PROFESSOR"
// etc.) are what every pre-existing FacultyMember record (created before the
// catalog existed) holds - DESIGNATION_LABELS keeps them displaying as
// words; a newer, admin-typed designation is already human-readable and
// needs no label lookup (see designationLabel's raw-value fallback).
export type Designation = string;

export const DESIGNATION_LABELS: Record<string, string> = {
  PROFESSOR: "Professor",
  ASSOCIATE_PROFESSOR: "Associate Professor",
  ASSOCIATE_PROFESSOR_SR: "Associate Professor (Sr)",
  ASSISTANT_PROFESSOR: "Assistant Professor",
  LECTURER: "Lecturer",
  VISITING_FACULTY: "Visiting Faculty",
  ADJUNCT_FACULTY: "Adjunct Faculty",
  // LECTURER/VISITING_FACULTY/ADJUNCT_FACULTY above stay mapped for any
  // pre-existing record still holding one of those older titles.
  VISITING_PROFESSOR: "Visiting Professor",
  ASSISTANT_PROFESSOR_OF_PRACTICE: "Assistant Professor of Practice",
  PROFESSOR_OF_PRACTICE: "Professor of Practice",
  SR_WELLNESS_COUNSELLOR: "Sr. Wellness Counsellor",
  // Technical designations moved to Supporting Staff - kept here too so any
  // FacultyMember record not yet moved by the migration script still
  // displays as a word instead of the raw code.
  LAB_ASSISTANT: "Lab Assistant",
  PROGRAMMER: "Programmer",
  SYSTEM_ADMINISTRATOR: "System Administrator",
  NETWORK_ENGINEER: "Network Engineer",
  OTHER: "Other",
};

// FacultyMember.employeeCategory - set on Add Faculty's "Identity &
// Employment" step and by the hiring pipeline's provisioning step, editable
// afterward only by HOD/Principal/VP (see FacultyMember.employeeCategory's
// own doc-comment). Exactly the keys of EMPLOYEE_CATEGORY_LABELS below are
// accepted anywhere this is set - no catalog, no free text. Professor of
// Practice / Asst.prof. of Practice are employee categories (how the person is
// engaged), not designations; a person's designation is a separate field.
export type EmployeeCategory =
  | "REGULAR" | "VISITING" | "CONTRACT" | "PART_TIME"
  | "PROFESSOR_OF_PRACTICE" | "ASST_PROF_OF_PRACTICE";
export const EMPLOYEE_CATEGORY_LABELS: Record<EmployeeCategory, string> = {
  REGULAR: "Regular",
  VISITING: "Visiting",
  CONTRACT: "Contract",
  PART_TIME: "Part Time",
  PROFESSOR_OF_PRACTICE: "Professor of Practice",
  ASST_PROF_OF_PRACTICE: "Asst.prof. of Practice",
};
// Single source of truth for API validation (faculty POST/PATCH, faculty
// account requests) so the accepted list can't drift between routes.
export const EMPLOYEE_CATEGORY_VALUES = Object.keys(EMPLOYEE_CATEGORY_LABELS) as EmployeeCategory[];
export const EMPLOYEE_CATEGORY_ERROR_MESSAGE = `Employee Category must be one of ${Object.values(EMPLOYEE_CATEGORY_LABELS).join(", ")}`;

// Legacy type FacultyMember.employmentType used to share before that field
// was retired in favor of EmployeeCategory above. Salary Structures/Budget
// (src/lib/budget/applySalaryStructurePricing.ts, BudgetItemsTable.tsx)
// still store/select this exact shape for their own records, independent of
// the faculty side; PERMANENT there maps to REGULAR on the faculty side (the
// other 3 values are spelled the same in both) - see toLegacyEmploymentType
// in BudgetItemsTable.tsx.
export type EmploymentType = string;

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
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
// RETAINERSHIP — functionally equivalent to ACTIVE for availability/teaching
// purposes (see isFacultyAvailable below); kept as its own status because it's
// a distinct engagement type, but salary/HR rules for it aren't modeled yet.
export type FacultyStatus =
  | "INTERVIEW_DONE"
  | "ACTIVE"
  | "ON_LEAVE"
  | "RESIGNED"
  | "RETIRED"
  | "RETAINERSHIP";

export const FACULTY_STATUS_LABELS: Record<FacultyStatus, string> = {
  INTERVIEW_DONE: "Interview Done",
  ACTIVE: "Active",
  ON_LEAVE: "On Leave",
  RESIGNED: "Resigned",
  RETIRED: "Retired",
  RETAINERSHIP: "Retainership",
};

// Statuses that count as "currently available to work" - the only ones that
// should ever appear in a faculty picker/assignment/headcount (Teaching
// Assignments, Sections' Faculty Incharge, Timetable, budget headcounts,
// etc.). Everything else (ON_LEAVE/RESIGNED/RETIRED/INTERVIEW_DONE) stays
// visible in the Faculty Register for historical/reference purposes but must
// never be selectable as a working faculty member.
export const AVAILABLE_FACULTY_STATUSES: FacultyStatus[] = ["ACTIVE", "RETAINERSHIP"];
export function isFacultyAvailable(status: FacultyStatus | string | undefined): boolean {
  return !!status && (AVAILABLE_FACULTY_STATUSES as string[]).includes(status);
}

// The statuses a human can pick from the Add/Edit Faculty status dropdown -
// every status except INTERVIEW_DONE, which is system-managed only (set by
// the hiring pipeline, see provisionFacultyFromOffer/applyOfferDecision -
// never chosen directly). Single source of truth for both the form UI and
// server-side validation (faculty POST/PATCH), so the accepted list can't
// drift between routes - mirrors EMPLOYEE_CATEGORY_VALUES below.
export const SELECTABLE_FACULTY_STATUS_VALUES = (Object.keys(FACULTY_STATUS_LABELS) as FacultyStatus[]).filter(
  (s) => s !== "INTERVIEW_DONE"
);
export const FACULTY_STATUS_ERROR_MESSAGE = `Status must be one of ${SELECTABLE_FACULTY_STATUS_VALUES.map((s) => FACULTY_STATUS_LABELS[s]).join(", ")}`;

// Which stored date field records "when" a faculty member's status changed to
// this value - only the three that mark leaving/entering a distinct
// engagement phase carry one; ACTIVE/ON_LEAVE/INTERVIEW_DONE don't. Each date
// stays on record even if status later changes again (e.g. resigned, later
// rehired, later retired) - nothing here is ever auto-cleared, so a faculty
// member's full history of these transitions is never lost to a later one
// overwriting it. Single source of truth for the Add/Edit forms' conditional
// date field, their required-if-status-matches validation, and the Faculty
// Register's Duration filter (see facultyActiveDuringRange in
// lib/faculty/activeDuration.ts).
export type FacultyStatusDateField = "resignedDate" | "retiredDate" | "retainershipDate";
export const FACULTY_STATUS_DATE_FIELD: Partial<Record<FacultyStatus, FacultyStatusDateField>> = {
  RESIGNED: "resignedDate",
  RETIRED: "retiredDate",
  RETAINERSHIP: "retainershipDate",
};
export const FACULTY_STATUS_DATE_LABELS: Record<FacultyStatusDateField, string> = {
  resignedDate: "Resignation Date",
  retiredDate: "Retirement Date",
  retainershipDate: "Retainership Date",
};

export interface FacultyMember {
  id: string;
  collegeId: string;
  department: string;
  employeeId: string;
  apaarFacultyId?: string; // NBA/AICTE — APAAR Faculty ID
  email?: string; // personal email — optional, contact only
  mobileNo?: string; // "Mobile No" (legacy key: phone - see fieldRenames.ts / facultyMobileNo())
  // Extra contact numbers beyond the primary Mobile No above - each with an
  // optional freeform label the HOD chooses (e.g. "Personal", "WhatsApp", or
  // just whoever's number it is), not a fixed category.
  additionalPhoneNumbers?: { label?: string; number: string }[];
  designation: Designation;
  highestQualification: string;
  specialization?: string;
  totalYearsOfExperience: number;
  joiningDate: Timestamp; // Date of Joining Institution
  // Set on the "Identity & Employment" step of Add Faculty and by the hiring
  // pipeline's provisioning step (src/lib/firestore/facultyProvisioning.ts);
  // editable afterward only by HOD/Principal/VP via PATCH /api/college/faculty/[id].
  // Also read by Salary Structures/Budget auto-pricing
  // (src/lib/budget/applySalaryStructurePricing.ts) - see EmployeeCategory's
  // own doc-comment for how that legacy-keyed feature maps to this.
  employeeCategory?: EmployeeCategory;
  aicteFacultyId?: string;
  status: FacultyStatus;
  // Set when status is (or was ever) changed to RESIGNED/RETIRED/RETAINERSHIP
  // respectively - see FACULTY_STATUS_DATE_FIELD's own doc-comment above for
  // why these are three separate, never-auto-cleared fields rather than one.
  resignedDate?: Timestamp;
  retiredDate?: Timestamp;
  retainershipDate?: Timestamp;
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
  // Full Name (as per SSC certificates, CAPITAL LETTERS) - the faculty
  // member's PRIMARY/required identity name (enforced at the Add/Import
  // layer, not the type itself, since a legacy record may predate this).
  // See facultyDisplayName() (src/lib/faculty/facultyDisplayName.ts).
  legalName?: string;
  nameAsPerAadhar?: string; // name exactly as printed on the Aadhar card
  // Name (as per PAN) - optional statutory-matching detail, independent of legalName
  // (like nameAsPerAadhar); never a display name. legalName is the ONLY identity/display
  // name - use facultyDisplayName() (src/lib/faculty/facultyDisplayName.ts) to show it.
  nameAsPerPan?: string;
  fatherName?: string;
  motherName?: string;
  religion?: Religion;
  caste?: Caste;
  subCaste?: string;
  aadharNo?: string;
  panNo?: string;
  passportNo?: string;
  differentlyAbled?: boolean;
  differentlyAbledDetails?: string; // nature of disability, if applicable
  bankAccountNumber?: string; // salary account number
  ifscCode?: string; // salary account's bank IFSC code
  bankName?: string;
  bankBranch?: string;
  bankOtherDetails?: string;
  emergencyContactName?: string;
  emergencyContactRelation?: string; // relation of the emergency contact to this person
  emergencyContactMobileNo?: string;
  collegeEmail: string; // required — this is the faculty member's login username
  ratificationStatus?: "Ratified" | "Not Ratified";
  // Historical ratification record(s) - see RatificationRecord's own doc-comment
  // below. A doc saved before this existed may still only carry the legacy flat
  // fields right below with no `ratifications` array; ratificationRecordsFromDoc()
  // (lib/faculty/ratificationHistory.ts) reads those as a single entry (Designation
  // left blank) until the record is re-saved, which migrates it to this shape.
  ratifications?: RatificationRecord[];
  /** @deprecated superseded by `ratifications` above - still read for legacy docs, never written by current code. */
  ratificationProceedingsNumber?: string;
  /** @deprecated superseded by `ratifications` above - still read for legacy docs, never written by current code. */
  ratificationDate?: Timestamp;
  maritalStatus?: "Single" | "Married";
  spouseName?: string;
  numberOfChildren?: number;
  temporaryAddress?: string;
  permanentAddressSameAsTemporary?: boolean;
  permanentAddress?: string; // ignored/blank when permanentAddressSameAsTemporary is true
  bloodGroup?: string;
  motherTongue?: string;
  languagesKnown?: string[];
  // Height as "<feet>.<inches>" - e.g. "5.7" = 5 ft 7 in, "5.11" = 5 ft 11 in
  // (inches 0-11). A string, not a number, so two-digit inches (.10/.11)
  // aren't silently collapsed by float parsing (5.10 === 5.1). See
  // migrateHeight() in lib/faculty/fieldRenames.ts for the legacy
  // heightFeet/heightInches -> height migration.
  height?: string;
  weightKg?: number;
  pfNumber?: string; // Provident Fund number
  uanNumber?: string; // Universal Account Number (EPFO) - shown right after PF Number
  // Internal Experience (time served since Date of Joining) and External
  // Experience (Academic + Industry + Research Experience entries combined,
  // see academicProfile below) are NOT stored fields - both are computed
  // live from joiningDate/academicProfile wherever shown (see
  // totalYearsOfExperience/allPreviousExperienceEntries in
  // src/lib/faculty/experienceCalc.ts), so they can never go stale.
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

// Storage keys match the Faculty Details UI labels (Course, Institution Name,
// Place, Percentage / CGPA, Year of Passing / Year of Award, Hall Ticket Number,
// ...). Legacy records (degree, universityOrInstitute, location,
// percentageOrDivision, yearOfCompletion, guideOrSupervisorName,
// certificateNumber) are lifted at read time - see src/lib/faculty/fieldRenames.ts.
export type DegreeType = "B.Tech" | "BE" | "M.Tech" | "ME";

export interface DegreeDetail {
  domain?: string; // Management / Engineering / Arts & Science / Medicine / Law / Others - not applicable to School/Intermediate
  course: string; // UI label "Course" at every level (blank for Doctoral, which uses specialization instead)
  // UG/PG only, and only when course is "B.Tech/BE" (B.Tech | BE) or "M.Tech/ME" (M.Tech | ME) -
  // which of the two the qualification actually is. Required then (see lib/faculty/degreeType.ts); absent for every other course.
  degreeType?: DegreeType;
  branch: string;
  specialization?: string; // Doctoral only - replaces the Course/Branch fields for PhD entries
  board?: string; // School/Intermediate only - the examining board (e.g. "State Board", "CBSE")
  // UG/PG only - whether institutionName below names a University or an
  // Institute; an Institute is typically affiliated to a University, which
  // affiliatedUniversity records separately.
  institutionType?: "UNIVERSITY" | "INSTITUTE";
  affiliatedUniversity?: string; // UG/PG only, when institutionType === "INSTITUTE"
  institutionName: string;
  place?: string; // city/town where the institute is located
  percentageCgpa: string;
  // "Year of Passing" everywhere except Doctoral/Post-Doctoral, which use
  // yearOfAward below. See degreeYear() for reading whichever applies.
  yearOfPassing?: number;
  // Doctoral/Post-Doctoral only - "Year of Award", shown only once this entry's
  // own status (below) is AWARDED.
  yearOfAward?: number;
  yearOfRegistration?: number; // Doctoral/Post-Doctoral only
  // Doctoral/Post-Doctoral only, shown instead of yearOfAward while
  // this entry's own status is PURSUING (not yet awarded, so no year yet -
  // who's guiding it instead).
  nameOfTheGuideSupervisor?: string;
  // Doctoral/Post-Doctoral only - this specific degree entry's own Awarded/
  // Pursuing status and Full-Time/Part-Time mode. Lives on the entry itself
  // (not a single FacultyProfileFields-level scalar) so a second/third
  // doctorate (see additionalPhdDetails) can each have their own.
  status?: PhdStatus;
  mode?: PhdMode;
  hallTicketNumber?: string; // hall ticket / registration number printed on the degree certificate
  certificateUrl?: string; // Google Drive public-view link for the degree/transcript certificate
}

// The year that applies to a degree entry: yearOfAward for Doctoral/Post-Doctoral
// entries, yearOfPassing for everything else.
export function degreeYear(
  d: Pick<DegreeDetail, "yearOfPassing" | "yearOfAward"> | undefined | null,
  doctoral: boolean,
): number | undefined {
  if (!d) return undefined;
  return doctoral ? d.yearOfAward : d.yearOfPassing;
}

// Shared with SupportingStaffProfileFields.qualifications (supportingStaff.ts) -
// reuses DegreeDetail's shape + a free `level` label (e.g. "SSC", "Intermediate",
// "Degree", "Post Graduation") for a repeating list of qualification entries.
// Used by FacultyProfileFields.educationalQualifications for School-type colleges,
// which don't fit the fixed UG/PG/PhD DegreeFields slots below (see
// src/lib/designations/config.ts's SCHOOL_TEACHING_QUALIFICATION_LEVELS /
// SCHOOL_SUPPORTING_QUALIFICATION_LEVELS).
export interface StaffQualification extends DegreeDetail {
  level: string;
}

export type PhdStatus = "AWARDED" | "PURSUING";
export type PhdMode = "FULL_TIME" | "PART_TIME";

export type QualifyingExamType = "NET" | "SLET" | "SET" | "GATE" | "OTHER";
export const QUALIFYING_EXAM_LABELS: Record<QualifyingExamType, string> = {
  NET: "NET",
  SLET: "SLET",
  SET: "SET",
  GATE: "GATE",
  OTHER: "Others",
};

export interface CourseAssignment {
  code: string;
  name: string;
  weeklyCreditHours: number;
}

export interface TeachingAssignmentSummary {
  courses: CourseAssignment[]; // up to 3
}

export interface PreviousInstitution {
  institutionName: string;
  designation?: string;
  // "YYYY-MM-DD" - the actual dates worked. fromYear/toYear below are the
  // legacy, year-only shape this replaced (same read-time-fallback pattern as
  // legacyProfileFallbacks.ts): a record saved before this existed keeps
  // showing its year in the edit form (seeded onto Jan 1) until re-saved,
  // which is when it picks up real fromDate/toDate values.
  fromDate?: string;
  toDate?: string;
  fromYear?: number;
  toYear?: number;
  experienceCertificateUrl?: string;
  joiningSalary?: number;
  leavingSalary?: number;
  reasonForLeaving?: string;
  nocObtained?: "YES" | "NO";
  // This entry's own Roles/Responsibilities - the label is per tab (Academic/Industry/Research
  // Roles/Responsibilities) but the stored key is the same on every experience entry. Replaces
  // the three shared root-level fields on FacultyProfileFields (see below).
  rolesResponsibilities?: string;
}

// Employment Details — Promotion History (NBA/AICTE).
export interface PromotionRecord {
  designation: string;
  // "YYYY-MM-DD" - toDate blank means still serving in this designation, so
  // its experience is computed up to today (see PromotionFields/durationBetween)
  // and keeps increasing day by day until one is set.
  fromDate?: string;
  toDate?: string;
  promotionOrderUrl?: string; // promotion order document (legacy key: orderUrl - see fieldRenames.ts)
}

// Personal Details — Ratification History. A faculty member's ratification (by
// the state/university) may happen more than once across their career, once
// per designation they held at the time (e.g. ratified as Assistant Professor,
// then again years later as Associate Professor). Each entry's `designation`
// is a plain historical fact captured at the time of THAT ratification - it
// must NEVER be compared with, restricted by, or kept in sync with the faculty
// member's current/ongoing `designation` field above. A later promotion or
// demotion must never alter any existing ratification entry.
//
// Stored as a plain "YYYY-MM-DD" date string (like PromotionRecord above),
// not a Firestore Timestamp, so array entries need no per-element Timestamp
// conversion on read - see lib/faculty/ratificationHistory.ts.
export interface RatificationRecord {
  designation: string;
  proceedingsNumber?: string;
  date?: string; // "YYYY-MM-DD"
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
// COORDINATOR_REVIEW: waiting on the submitter's department R&D Coordinator.
// PENDING: waiting on R&D (forwarded by the coordinator, or no coordinator).
// SENT_BACK: returned to the submitter for changes; editing resubmits it.
export type PublicationStatus = "COORDINATOR_REVIEW" | "PENDING" | "APPROVED" | "REJECTED" | "SENT_BACK";

// Rich, type-specific publication details (Journal/Conference/Book Chapter/
// Text Book), each institution's R&D policy field set - additive on top of
// ResearchPublication's flat legacy fields below, which stay populated
// (derived from this at write time) so CSV-imported/pre-existing records and
// every consumer of the flat shape keep working unchanged. See
// src/components/research/PublicationDetailsForm.tsx (the shared form) and
// src/app/api/college/publications/route.ts (server-side derivation).
export type PublicationType = "JOURNAL" | "CONFERENCE" | "BOOK_CHAPTER" | "TEXT_BOOK";
export type AuthorCategory = "FIRST_AUTHOR" | "CO_AUTHOR" | "CORRESPONDING_AUTHOR";
export type AuthorRoleType = "FACULTY" | "STUDENT";
// WOS_ESCI/WOS_SCIE apply to Journal; plain WOS applies to Conference/Book Chapter.
export type PublicationIndex = "SCOPUS" | "WOS_ESCI" | "WOS_SCIE" | "WOS";
export type PublicationQuartile = "Q1" | "Q2" | "Q3" | "Q4" | "NA";

export interface PublicationAuthor {
  name: string;
  category: AuthorCategory;
  authorType: AuthorRoleType;
  facultyId?: string; // when isInternal && authorType === "FACULTY" - resolves name via facultyMembers
  studentRegistrationNumber?: string; // when isInternal && authorType === "STUDENT" - no directory to verify against, trusted as entered
  affiliationCollegeId?: string; // a real colleges/{id}, or "OTHERS"
  affiliationCollegeName: string; // denormalized - the picked college's real name, or the free-text name typed under "Others"
  affiliationCountry?: string; // only when affiliationCollegeId === "OTHERS"
  // Server-derived (never trust a client-submitted value): true when
  // affiliationCollegeId equals the submitting college's own id.
  isInternal: boolean;
}

export interface PublicationDetails {
  type: PublicationType;
  title: string; // "Title of the Paper" (Journal/Conference/Book Chapter) or "Title of the Book" (Text Book)
  researchDomain?: string; // JOURNAL / CONFERENCE / BOOK_CHAPTER
  sdgGoals?: number[]; // UN SDG 1-17 - JOURNAL / CONFERENCE / BOOK_CHAPTER

  journalName?: string; // JOURNAL
  organizedBy?: string; // CONFERENCE
  conferenceName?: string; // CONFERENCE
  bookName?: string; // BOOK_CHAPTER
  isExtensionOfConference?: boolean; // BOOK_CHAPTER
  providedBookLink?: string; // TEXT_BOOK
  isPublisherInRnDPolicyAnnexure?: boolean; // TEXT_BOOK

  publisherName?: string;
  issnNumber?: string; // JOURNAL
  isbnNumber?: string; // CONFERENCE / BOOK_CHAPTER / TEXT_BOOK
  indexedIn?: PublicationIndex[];
  quartile?: PublicationQuartile; // JOURNAL only
  impactFactor?: string;

  authors: PublicationAuthor[];
  internalAuthorsCount: number; // server-derived
  externalAuthorsCount: number; // server-derived

  monthYearOfPublication?: string; // "YYYY-MM"
  monthYearOfIndex?: string; // "YYYY-MM"
  scopusOrWosLink?: string;
  publishedPaperLink?: string;
  doi?: string;
  citeAs?: string;
  hasInternationalCollaboration?: boolean;
  hasIndustryCollaboration?: boolean;
}

export interface ResearchPublication {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - any role
  ownerName: string;
  ownerRole: UserRole;
  // Resolved academic identity (e.g. "Professor", or generically "Faculty"
  // for Principal/VP/HOD/Academics who have no separate FacultyMember record) -
  // see src/lib/publications/resolveOwnerDesignation.ts. When present, this
  // is what's displayed instead of ownerRole: the record belongs to the
  // person's academic career, not whichever administrative role they
  // happened to hold when it was added - undefined for genuine office roles
  // (R&D, IQAC, T&P, Library, Exam Cell, Webmaster, College Office, College
  // Staff), which keep showing ownerRole as before.
  ownerDesignation?: string;
  // Missing on every record created before self-submission shipped - treat
  // that as APPROVED everywhere (they were all R&D-added). R&D's own direct
  // adds always write "APPROVED"; a self-submission starts "PENDING".
  status?: PublicationStatus;
  reviewedBy?: string; // R&D uid who approved/rejected
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes
  // Rich Journal/Conference/Book Chapter/Text Book breakdown - absent on
  // every record added before this shipped (CSV-imported or hand-added with
  // the old flat form), which still display fine off the flat fields below.
  details?: PublicationDetails;
  // Login uid of every verified Internal author (resolved from their
  // Faculty ID, see resolveOwnerDesignation/deriveFlatFields) - lets this
  // record show on THEIR own profile too, not just the submitter's (`uid`
  // above). Also who else, besides the submitter, may edit this record.
  internalAuthorUids?: string[];
  // One entry per edit made to an already-APPROVED record - re-editing
  // flips status back to PENDING for re-verification, and this is what
  // shows R&D (and the submitter/co-authors) exactly what changed instead
  // of a blank resubmission. Edits made while still PENDING/REJECTED aren't
  // logged here - only ones that reopen an already-accepted record.
  changeLog?: { changedAt: Timestamp; changedBy: string; changedByName: string; changes: string[] }[];
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

// A staff member's self-submitted researcher IDs (see Research & Innovation's
// "Research Profiles" tab) - one doc per uid (doc id == uid), since unlike
// publications this is a single evolving record, not a repeating list. Same
// PENDING/APPROVED/REJECTED verification flow as ResearchPublication: R&D
// reviews before the values are copied onto the person's academicProfile
// fields (orcidId/scopusAuthorId/researcherId/googleScholarId/irinsProfile),
// which stay the officially-shown values everywhere else in the app.
export interface ResearchProfileRequest {
  id: string; // == uid
  collegeId: string;
  uid: string;
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string; // see resolveOwnerDesignation.ts
  orcidId?: string;
  scopusAuthorId?: string;
  researcherId?: string;
  googleScholarId?: string;
  irinsProfile?: string;
  status: PublicationStatus;
  reviewedBy?: string; // R&D uid who approved/rejected
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

// A staff member's self-submitted citation/H-index metrics (see Research &
// Innovation's "Citations & H-Index Growth" tab) - one doc per uid (doc id ==
// uid), same PENDING/APPROVED/REJECTED verification flow as
// ResearchProfileRequest: R&D reviews before the values are copied onto the
// person's academicProfile fields, which stay the officially-shown values
// everywhere else in the app.
export interface CitationMetricsRequest {
  id: string; // == uid
  collegeId: string;
  uid: string;
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string; // see resolveOwnerDesignation.ts
  totalCitations?: number;
  hIndex?: number;
  citationsExcludingSelf?: number;
  hIndexExcludingSelf?: number;
  status: PublicationStatus;
  // (mapped onto academicProfile.citationsTotal/citationsHIndex/
  // citationsExcludingSelf/citationsHIndexExcludingSelf on approval - see
  // applyCitationMetricsFields.ts)
  reviewedBy?: string; // R&D uid who approved/rejected
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type ConsultancyClientType = "INDUSTRY" | "GOVERNMENT" | "ACADEMIC_INSTITUTION" | "NGO" | "STARTUP" | "MSME";
export type ConsultancyCategory = "TECHNICAL" | "TESTING" | "TRAINING" | "DESIGN" | "SOFTWARE_DEVELOPMENT";
export type ConsultancyDeliverable = "REPORTS" | "SOFTWARE" | "PROTOTYPE" | "TESTING_REPORT" | "DESIGN" | "TRAINING" | "OTHERS";

// A staff-submitted Consultancy Project record (see Research & Innovation's
// "Consultancy Projects" tab) - one doc per project (a person can have many
// over their career, unlike the singleton ResearchProfileRequest/
// CitationMetricsRequest), same PENDING/APPROVED/REJECTED verification flow
// as ResearchPublication: self-submitted rows start PENDING and only count
// as official once R&D approves them; R&D's own adds are auto-APPROVED.
export interface ConsultancyFacultyConsultant {
  facultyId: string; // Employee ID
  name: string; // resolved from facultyMembers
}

export interface ConsultancyProjectRequest {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - the lead/submitting consultant
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string; // see resolveOwnerDesignation.ts
  status: PublicationStatus;
  reviewedBy?: string; // R&D uid who approved/rejected
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  title: string;
  facultyConsultantsCount?: number;
  facultyConsultantsNames: string; // comma-separated names - derived from facultyConsultants (free text on older records)
  facultyConsultants?: ConsultancyFacultyConsultant[]; // by Faculty ID, names resolved server-side
  department?: string;
  clientName: string;
  clientType: ConsultancyClientType;
  consultancyCategory: ConsultancyCategory;
  problemStatement: string; // brief description of the work assigned
  // Older records predate this. Ongoing => endDate/hours are tentative and no
  // deliverables/reports are collected; Completed => actuals plus reports.
  projectStatus?: "ONGOING" | "COMPLETED";
  startDate: string; // yyyy-mm-dd
  endDate?: string; // yyyy-mm-dd (tentative while Ongoing)
  durationMonths?: number;
  consultancyAmount?: number; // total sanctioned/agreed value
  amountReceived?: number; // actual amount received so far
  amountReceivedDate?: string; // yyyy-mm-dd
  institutionalInfrastructureUsage?: "YES" | "NO";
  hoursSpentDuringAcademicHours?: number;
  institutionalShare?: number; // Rs.
  facultyShare?: number; // Rs.
  facultyShareProofUrl?: string; // uploaded PDF
  deliverables: ConsultancyDeliverable[];
  completionReportUrl?: string; // uploaded PDF
  incomeSupportingDocUrl?: string; // cheque/deposit/transfer receipt - uploaded PDF/image

  addedBy: string; // uid who created/last edited it (self, or R&D on someone's behalf)
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface SeedFundingStudentItem {
  name: string;
  department: string;
  regdNumber: string;
  yearOfStudy: string;
}

export interface SeedFundingEquipmentItem {
  name: string;
  makeModel: string;
  softwareOrHardware: string;
  amount?: number;
  purpose: string;
}

export interface SeedFundingPaperItem {
  title: string;
  journalOrConference: string;
  doi?: string;
  quartile?: string;
  impactFactor?: string;
  indexedScopusWos?: string;
  citeAs?: string; // Seed Funding asks for this in IEEE format
  paperUrl?: string; // link or uploaded PDF of the paper (Seed Funding)
}

export interface SeedFundingPatentItem {
  applicationNo: string;
  applicantName: string;
  patentTitle: string;
  inventorDetails: string;
  status: string; // Filed / Published / Granted
  proofUrl?: string; // link or uploaded PDF of the proof for `status` (Seed Funding)
}

export type SeedFundingProjectStatus = "SANCTIONED" | "COMPLETED";

// A staff-submitted Seed Funding project record (Research & Innovation's
// "Seed Funding" tab) - one doc per project, same PENDING/APPROVED/REJECTED
// verification flow as ConsultancyProjectRequest/ResearchPublication (a
// repeating list per person, not a singleton).
export interface SeedFundingProjectRequest {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - the PI
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  title: string;
  durationMonths?: number;
  objectives: string;
  tentativeOutcomes?: string;
  piName: string;
  piDepartment?: string;
  studentsInvolvedCount?: number;
  students: SeedFundingStudentItem[];
  projectStatus: SeedFundingProjectStatus;
  dateSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmount?: number;
  nonRecurringAmount?: number;
  equipmentProcured: SeedFundingEquipmentItem[];
  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];
  studentsProjectsUG?: number;
  studentsProjectsPG?: number;
  studentsProjectsPhD?: number;
  studentsTrainedCount?: number;
  externalFundedProposalsApplied?: number;
  progressReportUrl?: string;
  utilizationCertificateUrl?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface SponsoredProjectCoPI {
  name: string;
  department: string;
  affiliation: string;
}

export type SponsoredProjectType = "TRAINING" | "TECHNICAL" | "SOCIETY" | "INFRASTRUCTURE";
export type SponsoredProjectStatus = "APPLIED" | "SANCTIONED";
export type SponsoredProjectSanctionedStatus = "ONGOING" | "COMPLETED";

// One year's worth of Amount Received / Infrastructure / Outcomes /
// Students & Training for a Sanctioned SponsoredProjectRequest - repeated
// once per year of noOfYears.
export interface SponsoredProjectYearData {
  totalAmountReceived?: number;
  recurringAmountReceived?: number;
  nonRecurringAmountReceived?: number;
  instituteContributionReceived?: number;
  infrastructureProcured: SeedFundingEquipmentItem[];
  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];
  studentsProjectsUG?: number;
  studentsProjectsPG?: number;
  studentsProjectsPhD?: number;
  studentsTrainedCount?: number;
  teachingStaffTrainedCount?: number;
  nonTeachingStaffTrainedCount?: number;
  externalPersonsTrainedCount?: number;
  // Reporting to the sponsoring agency is per year: each year answers whether
  // its documents were submitted and, if so, attaches them. Supersedes the
  // project-level fields of the same names on SponsoredProjectRequest, which
  // only older records still carry.
  submittedRequiredDocs?: "YES" | "NO";
  dateOfSubmission?: string;
  progressReportUrl?: string; // Ongoing
  completionReportUrl?: string; // Completed
  utilizationCertificateUrl?: string;
  statementOfExpenditureUrl?: string;
}

// A staff-submitted Sponsored Research Project record (Research & Innovation's
// "Sponsored Research Projects" tab) - one doc per project, same
// PENDING/APPROVED/REJECTED verification flow as SeedFundingProjectRequest.
// Reuses SeedFunding's equipment/paper/patent item shapes (same columns) for
// Infrastructure Procured / Papers Published / Patents.
export interface SponsoredProjectRequest {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - the PI
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  agencyName: string;
  schemeName: string;
  applicationNumber: string;
  title: string;
  projectType: SponsoredProjectType;
  durationMonths?: number;
  objectives: string;
  tentativeOutcomes?: string;
  piName: string;
  piDepartment?: string;
  piAffiliation?: string;
  coPiCount?: number;
  coPis: SponsoredProjectCoPI[];

  projectStatus: SponsoredProjectStatus; // Applied / Sanctioned

  // Applied branch
  dateProposalSubmitted?: string;
  amountApplied?: number;
  extendedToSeedFund?: "YES" | "NO";
  // Only when extendedToSeedFund === "YES". The date is stored as typed, DD-MM-YYYY.
  seedFundTitle?: string;
  seedFundAmountSanctioned?: number;
  seedFundSanctionDate?: string;

  // Sanctioned branch
  sanctionedStatus?: SponsoredProjectSanctionedStatus; // Ongoing / Completed
  dateProjectSanctioned?: string;
  dateOfStart?: string;
  financialYearOfStart?: string;
  totalAmountSanctioned?: number;
  recurringAmountSanctioned?: number;
  nonRecurringAmountSanctioned?: number;
  instituteContributionSanctioned?: number;

  // Completed-only
  dateOfCompletion?: string;
  financialYearOfCompletion?: string;

  // Everything below Amount Sanctioned is broken down per year of the
  // sanction - noOfYears drives yearlyData's length (one entry per year,
  // "Amount Received for Year 1", "Infrastructure Procured for Year 2", etc).
  noOfYears?: number;
  yearlyData: SponsoredProjectYearData[];

  // Legacy - records saved before these moved onto each year (see
  // SponsoredProjectYearData). New submissions leave them empty.
  progressReportUrl?: string; // Ongoing
  completionReportUrl?: string; // Completed
  utilizationCertificateUrl?: string;
  statementOfExpenditureUrl?: string;
  submittedRequiredDocs?: "YES" | "NO";
  dateOfSubmission?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type IprType = "UTILITY_PATENT" | "DESIGN_PATENT" | "COPYRIGHT";
export type IprStatus = "PUBLISHED" | "GRANTED";
export type IprApplicantType = "INDIVIDUAL" | "INSTITUTION" | "INDUSTRY";
export type IprCommercializationStatus = "COMMERCIALIZED" | "LICENSED" | "TECHNOLOGY_TRANSFERRED";
export type IprCommercializationType =
  | "EXCLUSIVE_LICENSE" | "NON_EXCLUSIVE_LICENSE" | "ASSIGNMENT" | "TECHNOLOGY_TRANSFER" | "STARTUP_COMMERCIALIZATION";

export interface IprApplicant {
  name: string;
  type: IprApplicantType;
}

// Same shape as PublicationAuthor (src/components/research/PublicationDetailsForm.tsx)
// - Internal/External split, Faculty ID re-verified server-side against
// facultyMembers (resolves name + affiliation, own college), External picks
// affiliation via the same college-directory/Others two-step. Just Author
// renamed to Inventor.
export interface IprInventor {
  name: string;
  category: AuthorCategory;
  authorType: AuthorRoleType;
  facultyId?: string; // when isInternal && authorType === "FACULTY" - resolves name via facultyMembers
  studentRegistrationNumber?: string; // when isInternal && authorType === "STUDENT" - trusted as entered
  affiliationCollegeId?: string; // a real colleges/{id}, or "OTHERS"
  affiliationCollegeName: string; // denormalized - the picked college's real name, or the free-text name typed under "Others"
  affiliationCountry?: string; // only when affiliationCollegeId === "OTHERS"
  isInternal: boolean;
}

// A staff-submitted Discovery & Innovation (IPR) record (Research &
// Innovation's "Discovery & Innovation (IPR)" tab) - one doc per IPR filing,
// same PENDING/APPROVED/REJECTED verification flow as the other
// Research & Innovation tabs.
export interface DiscoveryInnovationRequest {
  id: string;
  collegeId: string;
  uid: string;
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  iprType: IprType;
  iprStatus: IprStatus; // Published / Granted
  applicationNumber: string;
  title: string;
  sdgGoals: number[]; // 1-17, checked SDGs
  dateOfFiling: string;
  datePublished?: string;
  dateGranted?: string; // only when iprStatus === GRANTED

  applicantsCount?: number;
  applicants: IprApplicant[];
  inventorsCount?: number;
  inventors: IprInventor[];

  isStudentPatent?: "YES" | "NO";
  // Only when isStudentPatent === "YES".
  studentName?: string;
  studentRegistrationNumber?: string;
  studentDepartment?: string;
  publishedProofUrl?: string;
  grantedProofUrl?: string;

  isCommercialized?: "YES" | "NO";
  commercializationStatus?: IprCommercializationStatus;
  commercializationDate?: string;
  licenseePartner?: string;
  commercializationType?: IprCommercializationType;
  commercializationValue?: number;
  revenueGenerated?: number;
  commercializedProofUrl?: string;
  revenueGeneratedProofUrl?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type PhdRecognizedSupervisor = "JNTUK" | "OTHER";
export type PhdGuideStatus = "SUPERVISOR" | "CO_SUPERVISOR";
export type PhdFellowshipType = "NATIONAL" | "INTERNATIONAL";
export type PhdAwardType = "NATIONAL" | "INTERNATIONAL";
export type PhdAwardNature = "GOVERNMENT" | "PRIVATE";

// A staff-submitted Ph.D. Supervision & Guidance record (Research &
// Innovation's "Ph.D. Supervision" tab) - one doc per scholar guided, same
// PENDING/APPROVED/REJECTED verification flow as the other Research &
// Innovation tabs. Reuses SeedFunding's paper/patent item shapes for the
// Papers Published / Patents tables.
export interface PhdSupervisionRequest {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - the supervisor/co-supervisor
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  recognizedSupervisor: PhdRecognizedSupervisor;
  otherUniversityName?: string; // when recognizedSupervisor === OTHER
  guideStatus: PhdGuideStatus;
  scholarName: string;
  scholarDepartment?: string;
  scholarAffiliation?: string;
  scholarPhone?: string;
  yearOfAllocation?: string;
  allotmentOrderUrl?: string; // uploaded PDF
  yearsCompleted?: number;
  degreeAwarded?: "YES" | "NO";
  dateOfAward?: string; // when degreeAwarded === YES
  awardedDegreeProofUrl?: string; // when degreeAwarded === YES

  papersPublished: SeedFundingPaperItem[];
  patents: SeedFundingPatentItem[];

  fellowshipReceived?: "YES" | "NO";
  fellowshipType?: PhdFellowshipType;
  fellowshipName?: string;
  fellowshipAmount?: number;

  awardsReceived?: "YES" | "NO";
  awardName?: string;
  awardType?: PhdAwardType;
  awardNature?: PhdAwardNature;
  awardDetails?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type ResearchServiceType = "CONFERENCE" | "WORKSHOP" | "REVIEWER" | "EDITOR";
export type ConferenceWorkshopType = "NATIONAL" | "INTERNATIONAL";
export type ConferenceWorkshopNature = "ONLINE" | "OFFLINE" | "HYBRID";
export type ResearchServiceFundNature = "EXTERNAL_GRANT" | "INSTITUTIONAL_GRANT" | "SANCTIONED_PROJECT_GRANT";
export type ReviewerType = "JOURNAL" | "CONFERENCE";
export type EditorialRole = "EDITOR" | "CHIEF_EDITOR" | "ASSOCIATE_EDITOR" | "GUEST_EDITOR" | "SECTION_EDITOR";
export type EditorPublicationType = "JOURNAL" | "BOOK" | "EDITED_BOOK" | "CONFERENCE_PROCEEDINGS" | "SPECIAL_ISSUE";
export type PublicationScope = "NATIONAL" | "INTERNATIONAL";

export interface ConvenerCoordinatorItem {
  name: string;
  department: string;
  type: string; // Convener / Co-Convener / Coordinator / Co-Coordinator
}

export interface OrganizingCommitteeMemberItem {
  name: string;
  department: string;
}

export interface ResourcePersonItem {
  name: string;
  affiliation: string;
  phone: string;
}

// A staff-submitted Research Services & Contributions record (Research &
// Innovation's own tab) - one doc per contribution, same
// PENDING/APPROVED/REJECTED verification flow as the other Research &
// Innovation tabs. `serviceType` picks which field group below is relevant;
// Conference and Workshop share the same field names (organized/eventType/
// eventNature/fundNature/title/conveners/committeeMembers/dates/amounts/
// resourcePersons/uploads) since the source spec lists nearly identical
// sections for both - only the trailing stats differ (papers vs
// participants) and each keeps its own fields for that.
export interface ResearchServiceRequest {
  id: string;
  collegeId: string;
  uid: string;
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  serviceType: ResearchServiceType;

  // Conference / Workshop - shared fields
  organized?: "YES" | "NO";
  eventType?: ConferenceWorkshopType;
  eventNature?: ConferenceWorkshopNature;
  fundNature?: ResearchServiceFundNature;
  title?: string;
  convenersCount?: number;
  conveners: ConvenerCoordinatorItem[];
  committeeMembersCount?: number;
  committeeMembers: OrganizingCommitteeMemberItem[];
  noOfDays?: number;
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  amountSanctioned?: number;
  amountReceived?: number;
  expenditureMade?: number;
  sanctionedLetterUrl?: string;
  brochureUrl?: string;
  scheduleUrl?: string;
  resourcePersonsCount?: number;
  resourcePersons: ResourcePersonItem[];
  completionReportUrl?: string;

  // Conference-only
  papersReceived?: number;
  papersAccepted?: number;
  papersPublishedCount?: number;
  papersIndexedCount?: number;
  conferenceProceedingsUrl?: string; // uploaded PDF
  conferenceProceedingsLink?: string; // proceedings / DOI link - may be given alongside the PDF

  // Workshop-only
  participantsRegisteredInternal?: number;
  participantsRegisteredExternal?: number;
  papersAttendedInternal?: number;
  papersAttendedExternal?: number;

  // Reviewer
  reviewerType?: ReviewerType;
  reviewerPublicationName?: string;
  reviewerPublisherName?: string;
  reviewerPaperTitle?: string;
  reviewerReviewDate?: string;
  reviewerCertificateUrl?: string;

  // Editor
  editorialRole?: EditorialRole;
  editorPublicationType?: EditorPublicationType;
  editorPublicationName?: string;
  editorPublisher?: string;
  editorPublisherOther?: string;
  editorIssnIsbn?: string;
  editorScope?: PublicationScope;
  editorIndexedIn?: string;
  editorResponsibilities?: string;
  editorPapersChaptersHandled?: number;
  editorAppointmentLetterUrl?: string;
  editorPublicationUrl?: string;
  editorRemarks?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type HackathonEventType = "HACKATHON" | "IDEATHON" | "INNOVATION_CHALLENGE" | "BUSINESS_PLAN_COMPETITION";
export type HackathonLevel = "INSTITUTION" | "INTER_COLLEGE" | "STATE" | "NATIONAL";
export type YuktiReferenceStatus = "SUBMITTED" | "RECOMMENDED" | "NOT_RECOMMENDED";

export interface HackathonEvaluatorItem {
  name: string;
  affiliation: string;
}

export interface HackathonFacultyCoordinatorItem {
  name: string;
  designation: string;
  departmentOrCell: string;
}

export interface YuktiReferenceItem {
  teamName: string;
  yuktiId: string;
  ideaOrPrototypeTitle: string;
  submittedOn: string;
  status: YuktiReferenceStatus | "";
}

// A staff-submitted Hackathon/Competition record (Research & Innovation's
// "Organizing Hackathons / Competitions" tab) - one doc per event, same
// PENDING/APPROVED/REJECTED verification flow as the other Research &
// Innovation tabs.
export interface HackathonRequest {
  id: string;
  collegeId: string;
  uid: string; // owning staff member - the organizer/coordinator
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  academicYear: string;
  eventTitle: string;
  eventType: HackathonEventType;
  organizingDeptCell?: string;
  startDate?: string;
  endDate?: string;
  durationHours?: number;
  venue?: string;
  levelOfEvent: HackathonLevel;
  themeDomain?: string;
  noOfProblemStatements?: number;
  teamsRegisteredInternal?: number;
  teamsRegisteredExternal?: number;
  participantsInternal?: number;
  participantsExternal?: number;
  ideasPresentedCount?: number;
  pocsPresentedCount?: number;
  productsPresentedCount?: number;
  evaluators: HackathonEvaluatorItem[];
  facultyCoordinators: HackathonFacultyCoordinatorItem[];

  ideasUploadedYukti?: number;
  ideasVerifiedRecommendedYukti?: number;
  prototypesUploadedYukti?: number;
  prototypesVerifiedRecommendedYukti?: number;
  yuktiReferences: YuktiReferenceItem[];

  sanctionedLetterUrl?: string;
  brochureUrl?: string;
  expenditureProofUrl?: string;
  eventReportUrl?: string;
  remarks?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export type InnovatorType = "STUDENT" | "FACULTY";
export type InnovationType = "IDEA" | "PROTOTYPE" | "BUSINESS_MODEL" | "STARTUP" | "HACKATHON" | "IDEATHON";

export interface InnovationFacultyItem {
  name: string;
  department: string;
  contribution: string;
}

// A staff-submitted Innovation record (Research & Innovation's "Innovations"
// tab) - one doc per innovation, same PENDING/APPROVED/REJECTED verification
// flow as the other Research & Innovation tabs. `innovatorType` picks
// whether the Faculty or Student detail block applies.
export interface InnovationRequest {
  id: string;
  collegeId: string;
  uid: string;
  ownerName: string;
  ownerRole: UserRole;
  ownerDesignation?: string;
  status: PublicationStatus;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Timestamp;
  rejectionReason?: string;
  sentBackReason?: string; // set when an R&D Coordinator returns it for changes

  academicYear: string;
  innovatorType: InnovatorType;

  // Faculty branch
  facultyInvolvedCount?: number;
  facultyMembers: InnovationFacultyItem[];

  // Student branch
  studentName?: string;
  studentRegdNo?: string;
  studentYearOfStudy?: string;
  studentDepartment?: string;
  facultyMentorName?: string;

  innovationTitle: string;
  innovationType: InnovationType;
  problemStatement?: string;
  briefDescription?: string;
  trlLevel?: string;

  prototypeDeveloped?: "YES" | "NO";
  prototypeDetails?: string;
  businessModelDeveloped?: "YES" | "NO";
  businessModelDetails?: string;
  startupFormed?: "YES" | "NO";
  startupName?: string;
  incubationName?: string;
  yuktiId?: string;

  verifiedRecommendedYukti?: "YES" | "NO";
  yuktiScreenshotUrl?: string;

  presentedInCompetition?: "YES" | "NO";
  competitionName?: string;
  organizedBy?: string;

  remarks?: string;

  addedBy: string;
  addedByName: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface LabEstablished {
  facilityDetails: string;
  outcomes: string;
}

// Shared structured "training/FDP" entry — used by Teaching Faculty Module 5 AND both
// Supporting Staff categories' Training sections (their category-specific types apply).
export type TrainingEntryType =
  | "FDP"
  | "WORKSHOP"
  | "MOOC"
  | "CERTIFICATION"
  | "SKILL_DEVELOPMENT"
  | "SEMINAR"
  | "WEBINAR"
  | "GUEST_LECTURE"
  | "ALUMNI_TALK"
  | "PLACEMENT_TRAINING"
  | "ERP"
  | "OFFICE_AUTOMATION"
  | "OTHER";
export const TRAINING_ENTRY_TYPE_LABELS: Record<TrainingEntryType, string> = {
  FDP: "FDP",
  WORKSHOP: "Workshop",
  MOOC: "NPTEL/MOOCs",
  CERTIFICATION: "Certification",
  SKILL_DEVELOPMENT: "Skill Development",
  SEMINAR: "Seminar",
  WEBINAR: "Webinar",
  GUEST_LECTURE: "Guest Lecture",
  ALUMNI_TALK: "Alumni Talks",
  PLACEMENT_TRAINING: "Placement Training",
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
export type CertificationType = "INDUSTRY" | "VEDIC";
export const CERTIFICATION_TYPE_LABELS: Record<CertificationType, string> = {
  INDUSTRY: "Industry Certification",
  VEDIC: "VEDIC Certification",
};
export type TrainingProgramLevel = "NATIONAL" | "INTERNATIONAL";
export const TRAINING_PROGRAM_LEVEL_LABELS: Record<TrainingProgramLevel, string> = {
  NATIONAL: "National",
  INTERNATIONAL: "International",
};
export type TrainingProgramMode = "ONLINE" | "OFFLINE" | "HYBRID";
export const TRAINING_PROGRAM_MODE_LABELS: Record<TrainingProgramMode, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  HYBRID: "Hybrid",
};

export type TrainingBeneficiaryType = "STUDENTS" | "FACULTY";
export const TRAINING_BENEFICIARY_TYPE_LABELS: Record<TrainingBeneficiaryType, string> = {
  STUDENTS: "Students",
  FACULTY: "Faculty",
};

export interface TrainingBeneficiarySection {
  sectionId: string;
  sectionName: string;
  count: number;
}
export interface TrainingBeneficiaryDepartmentEntry {
  courseId: string;
  courseName: string;
  departmentId: string;
  department: string;
  year: number;
  sections: TrainingBeneficiarySection[];
}
export interface TrainingCoConductor {
  order: number; // 2, 3, ... - the coordinator themself is implicitly #1
  facultyId: string;
  name: string;
  department: string;
}

export interface TrainingEntry {
  // Stable id, generated client-side (crypto.randomUUID()) the first time an
  // entry gets a co-conductor - lets the server match the same entry across
  // the coordinator's and every co-conductor's own fdpsWorkshopsMoocsCertifications array when
  // keeping synced copies up to date (see syncTrainingEntryCoConductors).
  id?: string;
  type: TrainingEntryType;
  // Free-text type name - only meaningful (and shown) when type === "OTHER".
  pleaseSpecifyType?: string;
  participatedOrConducted?: TrainingParticipationRole; // did they attend, or run it themselves - applies to any type, not just FDP
  titleOfTheProgram: string;
  // Name of the Faculty / Coordinator - auto-set to the profile owner's own
  // name whenever participatedOrConducted is CONDUCTED (see TrainingEntryFields);
  // not a free text field the user types into directly any more.
  nameOfTheFacultyCoordinator: string;
  // "YYYY-MM-DD" - replaces the old year-only shape (see legacy `year` below).
  // duration (days) is auto-computed from these two, not typed in directly.
  fromDate?: string;
  toDate?: string;
  duration?: number;
  // MOOC/CERTIFICATION only - shown instead of From/To Date + Duration above,
  // since these are typically measured in weeks rather than a date range.
  numberOfWeeks?: number;
  // CERTIFICATION only - replaces Participated/Conducted there (a
  // certification isn't "conducted", so participatedOrConducted/coConductingFaculty/remark don't apply).
  certificationType?: CertificationType;
  nationalInternational?: TrainingProgramLevel;
  place?: string;
  modeOfTheProgram?: TrainingProgramMode;
  numberOfResourcePersons?: number;
  // One entry per resource person - length follows numberOfResourcePersons
  // (see TrainingEntryFields), not typed as one freeform block any more. A
  // record saved before this change still has this as a plain string in
  // Firestore - every reader normalizes via normalizeResourcePersonsDetails()
  // (TrainingEntryFields.tsx) rather than trusting this type at runtime.
  resourcePersonsDetails?: string[];
  certificateUrl?: string;
  brochureUrl?: string; // event brochure, alongside the certificate/transcript
  // Legacy year-only shape (Faculty's edit form no longer sets this - see
  // fromDate/toDate above; Supporting Staff's own simpler Training/
  // Achievements form, TrainingAchievementsFields.tsx, still uses it as-is).
  year?: number;

  // Who this program served - shown regardless of Participated/Conducted.
  beneficiaries?: TrainingBeneficiaryType;
  totalCount?: number;
  beneficiaryDepartments?: TrainingBeneficiaryDepartmentEntry[]; // STUDENTS only
  internalCount?: number; // FACULTY only
  externalCount?: number; // FACULTY only

  // Co-conducting faculty - CONDUCTED only, set on the coordinator's own
  // ("master") copy of the entry.
  coConductingFaculty?: TrainingCoConductor[];
  // Set on every synced copy (see syncTrainingEntryCoConductors) - whose
  // entry this originally is. Absent on the master copy itself.
  ownerFacultyId?: string;
  ownerFacultyName?: string;
  // True only on a co-conductor's own synced copy - rendered read-only in
  // the form since edits belong on the coordinator's ("master") copy.
  isCoConductedCopy?: boolean;

  remark?: string; // PARTICIPATED only, replaces the coordinator/co-conducting faculty there
  otherDetails?: string; // always shown, trailing free-text field
}

export type ProfessionalBody =
  | "IEEE"
  | "ISTE"
  | "CSI"
  | "IGS"
  | "IETE"
  | "ACME"
  | "IEI"
  | "OTHER";
export const PROFESSIONAL_BODY_LABELS: Record<ProfessionalBody, string> = {
  IEEE: "IEEE",
  ISTE: "ISTE",
  CSI: "CSI",
  IGS: "IGS",
  IETE: "IETE",
  ACME: "ACME",
  IEI: "IEI",
  OTHER: "Other",
};
export type MembershipValidity = "LIFETIME" | "ANNUAL";
export const MEMBERSHIP_VALIDITY_LABELS: Record<MembershipValidity, string> = {
  LIFETIME: "Lifetime",
  ANNUAL: "Annual",
};
export interface ProfessionalMembership {
  body: ProfessionalBody;
  bodyName?: string; // when body === "OTHER"
  membershipType?: string; // e.g. Senior Fellowship / Associate Fellowship / Fellowship
  membershipId?: string;
  membershipValidity?: MembershipValidity;
  memberSince?: string; // "YYYY-MM-DD" - Member Since, LIFETIME only
  validFrom?: string; // "YYYY-MM-DD" - ANNUAL only
  validTo?: string; // "YYYY-MM-DD" - ANNUAL only
  sinceMonthYear?: string; // legacy "YYYY-MM" - Member Since (Month/Year), pre-dates the membershipValidity split
  sinceYear?: number; // legacy - year-only shape this replaced
}

export type AdminResponsibilityCategory =
  | "COMMITTEE_MEMBER"
  | "NBA"
  | "NAAC"
  | "NIRF"
  | "IQAC"
  | "OTHER";
export const ADMIN_RESPONSIBILITY_CATEGORY_LABELS: Record<
  AdminResponsibilityCategory,
  string
> = {
  COMMITTEE_MEMBER: "Committee Member",
  NBA: "NBA",
  NAAC: "NAAC",
  NIRF: "NIRF",
  IQAC: "IQAC",
  OTHER: "Other",
};
export interface AdminResponsibilityEntry {
  category: AdminResponsibilityCategory;
  // Free-text category name - only meaningful (and shown) when category === "OTHER".
  otherCategory?: string;
  description: string;
  // "YYYY-MM-DD" - replaces the old year-only shape below. toDate blank means
  // still ongoing (shown as such until it's set).
  fromDate?: string;
  toDate?: string;
  // Legacy year-only shape - a record saved before fromDate/toDate existed
  // keeps showing these until it's next re-saved (same read-time-fallback
  // pattern as PreviousInstitution - see its own doc-comment).
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
export type AwardLevel = "STATE" | "NATIONAL" | "INTERNATIONAL";
export const AWARD_LEVEL_LABELS: Record<AwardLevel, string> = {
  STATE: "State",
  NATIONAL: "National",
  INTERNATIONAL: "International",
};

export interface AwardEntry {
  category: AwardCategory;
  otherCategory?: string; // when category === "OTHER"
  titleOfAward: string;
  awardingAgencyBody: string;
  dateOfAward?: string; // "YYYY-MM-DD" - replaces the year-only shape below
  // Legacy year-only shape. No longer written: a record saved before dateOfAward
  // existed keeps this until re-saved; consumers derive the year from dateOfAward
  // and fall back to this (see awardYear() in src/lib/faculty/awardYear.ts).
  year?: number;
  stateNationalInternational?: AwardLevel;
  certificateUrl?: string;
  otherDetails?: string;
}

export interface FacultyProfileFields {
  // Module 1 — Academic Qualification (Engineering/Degree/Polytechnic/Pharmacy/
  // Dental colleges). School-type colleges use educationalQualifications instead -
  // UG/PG/PhD and the PhD-specific fields below don't apply to school teachers
  // (see College.type and src/lib/designations/config.ts).
  highestQualification: string;
  researchAreasInterests?: string[]; // optional - see QualificationFields
  secondaryEducation?: DegreeDetail; // 10th
  intermediateDiplomaIti?: DegreeDetail; // 12th / Diploma / ITI
  ugDetails?: DegreeDetail;
  // Extra UG/PG/PhD degrees beyond the primary one above (e.g. a second
  // Bachelor's, a second Master's, or a second doctorate). Kept as separate
  // arrays rather than turning ugDetails/pgDetails/phdDetails into arrays so
  // every existing record, export, resume and view that reads the single
  // field keeps working unchanged.
  additionalUgDetails?: DegreeDetail[];
  pgDetails?: DegreeDetail;
  additionalPgDetails?: DegreeDetail[];
  phdDetails?: DegreeDetail;
  additionalPhdDetails?: DegreeDetail[];
  // Status/Mode for Ph.D./Postdoctoral live on phdDetails.status/.mode and
  // postdoctoralFellowshipDetails.status/.mode (see DegreeDetail) - not separate
  // scalars here, so they can never drift apart from the degree entry they
  // describe.
  postdoctoralFellowshipDetails?: DegreeDetail;
  // Whether NET/SLET/SET/GATE/Others was qualified - exam/score/year below
  // only apply when this is "YES".
  netSletSetGateOthers?: "YES" | "NO";
  qualifiedExam?: QualifyingExamType;
  pleaseSpecifyExam?: string; // only meaningful when qualifiedExam === "OTHER"
  examScore?: string;
  qualifiedYear?: number;
  // School-type colleges only - see SCHOOL_TEACHING_QUALIFICATION_LEVELS.
  educationalQualifications?: StaffQualification[];

  // Previous Institutions Worked / Current Teaching Assignment
  teachingAssignment?: TeachingAssignmentSummary; // omitted for PRINCIPAL / VICE_PRINCIPAL - courses only; its role box is teachingRolesResponsibilities below
  // DEPRECATED - Roles/Responsibilities now live on each experience entry
  // (PreviousInstitution.rolesResponsibilities). These three root fields only exist on
  // records not yet through scripts/migrate-experience-roles-into-entries.mjs, and
  // normalizeAcademicProfile lifts them onto the entry on read. A value that could not be
  // lifted (no entries to hold it, or the latest entry already has different text) stays
  // here rather than being dropped.
  teachingRolesResponsibilities?: string; // legacy home: teachingAssignment.primaryTeachingRole
  industryRolesResponsibilities?: string;
  researchRolesResponsibilities?: string;
  academicExperience: PreviousInstitution[]; // Academic Experience tab - prior institutions worked at, before this one
  // Industry/Research Experience tabs - same shape/fields as academicExperience,
  // all three summed into one combined Previous Experience total (see
  // allPreviousExperienceEntries in experienceCalc.ts).
  industryExperience?: PreviousInstitution[];
  researchExperience?: PreviousInstitution[];
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
  orcidId?: string;
  scopusAuthorId?: string;
  researcherId?: string; // Web of Science / Publons ResearcherID
  googleScholarId?: string;
  irinsProfile?: string; // IRINS profile URL/ID

  // "Citations & H-Index Growth" tab - self-submitted, R&D-verified (see
  // CitationMetricsRequest) - kept distinct from the totalCitations/hIndex
  // fields above (those stay directly self-editable via the Academic
  // Profile form and are still used by resume PDF/CSV export/public
  // profile) so the two paths never overwrite each other.
  citationsTotal?: number;
  citationsHIndex?: number;
  citationsExcludingSelf?: number;
  citationsHIndexExcludingSelf?: number;

  // Module 5 — Mentorship & Institutional Value
  newLabsEstablished: LabEstablished[];
  // Structured NBA/AICTE replacements for the 4 legacy free-text fields this module used to carry.
  fdpsWorkshopsMoocsCertifications: TrainingEntry[];
  professionalMemberships: ProfessionalMembership[];
  academicResponsibilities: AdminResponsibilityEntry[];
  awardsRecognition: AwardEntry[];

  // Module 6 — Financial Standing & Budgetary Impact
  monthlySalary?: number; // Current Financial Standing — monthly salary drawn by the faculty member
  grossAnnualCTC?: number; // Budgetary Impact
  incrementsAwarded?: number;
  fundingConsultancyRevenueGeneration?: number; // offsets salary cost against research/consultancy grants brought into the institution

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
  // The curriculum regulation (e.g. "R20", "R23") the batch CURRENTLY
  // occupying this year-slot follows - one of the owning course's
  // CourseCatalogItem.regulations, resolved by which of its regulationBatches
  // lands on this section's own `year` (same validation as Subject.regulation).
  // Like `batch` above, this is edited by the HOD whenever a new cohort starts
  // occupying the slot (e.g. a fresh intake reaching this year, or a
  // transition-year correction) and is left untouched by promotion/
  // advance-year - those only ever move students, never edit Section docs.
  // A student's OWN regulation (StudentRecord.regulation) is a one-time
  // snapshot of this value taken the moment they're first placed into a
  // section, and stays fixed for that student regardless of what this field
  // is later edited to for a different batch passing through the same slot.
  // Optional/lenient like Subject.regulation - absent means unrestricted.
  regulation?: string;
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
  // Admission category - "Regular" (first-year intake) or "Lateral" (admitted
  // directly into a later year, e.g. via ECET/diploma lateral entry). A plain
  // string like every other roster select field (gender, admissionType, ...)
  // rather than a typed union - distinct from `status` below (this year's
  // academic standing, e.g. REGULAR vs DETAINED) despite the similar name.
  studentType?: string;
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
  // The curriculum regulation this student follows - a one-time snapshot of
  // Section.regulation, copied in the moment this student is FIRST placed
  // into a real section (students/distribute, distribute-cohort,
  // import-excel), then never touched again by promotion/advance-year or by
  // later edits to that section's own `regulation` (which just reflects
  // whichever batch currently occupies the slot). Fixed for this student's
  // entire academic run, per Section.regulation's own doc-comment. Optional/
  // lenient - absent when the section they were placed into had none set.
  regulation?: string;
  // This student's own admission batch, e.g. "2024-2028" - a one-time
  // snapshot taken the same moment/places as `regulation` above (students/
  // distribute, distribute-cohort's own path never touches lateral students
  // so is left as a plain regulation-only mirror there; import-excel).
  // A Regular student just mirrors the section's own Section.batch. A
  // Lateral student (studentType "Lateral") joins directly into Year 2,
  // one calendar year later than the Regular batch already occupying that
  // slot, and spends one fewer year at the college - so their own batch
  // starts a year later than the section's batch but ends the SAME year
  // (they graduate together): joining a Section.batch "2024-2028" slot in
  // session 2025 gives "2025-2028", not "2024-2028". See
  // lib/college/academicSession.ts's lateralEntryBatch.
  batch?: string;
  // Which lab sub-group this student sits in for their section's split
  // PRACTICAL periods (see TimetableSlot.labBatch), e.g. "Batch 1" - free
  // text, manually set per student by the HOD (hod/students page), matched
  // case/whitespace-insensitively against the period's own labBatch label
  // when a lab period's attendance roster is filtered (sectionRoster.ts).
  // Unrelated to `batch` above (admission cohort). Absent for a student not
  // yet assigned, or in a section with no split lab periods at all - such a
  // student won't appear in ANY batch-filtered attendance session until
  // assigned, so an unassigned student is a gap the HOD needs to notice and
  // fill in, not something the system guesses.
  labBatch?: string;
  // ─── Admission-detail fields ────────────────────────────────────────────
  // All optional, all set only via the College Office bulk import (see
  // src/lib/students/importRow.ts) - there is no per-student edit form for
  // any of these today, same as the older gender/dateOfBirth/etc. fields
  // above. Photo is intentionally not collected via CSV import at all.
  //
  // The programme the student is admitted into (B.Tech, M.Tech …). Validated
  // against the college's `courses` collection when set (name or short Code,
  // resolved to canonical name - see college/students/import-excel's
  // resolveCourse), but this field alone still can't disambiguate "which
  // section" on its own: `courseId` below is the real reference for that.
  // "Branch" remains an alias of `department`, but "Course" no longer is: the
  // roster template carries both columns, so reading them as the same field
  // would have made a sheet naming its programme in one and its branch in the
  // other silently unimportable.
  course?: string;
  // The real reference `course` names. A department can run more than one
  // Section sharing the exact same (department, name, year) as long as they
  // belong to different courses (see college/sections POST's own duplicate
  // check, scoped by courseId for exactly this reason - e.g. a B.Tech
  // "PHYSICS-IT-A" and a later, independent M.Tech "PHYSICS-IT-A") - so
  // `department`+`section`+`year` alone can no longer say which Section doc
  // this student is actually in. Set/kept in sync with the section they're
  // actually placed into (students/[id] PATCH's targetSectionId move, the
  // bulk importer's placed rows, distribute/distribute-cohort) - the moment a
  // student is genuinely IN a section, this always mirrors that section's own
  // `courseId`, never admission-time free text. For an unassigned student, set
  // best-effort from their (validated) `course` value when one was given.
  // Every "students in this section" join must include this once it's
  // present - see sections/route.ts GET's studentCount, students/[id]
  // route.ts's findCurrentSectionDoc, student-attendance and
  // internal-exam-marks routes' roster queries.
  courseId?: string;
  semester?: number;
  dateOfAdmission?: string; // yyyy-mm-dd
  admissionNo?: string;
  hallTicketNo?: string;
  admissionType?: string; // e.g. Direct, Management, Convenor
  entranceType?: string; // e.g. EAMCET, ECET
  entranceRank?: string;
  jeeRank?: string;
  jeePercentage?: string;
  seatType?: string; // e.g. Convenor, Management
  scholarship?: boolean;
  caste?: Caste;
  subCaste?: string;
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
  | "LEAVE_OD_PROOF_PENDING_VERIFICATION"
  // Late-attendance permission (see types/permission.ts)
  | "PERMISSION_REQUESTED"
  | "PERMISSION_APPROVED"
  | "PERMISSION_REJECTED"
  | "LEAVE_OD_PROOF_VERIFIED"
  | "LEAVE_OD_PROOF_REJECTED"
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
  | "STAFF_ROLE_CHANGED"
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
  | "LEAVE_COVERAGE_ADJUSTED"
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
  | "LATE_CHECKIN_PERMISSION_GRANTED"
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
  | "STUDENT_GRADUATED"
  | "STUDENT_SECTION_DISTRIBUTED"
  // Research & Development module - publications/patents/projects/etc. None of
  // these had any audit trail before; added so every R&D-module write (create,
  // edit, verify decision, delete) is traceable the same way every other
  // module already is.
  | "RD_PUBLICATION_CREATED"
  | "RD_PUBLICATION_UPDATED"
  | "RD_PUBLICATION_DELETED"
  | "RD_SPONSORED_PROJECT_CREATED"
  | "RD_SPONSORED_PROJECT_UPDATED"
  | "RD_SPONSORED_PROJECT_DELETED"
  | "RD_SEED_FUNDING_CREATED"
  | "RD_SEED_FUNDING_UPDATED"
  | "RD_SEED_FUNDING_DELETED"
  | "RD_CITATION_METRICS_CREATED"
  | "RD_CITATION_METRICS_UPDATED"
  | "RD_DISCOVERY_INNOVATION_CREATED"
  | "RD_DISCOVERY_INNOVATION_UPDATED"
  | "RD_DISCOVERY_INNOVATION_DELETED"
  | "RD_INNOVATION_CREATED"
  | "RD_INNOVATION_UPDATED"
  | "RD_INNOVATION_DELETED"
  | "RD_HACKATHON_CREATED"
  | "RD_HACKATHON_UPDATED"
  | "RD_HACKATHON_DELETED"
  | "RD_RESEARCH_SERVICE_CREATED"
  | "RD_RESEARCH_SERVICE_UPDATED"
  | "RD_RESEARCH_SERVICE_DELETED"
  | "RD_PHD_SUPERVISION_CREATED"
  | "RD_PHD_SUPERVISION_UPDATED"
  | "RD_PHD_SUPERVISION_DELETED"
  | "RD_CONSULTANCY_PROJECT_CREATED"
  | "RD_CONSULTANCY_PROJECT_UPDATED"
  | "RD_CONSULTANCY_PROJECT_DELETED"
  | "RD_RESEARCH_PROFILE_CREATED"
  | "RD_RESEARCH_PROFILE_UPDATED";

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
