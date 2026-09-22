import { departmentOfContext, hodContextKey } from "@/lib/roles/activeHodDepartment";
import type { UserRole } from "@/types";
import { ROLE_LABELS } from "@/types";

// ─── Location-level nav ────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  roles: UserRole[];
  badge?: string;
  section?: string; // optional section header rendered above this item
  // Hides this item for a login whose real, un-normalized role (FMSUser.realRole)
  // is one of these - even though `roles` above still matches its normalized
  // `role`. Exists for COLLEGE_ADMIN, which reads as "PRINCIPAL" in `role`
  // everywhere (see FMSUser.realRole) but must not see a specific Principal-only
  // item. Leave unset for every ordinary item - this is a narrow exception, not
  // a general per-item permission system (that's filterVisibleNavItems' own
  // Super-Admin-configurable hiddenModules/hiddenItems).
  hideForRealRoles?: UserRole[];
  // The inverse of hideForRealRoles: shows this item ONLY for a login whose
  // real, un-normalized role (FMSUser.realRole) is one of these, even though
  // `roles` above matches its normalized `role` more broadly. Exists for
  // COLLEGE_ADMIN-only items (e.g. resetting another member's password) that
  // must stay invisible to an ordinary Principal, who shares the same
  // normalized "PRINCIPAL" role. Leave unset for every ordinary item.
  showOnlyForRealRoles?: UserRole[];
}

// A nav item is "active" if its href exactly matches the current path, or —
// only when no other item in the same list matches exactly — if it's a
// prefix of the path (so a detail/sub-page without its own nav entry still
// highlights its parent). The exact-match guard prevents a shorter href
// (e.g. "/super-admin/users") from also lighting up when a sibling item's
// href (e.g. "/super-admin/users/new") is the one that exactly matches.
export function isNavItemActive(item: NavItem, pathname: string, allItems: NavItem[]): boolean {
  if (pathname === item.href) return true;
  if (allItems.some((i) => i.href === pathname)) return false;
  return item.href !== "/" && pathname.startsWith(item.href + "/");
}

// Roles whose own hiring-pipeline board (PipelineBoard.tsx / PrincipalPipelineBoard.tsx)
// already links straight into panel scoring ("Monitor Panel Scoring →") - they don't
// need the dynamic "My Interviews" nav item Sidebar/MobileDrawer inject for every other
// role that gets added to a panel (e.g. Principal/VP are default members on every batch).
export const ROLES_WITH_EMBEDDED_PANEL_ACCESS: ReadonlySet<UserRole> = new Set([
  "PRINCIPAL",
  "VICE_PRINCIPAL",
  "HOD",
]);

export const NAV_ITEMS: NavItem[] = [
  // Management
  { label: "Dashboard", href: "/management/dashboard", iconName: "LayoutDashboard", roles: ["MANAGEMENT"] },
  { label: "Locations", href: "/management/locations", iconName: "MapPin", roles: ["MANAGEMENT"], section: "Organization" },
  { label: "Add Administrator", href: "/management/users/new", iconName: "UserPlus", roles: ["MANAGEMENT"] },
  { label: "Faculty Details", href: "/management/faculty", iconName: "UsersRound", roles: ["MANAGEMENT"] },
  { label: "Role Assignments", href: "/management/role-assignments", iconName: "UserCog", roles: ["MANAGEMENT"] },
  { label: "Budget", href: "/management/budget", iconName: "PiggyBank", roles: ["MANAGEMENT"], section: "Reports" },
  { label: "Budget History", href: "/management/indents", iconName: "ClipboardList", roles: ["MANAGEMENT"] },
  { label: "Attendance", href: "/management/attendance", iconName: "ClipboardCheck", roles: ["MANAGEMENT"] },
  { label: "Leave Approvals", href: "/management/leave-approvals", iconName: "CalendarClock", roles: ["MANAGEMENT"], section: "HR" },
  { label: "My Profile", href: "/management/profile", iconName: "UserCircle", roles: ["MANAGEMENT"], section: "Personal" },

  // Super Admin
  { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
  { label: "Locations", href: "/super-admin/locations", iconName: "MapPin", roles: ["SUPER_ADMIN"], section: "Organization" },
  { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
  { label: "All Users", href: "/super-admin/users", iconName: "Users", roles: ["SUPER_ADMIN"], section: "Users" },
  { label: "Add User", href: "/super-admin/users/new", iconName: "UserPlus", roles: ["SUPER_ADMIN"] },
  { label: "Role Assignments", href: "/super-admin/role-assignments", iconName: "UserCog", roles: ["SUPER_ADMIN"] },
  { label: "Audit Logs", href: "/super-admin/audit-logs", iconName: "ScrollText", roles: ["SUPER_ADMIN"], section: "System" },
  { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },
  { label: "My Profile", href: "/super-admin/profile", iconName: "UserCircle", roles: ["SUPER_ADMIN"], section: "Personal" },

  // Administration
  { label: "Dashboard", href: "/administration", iconName: "LayoutDashboard", roles: ["ADMINISTRATION"] },
  { label: "Location Staff", href: "/administration/users", iconName: "Users", roles: ["ADMINISTRATION"], section: "Management" },
  { label: "Departments", href: "/administration/departments", iconName: "Settings2", roles: ["ADMINISTRATION"] },
  { label: "Colleges", href: "/administration/colleges", iconName: "Building2", roles: ["ADMINISTRATION"] },
  { label: "Hiring Requests", href: "/administration/vacancies", iconName: "ClipboardList", roles: ["ADMINISTRATION"], section: "Hiring" },
  { label: "Interview Plans", href: "/administration/interviews", iconName: "CalendarCheck", roles: ["ADMINISTRATION"] },
  { label: "Offer Letters", href: "/administration/offers", iconName: "FileText", roles: ["ADMINISTRATION"] },
  { label: "My Profile", href: "/administration/profile", iconName: "UserCircle", roles: ["ADMINISTRATION"], section: "Personal" },
  { label: "Settings", href: "/administration/settings", iconName: "Settings2", roles: ["ADMINISTRATION"] },

  // HR Admin
  { label: "Dashboard", href: "/hr-admin", iconName: "LayoutDashboard", roles: ["HR_ADMIN"] },
  { label: "Hiring Requests", href: "/hr-admin/vacancies", iconName: "ClipboardPlus", roles: ["HR_ADMIN"], section: "Hiring" },
  { label: "Candidates", href: "/hr-admin/candidates", iconName: "Users", roles: ["HR_ADMIN"] },
  { label: "Interviews", href: "/hr-admin/interviews", iconName: "CalendarCheck", roles: ["HR_ADMIN"] },
  { label: "Offer Letters", href: "/hr-admin/offers", iconName: "FileText", roles: ["HR_ADMIN"] },
  { label: "My Profile", href: "/hr-admin/profile", iconName: "UserCircle", roles: ["HR_ADMIN"], section: "Personal" },

  // Admin Office
  { label: "Dashboard", href: "/admin-office", iconName: "LayoutDashboard", roles: ["ADMIN_OFFICE"] },
  { label: "My Profile", href: "/admin-office/profile", iconName: "UserCircle", roles: ["ADMIN_OFFICE"], section: "Personal" },

  // Placement Department
  { label: "Dashboard", href: "/placement-dept", iconName: "LayoutDashboard", roles: ["PLACEMENT_DEPT"] },
  { label: "My Profile", href: "/placement-dept/profile", iconName: "UserCircle", roles: ["PLACEMENT_DEPT"], section: "Personal" },
  { label: "My Leave", href: "/placement-dept/leave", iconName: "CalendarClock", roles: ["PLACEMENT_DEPT"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["PLACEMENT_DEPT"] },

  // Library
  { label: "Dashboard", href: "/library", iconName: "LayoutDashboard", roles: ["LIBRARY"] },
  { label: "Staff Attendance", href: "/library/staff-attendance", iconName: "ClipboardCheck", roles: ["LIBRARY"] },
  { label: "Import Attendance", href: "/library/attendance-import", iconName: "Upload", roles: ["LIBRARY"] },
  { label: "My Profile", href: "/library/profile", iconName: "UserCircle", roles: ["LIBRARY"], section: "Personal" },
  { label: "My Leave", href: "/library/leave", iconName: "CalendarClock", roles: ["LIBRARY"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["LIBRARY"] },
  { label: "My Attendance", href: "/library/attendance", iconName: "ClipboardCheck", roles: ["LIBRARY"], section: "My Work" },

  // College Accounts
  { label: "Dashboard", href: "/college-accounts", iconName: "LayoutDashboard", roles: ["COLLEGE_ACCOUNTS"] },
  { label: "Hiring Journey", href: "/college-accounts/hiring", iconName: "FolderOpen", roles: ["COLLEGE_ACCOUNTS"], section: "Hiring" },
  { label: "Candidates", href: "/college-accounts/candidates", iconName: "UserCog", roles: ["COLLEGE_ACCOUNTS"] },
  { label: "My Profile", href: "/college-accounts/profile", iconName: "UserCircle", roles: ["COLLEGE_ACCOUNTS"], section: "Personal" },
  { label: "My Leave", href: "/college-accounts/leave", iconName: "CalendarClock", roles: ["COLLEGE_ACCOUNTS"] },

  // Exam Cell
  { label: "Dashboard", href: "/exam-cell", iconName: "LayoutDashboard", roles: ["EXAM_CELL"] },
  { label: "Exam Configuration", href: "/exam-cell/configure", iconName: "ClipboardList", roles: ["EXAM_CELL"] },
  { label: "Staff Attendance", href: "/exam-cell/staff-attendance", iconName: "ClipboardCheck", roles: ["EXAM_CELL"] },
  { label: "Import Attendance", href: "/exam-cell/attendance-import", iconName: "Upload", roles: ["EXAM_CELL"] },
  { label: "My Profile", href: "/exam-cell/profile", iconName: "UserCircle", roles: ["EXAM_CELL"], section: "Personal" },
  { label: "My Leave", href: "/exam-cell/leave", iconName: "CalendarClock", roles: ["EXAM_CELL"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["EXAM_CELL"] },
  { label: "My Attendance", href: "/exam-cell/attendance", iconName: "ClipboardCheck", roles: ["EXAM_CELL"], section: "My Work" },

  // Location Dept Head
  { label: "Dashboard", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "Hiring Requests", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"], section: "Hiring" },
  { label: "My Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "My Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "My Profile", href: "/location-dept-head/profile", iconName: "UserCircle", roles: ["LOCATION_DEPT_HEAD"], section: "Personal" },

  // Vice Principal — own dashboard + General Admin Vacancies; everything else
  // is shared with Principal below (VICE_PRINCIPAL added to those roles arrays)
  // since the two roles carry equal authority per AGENTS.md.
  { label: "Dashboard", href: "/vice-principal", iconName: "LayoutDashboard", roles: ["VICE_PRINCIPAL"] },
  { label: "General Admin Vacancies", href: "/principal/vacancies/general-admin", iconName: "ClipboardPlus", roles: ["VICE_PRINCIPAL"], section: "Hiring" },

  // Principal (shared with Vice Principal — see note above)
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  // Grouped by functional domain (see PRINCIPAL_DASHBOARD.md), not by data location.
  { label: "Dashboard", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
  // Panel Scoring and Appointment Letters are no longer separate tabs - both
  // are folded into the Hiring Requests pipeline's own status badges/actions
  // (see PrincipalPipelineBoard.tsx) since they're just later stages of the
  // same hiring request, not independent destinations.
  // Vacancy/interview/candidate decisions live here end-to-end - College Admin
  // enters data and settings but never decides, so the whole board is Principal/
  // Vice Principal only (see NavItem.hideForRealRoles and the matching API
  // guards in vacancy-requests, hiring-batches, and candidate-applications).
  { label: "Hiring Requests", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Hiring Pipeline", hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "Courses", href: "/principal/courses", iconName: "GraduationCap", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Academic Management" },
  { label: "Departments", href: "/principal/departments", iconName: "BookOpen", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // College-wide, read-only view of every section. A College Admin reaches it
  // too - that role normalizes to PRINCIPAL before any nav role is read.
  { label: "Sections", href: "/principal/sections", iconName: "BookMarked", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Students", href: "/principal/students", iconName: "GraduationCap", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Student Promotion", href: "/principal/promotions", iconName: "GraduationCap", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Graduated Students", href: "/principal/graduates", iconName: "Award", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Timetable", href: "/principal/timetable", iconName: "CalendarDays", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Student Attendance History", href: "/principal/attendance-history", iconName: "CalendarCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Internal Marks", href: "/principal/internal-marks", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Staff & HR Management" },
  // Deciding a leave request is Principal/VP authority, not College Admin's -
  // see the matching guard in api/leave/applications/[id]/route.ts.
  { label: "Leave Approvals", href: "/principal/leave-approvals", iconName: "CalendarClock", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "Leave History", href: "/principal/leave-history", iconName: "History", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // Arrange cover for someone below them (Vice Principal / Academics / HODs) who has
  // other work on a date or range - see StaffAdjustmentsPage.
  { label: "Adjustments", href: "/principal/adjustments", iconName: "UserCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Attendance Report", href: "/principal/attendance-report", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // Views whether faculty submitted student attendance for their scheduled
  // periods, and whether it was on time - distinct from "Attendance Report"
  // above (staff self check-in/out). College Admin needs this to chase
  // whoever hasn't logged it yet, so unlike the other Principal-decision
  // items on this page it stays visible to them (see NavItem.hideForRealRoles).
  { label: "Attendance Completion", href: "/principal/attendance-completion", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Import Attendance", href: "/principal/attendance-import", iconName: "Upload", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // Budget-cycle and budget-request approval is Principal/VP decision
  // authority, not College Admin's - see the matching guards in
  // api/college/budget-cycles/[id] and api/college/budget-requests/[id].
  { label: "Budget", href: "/principal/budget", iconName: "PiggyBank", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Payroll & Budget", hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "Budget Report", href: "/principal/budget/report", iconName: "FileText", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // Only ever shows the Principal/VP's OWN emergency purchase requests - not
  // something College Admin should be raising on the college's behalf either.
  { label: "Purchase Clearance", href: "/principal/purchase-clearance", iconName: "Receipt", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "Budget History", href: "/principal/indents", iconName: "ClipboardList", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  // College Admin is a role-login, not one continuous employee (see
  // administration/college-people): no personal HR profile, attendance, or
  // leave to track, unlike every other seat here (a real Principal/VP is
  // always an actual appointed person). Its Name/Phone/password live in
  // CollegeAdminAccountMenu off the sidebar's account row instead. See
  // NavItem.hideForRealRoles.
  { label: "My Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Personal", hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "My Attendance", href: "/principal/attendance", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "My Leave", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  // The Principal is never named as anyone's substitute/handover, so only the
  // Vice Principal has requests to accept or decline here.
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["VICE_PRINCIPAL"] },
  { label: "Settings", href: "/principal/settings", iconName: "Settings2", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Audit Logs", href: "/principal/audit-logs", iconName: "History", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Administration" },
  // Appoint people to seats (Principal, each HOD, Vice Principal, Academics, ...) -
  // see types/roleSeats.ts.
  { label: "Role Assignments", href: "/principal/role-assignments", iconName: "UserCog", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Reset Member Password", href: "/principal/reset-password", iconName: "KeyRound", roles: ["PRINCIPAL"], showOnlyForRealRoles: ["COLLEGE_ADMIN"] },

  // HOD
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  { label: "Dashboard", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
  { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"], section: "Department" },
  { label: "Supporting Staff", href: "/hod/supporting-staff", iconName: "UsersRound", roles: ["HOD"] },
  { label: "Sections", href: "/hod/sections", iconName: "BookMarked", roles: ["HOD"] },
  { label: "Students", href: "/hod/students", iconName: "GraduationCap", roles: ["HOD"] },
  { label: "Sub-Departments", href: "/hod/settings/sub-departments", iconName: "Settings2", roles: ["HOD"] },
  { label: "Designations", href: "/hod/settings/designations", iconName: "Tags", roles: ["HOD"] },
  // Hidden from a Department Office head, whose `role` also reads "HOD": they
  // hold the same authority everywhere else, but appointing their own successor
  // stays with the actual HOD. The API enforces that too - this only keeps a
  // dead link out of their sidebar. See NavItem.hideForRealRoles.
  { label: "Department Office", href: "/hod/settings/department-office", iconName: "UserCog", roles: ["HOD"], hideForRealRoles: ["DEPARTMENT_OFFICE"] },
  { label: "Subjects", href: "/hod/subjects", iconName: "Library", roles: ["HOD"] },
  { label: "Teaching Assignments", href: "/hod/teaching-assignments", iconName: "BookOpen", roles: ["HOD"] },
  { label: "Assignment Requests", href: "/hod/assignment-requests", iconName: "Send", roles: ["HOD"] },
  { label: "Internal Exam", href: "/hod/internal-exam", iconName: "ClipboardCheck", roles: ["HOD"] },
  // Sits directly below Teaching Assignments: subjects are assigned there first,
  // then scheduled here.
  { label: "Timetable", href: "/hod/timetable", iconName: "CalendarDays", roles: ["HOD"] },
  { label: "Attendance Reports", href: "/hod/monthly-records", iconName: "CalendarRange", roles: ["HOD"] },
  { label: "Attendance History", href: "/hod/attendance-history", iconName: "CalendarCheck", roles: ["HOD"] },
  { label: "Leave Approvals", href: "/hod/leave-approvals", iconName: "CalendarClock", roles: ["HOD"], section: "Approvals" },
  { label: "Leave History", href: "/hod/leave-history", iconName: "History", roles: ["HOD"] },
  // Arrange cover for their department's faculty / supporting staff who have
  // other work on a date or range - see StaffAdjustmentsPage.
  { label: "Adjustments", href: "/hod/adjustments", iconName: "UserCheck", roles: ["HOD"] },
  { label: "Faculty Attendance", href: "/hod/faculty-attendance", iconName: "ClipboardCheck", roles: ["HOD"] },
  // Same view as Principal's "Attendance Completion" - own department's
  // faculty only (see faculty-attendance-completion/route.ts's HOD scoping).
  { label: "Attendance Completion", href: "/hod/attendance-completion", iconName: "ClipboardCheck", roles: ["HOD"] },
  { label: "Import Attendance", href: "/hod/attendance-import", iconName: "Upload", roles: ["HOD"] },
  { label: "Leave Profiles", href: "/hod/leave/profiles", iconName: "ClipboardList", roles: ["HOD"] },
  { label: "Budget", href: "/hod/budget", iconName: "PiggyBank", roles: ["HOD"], section: "Budget & Purchase" },
  { label: "Indents", href: "/hod/indents", iconName: "ShoppingCart", roles: ["HOD"] },
  { label: "Purchase Clearance", href: "/hod/purchase-clearance", iconName: "Receipt", roles: ["HOD"] },
  // Panel Scoring is no longer its own tab - it's folded into the Hiring
  // Pipeline's own status badges/actions (see PipelineBoard.tsx), matching
  // the same merge done for Principal/Vice Principal.
  { label: "Hiring Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"], section: "Hiring" },
  { label: "Candidates", href: "/hod/candidates", iconName: "Users", roles: ["HOD"] },
  { label: "My Attendance", href: "/hod/attendance", iconName: "ClipboardCheck", roles: ["HOD"], section: "My Work" },
  { label: "My Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["HOD"] },
  { label: "Teaching Load", href: "/hod/teaching", iconName: "BookOpen", roles: ["HOD"] },
  { label: "My Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"], section: "Personal" },

  // College Office
  { label: "Dashboard", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
  { label: "Students", href: "/college-office/students", iconName: "GraduationCap", roles: ["COLLEGE_OFFICE"], section: "Students" },
  { label: "Graduated Students", href: "/college-office/graduates", iconName: "Award", roles: ["COLLEGE_OFFICE"] },
  { label: "Semester Timings", href: "/college-office/timings", iconName: "Clock", roles: ["COLLEGE_OFFICE"] },
  { label: "Non-Technical Staff", href: "/college-office/non-technical-staff", iconName: "UsersRound", roles: ["COLLEGE_OFFICE"], section: "Staff" },
  // Only the first item of a group carries `section` - the sidebar renders a
  // header for every item that sets one, so repeating it printed "STAFF" three
  // times over.
  { label: "Faculty", href: "/college-office/faculty", iconName: "Wallet", roles: ["COLLEGE_OFFICE"] },
  { label: "HOD / Principal", href: "/college-office/staff", iconName: "Wallet", roles: ["COLLEGE_OFFICE"] },
  { label: "Hiring Pipeline", href: "/college-office/pipeline", iconName: "GitBranch", roles: ["COLLEGE_OFFICE"], section: "Hiring" },
  { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },
  { label: "Leave History", href: "/college-office/leave-history", iconName: "History", roles: ["COLLEGE_OFFICE"], section: "Leave & Attendance" },
  { label: "Leave Profiles", href: "/college-office/leave/profiles", iconName: "ClipboardList", roles: ["COLLEGE_OFFICE"] },
  // Arrange cover for supporting staff who have other work on a date or range.
  { label: "Adjustments", href: "/college-office/adjustments", iconName: "UserCheck", roles: ["COLLEGE_OFFICE"] },
  { label: "Holidays", href: "/college-office/holidays", iconName: "CalendarDays", roles: ["COLLEGE_OFFICE"] },
  { label: "Staff Attendance", href: "/college-office/staff-attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_OFFICE"] },
  { label: "Import Attendance", href: "/college-office/attendance-import", iconName: "Upload", roles: ["COLLEGE_OFFICE"] },
  // College Admin's login has COLLEGE_OFFICE as its primary role (the seat is
  // layered on top - see api/administration/college-people), so it inherits
  // this whole section too, including these personal items - same reasoning
  // as the Principal-side My Profile/Leave/Attendance. See NavItem.hideForRealRoles.
  { label: "My Profile", href: "/college-office/profile", iconName: "UserCircle", roles: ["COLLEGE_OFFICE"], section: "Personal", hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "My Leave", href: "/college-office/leave", iconName: "CalendarClock", roles: ["COLLEGE_OFFICE"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  // Same reasoning as the Principal-side omission of this item ("The
  // Principal is never named as anyone's substitute/handover" - see the
  // comment near PRINCIPAL's own nav block): College Admin normalizes to
  // Principal, so it isn't named as anyone's substitute either.
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["COLLEGE_OFFICE"], hideForRealRoles: ["COLLEGE_ADMIN"] },
  { label: "My Attendance", href: "/college-office/attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_OFFICE"], section: "My Work", hideForRealRoles: ["COLLEGE_ADMIN"] },

  // College Staff (generic fallback for titles that don't warrant their own role)
  { label: "Dashboard", href: "/college-staff", iconName: "LayoutDashboard", roles: ["COLLEGE_STAFF"] },
  // Shown to every COLLEGE_STAFF regardless of whether an HOD has actually
  // delegated anything to them yet - mirrors panel/timetable-incharge's own
  // entry above; only Technical-category staff are ever eligible (see
  // TimetableIncharge in src/types/core.ts), but the page itself shows an
  // empty state for anyone else, same convention as Leave/Attendance.
  { label: "Timetable Incharge", href: "/college-staff/timetable-incharge", iconName: "UserCog", roles: ["COLLEGE_STAFF"] },
  { label: "Assignment Requests", href: "/college-staff/assignment-requests", iconName: "Send", roles: ["COLLEGE_STAFF"] },
  { label: "My Profile", href: "/college-staff/profile", iconName: "UserCircle", roles: ["COLLEGE_STAFF"], section: "Personal" },
  { label: "My Leave", href: "/college-staff/leave", iconName: "CalendarClock", roles: ["COLLEGE_STAFF"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["COLLEGE_STAFF"] },
  { label: "My Attendance", href: "/college-staff/attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_STAFF"], section: "My Work" },

  // Academics
  { label: "Dashboard", href: "/academics", iconName: "LayoutDashboard", roles: ["ACADEMICS"] },
  { label: "Subjects", href: "/academics/subjects", iconName: "Library", roles: ["ACADEMICS"], section: "Academics" },
  { label: "My Profile", href: "/academics/profile", iconName: "UserCircle", roles: ["ACADEMICS"], section: "Personal" },
  { label: "My Leave", href: "/academics/leave", iconName: "CalendarClock", roles: ["ACADEMICS"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["ACADEMICS"] },

  // IQAC Coordinator
  { label: "Dashboard", href: "/iqac-coordinator", iconName: "LayoutDashboard", roles: ["IQAC_COORDINATOR"] },
  { label: "My Profile", href: "/iqac-coordinator/profile", iconName: "UserCircle", roles: ["IQAC_COORDINATOR"], section: "Personal" },
  { label: "My Leave", href: "/iqac-coordinator/leave", iconName: "CalendarClock", roles: ["IQAC_COORDINATOR"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["IQAC_COORDINATOR"] },

  // T&P
  { label: "Dashboard", href: "/t-and-p", iconName: "LayoutDashboard", roles: ["T_AND_P"] },
  { label: "Staff Attendance", href: "/t-and-p/staff-attendance", iconName: "ClipboardCheck", roles: ["T_AND_P"] },
  { label: "Import Attendance", href: "/t-and-p/attendance-import", iconName: "Upload", roles: ["T_AND_P"] },
  { label: "My Profile", href: "/t-and-p/profile", iconName: "UserCircle", roles: ["T_AND_P"], section: "Personal" },
  { label: "My Leave", href: "/t-and-p/leave", iconName: "CalendarClock", roles: ["T_AND_P"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["T_AND_P"] },
  { label: "My Attendance", href: "/t-and-p/attendance", iconName: "ClipboardCheck", roles: ["T_AND_P"], section: "My Work" },

  // R&D
  { label: "Dashboard", href: "/r-and-d", iconName: "LayoutDashboard", roles: ["R_AND_D"] },
  { label: "Publications", href: "/r-and-d/publications", iconName: "FlaskConical", roles: ["R_AND_D"], section: "Research" },
  { label: "Research Profiles", href: "/r-and-d/research-profiles", iconName: "IdCard", roles: ["R_AND_D"] },
  { label: "Citation Metrics", href: "/r-and-d/citation-metrics", iconName: "TrendingUp", roles: ["R_AND_D"] },
  { label: "Consultancy Projects", href: "/r-and-d/consultancy-projects", iconName: "HandCoins", roles: ["R_AND_D"] },
  { label: "Seed Funding", href: "/r-and-d/seed-funding", iconName: "PiggyBank", roles: ["R_AND_D"] },
  { label: "Sponsored Projects", href: "/r-and-d/sponsored-projects", iconName: "Landmark", roles: ["R_AND_D"] },
  { label: "Discovery & Innovation", href: "/r-and-d/discovery-innovation", iconName: "Lightbulb", roles: ["R_AND_D"] },
  { label: "Ph.D. Supervision", href: "/r-and-d/phd-supervision", iconName: "GraduationCap", roles: ["R_AND_D"] },
  { label: "Research Services", href: "/r-and-d/research-services", iconName: "Presentation", roles: ["R_AND_D"] },
  { label: "Hackathons", href: "/r-and-d/hackathons", iconName: "Trophy", roles: ["R_AND_D"] },
  { label: "Innovations", href: "/r-and-d/innovations", iconName: "Sparkles", roles: ["R_AND_D"] },
  { label: "My Profile", href: "/r-and-d/profile", iconName: "UserCircle", roles: ["R_AND_D"], section: "Personal" },
  { label: "My Leave", href: "/r-and-d/leave", iconName: "CalendarClock", roles: ["R_AND_D"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["R_AND_D"] },

  // R&D Coordinator (seat, one per department) - the only position module; everything
  // personal stays under the holder's own primary role.
  { label: "Dashboard", href: "/rnd-coordinator", iconName: "LayoutDashboard", roles: ["RND_COORDINATOR"] },

  // Faculty (PANEL_MEMBER) — My Interviews is injected dynamically in Sidebar when assigned
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  { label: "Dashboard", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
  { label: "Teaching Load", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"], section: "My Work" },
  // Shown to every PANEL_MEMBER regardless of whether an HOD has actually
  // delegated anything to them yet - the page itself shows an empty state
  // when it's empty, same convention as Leave/Attendance always showing even
  // before someone has any requests/records (see TimetableIncharge in
  // src/types/core.ts).
  { label: "Timetable Incharge", href: "/panel/timetable-incharge", iconName: "UserCog", roles: ["PANEL_MEMBER"] },
  // Only meaningful once this uid is Timetable Incharge for at least one
  // department (see isTimetableInchargeForDepartment) - shown unconditionally
  // like the entry above, same empty-state convention.
  { label: "Assignment Requests", href: "/panel/assignment-requests", iconName: "Send", roles: ["PANEL_MEMBER"] },
  { label: "Internal Exam", href: "/panel/internal-exam", iconName: "ClipboardList", roles: ["PANEL_MEMBER"] },
  { label: "Student Attendance", href: "/panel/mark-attendance", iconName: "CalendarCheck", roles: ["PANEL_MEMBER"] },
  { label: "Attendance Report", href: "/panel/monthly-records", iconName: "CalendarRange", roles: ["PANEL_MEMBER"] },
  { label: "Students", href: "/panel/students", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
  { label: "My Feedback", href: "/panel/feedback", iconName: "MessageSquare", roles: ["PANEL_MEMBER"] },
  { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"], section: "Leave & Attendance" },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["PANEL_MEMBER"] },
  { label: "My Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
  { label: "My Profile", href: "/panel/profile", iconName: "UserCircle", roles: ["PANEL_MEMBER"], section: "Personal" },

  // Accounts
  { label: "Dashboard", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
  { label: "Hiring — Offer Letters", href: "/accounts/hiring", iconName: "UserCheck", roles: ["ACCOUNTS"], section: "Hiring" },
  { label: "Hiring Pipeline", href: "/accounts/pipeline", iconName: "GitBranch", roles: ["ACCOUNTS"], section: "Hiring" },
  { label: "Salary Structures", href: "/accounts/salary-structures", iconName: "Landmark", roles: ["ACCOUNTS"], section: "Payroll" },
  { label: "My Profile", href: "/accounts/profile", iconName: "UserCircle", roles: ["ACCOUNTS"], section: "Personal" },
  { label: "My Leave", href: "/accounts/leave", iconName: "CalendarClock", roles: ["ACCOUNTS"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["ACCOUNTS"] },

  // Finance
  { label: "Dashboard", href: "/finance", iconName: "LayoutDashboard", roles: ["FINANCE"] },
  { label: "Budget Management", href: "/finance/budget", iconName: "Wallet", roles: ["FINANCE"], section: "Budgets" },
  { label: "Budget Cycles", href: "/finance/budget-cycles", iconName: "CalendarClock", roles: ["FINANCE"] },
  { label: "Budget Approvals", href: "/finance/budget-approvals", iconName: "ClipboardCheck", roles: ["FINANCE"] },
  { label: "Budget Report", href: "/finance/budget/report", iconName: "FileText", roles: ["FINANCE"] },
  { label: "Fund Allocation", href: "/finance/fund-allocation", iconName: "PieChart", roles: ["FINANCE"] },
  { label: "Expense Requests", href: "/finance/expense-requests", iconName: "ClipboardList", roles: ["FINANCE"], section: "Approvals" },
  { label: "Purchase Finance Clearance", href: "/finance/purchase-clearance", iconName: "ShoppingCart", roles: ["FINANCE"] },
  { label: "Indent Approvals", href: "/finance/indent-approvals", iconName: "ClipboardCheck", roles: ["FINANCE"] },
  { label: "Payments", href: "/finance/payments", iconName: "IndianRupee", roles: ["FINANCE"], section: "Payments" },
  { label: "Receipts", href: "/finance/receipts", iconName: "Receipt", roles: ["FINANCE"] },
  { label: "Financial Reports", href: "/finance/reports", iconName: "BarChart3", roles: ["FINANCE"], section: "Reports" },
  { label: "Audit & Compliance", href: "/finance/audit", iconName: "ScrollText", roles: ["FINANCE"] },
  { label: "Browse by Location", href: "/finance/browse", iconName: "MapPin", roles: ["FINANCE"], section: "Organization" },
  { label: "My Profile", href: "/finance/profile", iconName: "UserCircle", roles: ["FINANCE"], section: "Personal" },
  { label: "My Leave", href: "/finance/leave", iconName: "CalendarClock", roles: ["FINANCE"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["FINANCE"] },

  // Class Leader
  { label: "Dashboard", href: "/class-leader", iconName: "LayoutDashboard", roles: ["CLASS_LEADER"] },
  { label: "Timetable", href: "/class-leader/timetable", iconName: "CalendarDays", roles: ["CLASS_LEADER"] },

  // Webmaster
  { label: "Dashboard", href: "/webmaster", iconName: "LayoutDashboard", roles: ["WEBMASTER"] },
  { label: "Credential Requests", href: "/webmaster/credential-requests", iconName: "KeyRound", roles: ["WEBMASTER"], section: "Hiring" },
  { label: "All Accounts", href: "/webmaster/users", iconName: "Users", roles: ["WEBMASTER"], section: "Accounts" },
  { label: "My Profile", href: "/webmaster/profile", iconName: "UserCircle", roles: ["WEBMASTER"], section: "Personal" },
  { label: "My Leave", href: "/webmaster/leave", iconName: "CalendarClock", roles: ["WEBMASTER"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["WEBMASTER"] },

  // Purchase Department
  { label: "Dashboard", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
  { label: "Pending Requests", href: "/purchase/pending", iconName: "Clock", roles: ["PURCHASE_DEPT"], section: "Requests" },
  { label: "Latest Requests", href: "/purchase/latest", iconName: "History", roles: ["PURCHASE_DEPT"] },
  { label: "All Requests", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
  { label: "By Category", href: "/purchase/by-category", iconName: "Tags", roles: ["PURCHASE_DEPT"] },
  { label: "By Goods / Non-Goods", href: "/purchase/by-type", iconName: "PackageCheck", roles: ["PURCHASE_DEPT"] },
  { label: "Browse by Location", href: "/purchase/browse", iconName: "MapPin", roles: ["PURCHASE_DEPT"], section: "Organization" },
  { label: "My Profile", href: "/purchase/profile", iconName: "UserCircle", roles: ["PURCHASE_DEPT"], section: "Personal" },
  { label: "My Leave", href: "/purchase/leave", iconName: "CalendarClock", roles: ["PURCHASE_DEPT"] },
  { label: "Adjustment Requests", href: "/leave/adjustments", iconName: "UserCheck", roles: ["PURCHASE_DEPT"] },
];

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

// Items that are about the PERSON, not the position they hold: their own
// profile (personal details, R&D modules), leave (apply / balances / history),
// attendance, the adjustment requests addressed to them, and their own
// teaching load. Every login has these once, from its primary role - a seat's
// own copy ("My Leave" under HOD, "My Profile" under Principal, ...) would just
// duplicate them, so seats contribute only their POSITION modules (approvals,
// department / college management, reports, ...).
//
// Decided by href shape rather than by the section an item sits under: the
// Principal's Settings page, for example, sits under the same section header as
// "My Profile" but belongs to the position. Everything ending in
// /profile, /attendance, /leave, /teaching (exactly - so leave-approvals,
// staff-attendance and attendance-report are NOT personal) plus the shared
// /leave/adjustments inbox is personal.
const PERSONAL_HREF = /^\/[a-z-]+\/(profile|attendance|leave|teaching)$/;
export function isPersonalNavItem(item: Pick<NavItem, "href">): boolean {
  return PERSONAL_HREF.test(item.href) || item.href === "/leave/adjustments";
}

// The sidebar for a login that may hold several roles (see FMSUser.roles): the
// primary role's own modules exactly as before - its dashboard, personal
// details / R&D / leave, and its own work modules - followed by each seat's
// POSITION modules under a header named after the seat (Head of Department,
// Vice Principal, ...). A login with one role gets exactly
// getNavItemsForRole(primary).
export function getNavItemsForRoles(primary: UserRole, roles: readonly UserRole[] = []): NavItem[] {
  const seatRoles = roles.filter((r, i) => r !== primary && roles.indexOf(r) === i);
  const out: NavItem[] = [...getNavItemsForRole(primary)];
  if (seatRoles.length === 0) return out;

  const seen = new Set(out.map((i) => i.href));
  for (const role of seatRoles) {
    let first = true;
    for (const item of getNavItemsForRole(role)) {
      if (isPersonalNavItem(item) || seen.has(item.href)) continue;
      seen.add(item.href);
      const isDashboard = item.label === "Dashboard";
      out.push({
        ...item,
        // The seat's header replaces whatever section its first item carried so
        // the group reads as "this is what you can do as <role>".
        section: first ? ROLE_LABELS[role] : item.section,
        label: isDashboard ? `${ROLE_LABELS[role]} Dashboard` : item.label,
      });
      first = false;
    }
  }
  return out;
}

// ─── "Working as" contexts ──────────────────────────────────────────────────
// A login that holds seats (Principal, HOD, ...) would otherwise see every
// module of every seat in one long sidebar. Instead it works in ONE context at
// a time: a seat ("Principal", "Head of Department") or "My Work" (its own
// primary role). A seat's context shows only that seat's position modules;
// everything personal (dashboard, profile, leave, attendance, teaching) lives
// under "My Work" in the switcher. This only shapes the sidebar -
// what a login may actually do is decided by its held roles on the server.
export type WorkContextKey = "ME" | UserRole | `HOD:${string}`;
export interface WorkContext { key: WorkContextKey; label: string }

function seatRolesOf(primary: UserRole, roles: readonly UserRole[]): UserRole[] {
  return roles.filter((r, i) => r !== primary && roles.indexOf(r) === i);
}

// Empty for a login with no seats (nothing to switch between). `roles` lists
// seat roles most senior first, so the first context is the default.
// A head of several departments gets one context per department ("HOD - CSE").
export function getWorkContexts(primary: UserRole, roles: readonly UserRole[] = [], hodDepartments: readonly string[] = []): WorkContext[] {
  const seats = seatRolesOf(primary, roles);
  if (seats.length === 0) return [];
  return [
    ...seats.flatMap((r): WorkContext[] =>
      r === "HOD" && hodDepartments.length > 1
        ? hodDepartments.map((d) => ({ key: hodContextKey(d) as WorkContextKey, label: `${ROLE_LABELS.HOD} - ${d}` }))
        : [{ key: r as WorkContextKey, label: ROLE_LABELS[r] }]
    ),
    { key: "ME" as WorkContextKey, label: "My Work" },
  ];
}

export function getNavItemsForContext(primary: UserRole, roles: readonly UserRole[], context: WorkContextKey): NavItem[] {
  const seats = seatRolesOf(primary, roles);
  const own = getNavItemsForRole(primary);
  const seatRole = (departmentOfContext(context) !== null ? "HOD" : context) as UserRole;
  if (seats.length === 0 || context === "ME" || !seats.includes(seatRole)) return [...own];

  const out: NavItem[] = [];
  const seen = new Set<string>();
  const push = (item: NavItem) => { if (!seen.has(item.href)) { seen.add(item.href); out.push(item); } };

  let first = true;
  for (const item of getNavItemsForRole(seatRole)) {
    if (isPersonalNavItem(item)) continue;
    push({ ...item, ...(first ? { section: ROLE_LABELS[seatRole] } : {}) });
    first = false;
  }
  return out;
}

// The context to show: the one the person chose (or the most senior seat if
// none / no longer held) - unless they've landed on a page that belongs to
// another context (a link, a notification, the back button), in which case
// that context, so the sidebar always contains the page they're on.
export function resolveWorkContext(
  primary: UserRole, roles: readonly UserRole[], chosen: string | null | undefined, pathname: string,
  hodDepartments: readonly string[] = []
): WorkContextKey | null {
  const contexts = getWorkContexts(primary, roles, hodDepartments);
  if (contexts.length === 0) return null;
  const base = contexts.find((c) => c.key === chosen)?.key ?? contexts[0].key;
  const owns = (key: WorkContextKey) =>
    getNavItemsForContext(primary, roles, key).some((i) => pathname === i.href || (i.href !== "/" && pathname.startsWith(i.href + "/")));
  if (owns(base)) return base;
  return contexts.find((c) => owns(c.key))?.key ?? base;
}

// ─── Module visibility (Super Admin, per-college) ──────────────────────────
// A "module" is the group of items following a `section` header, up to (not
// including) the next item that declares its own `section`. Items before the
// first `section` header belong to the implicit "General" module.

export function computeItemModule(items: NavItem[], index: number): string {
  for (let i = index; i >= 0; i--) {
    if (items[i].section) return items[i].section!;
  }
  return "General";
}

export interface NavModuleGroup {
  name: string;
  items: NavItem[];
}

// Every role that has at least one `section`-grouped item — i.e. every role
// the Super Admin Nav Visibility settings can meaningfully control. Derived
// from NAV_ITEMS directly so a newly-grouped role shows up automatically,
// without maintaining a separate hardcoded list in the settings UI.
export function getRolesWithNavModules(): UserRole[] {
  const roles = new Set<UserRole>();
  NAV_ITEMS.forEach((item) => {
    if (item.section) {
      item.roles.forEach((r) => roles.add(r));
    }
  });
  return Array.from(roles);
}

// Groups a role's full (unfiltered) item list by module, for the Super Admin
// settings UI — always shows every module/item regardless of current hide state.
export function groupNavItemsByModule(items: NavItem[]): NavModuleGroup[] {
  const groups: NavModuleGroup[] = [];
  items.forEach((item, i) => {
    const moduleName = computeItemModule(items, i);
    const group = groups.find((g) => g.name === moduleName);
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ name: moduleName, items: [item] });
    }
  });
  return groups;
}

// Hides an item if its href is individually hidden, or if its computed module
// is entirely hidden. Re-derives `section` headers on the surviving items so a
// module whose header item was hidden individually still shows a header on
// its first remaining item.
export function filterVisibleNavItems(
  items: NavItem[],
  hiddenModules: string[] = [],
  hiddenItems: string[] = [],
  // The caller's real, un-normalized role (FMSUser.realRole) - see
  // NavItem.hideForRealRoles. Independent of hiddenModules/hiddenItems (a
  // per-college Super Admin setting): this check is hardcoded, not
  // configurable, and applies regardless of it.
  realRole?: UserRole
): NavItem[] {
  const roleFiltered = items.filter((item) => {
    if (realRole && item.hideForRealRoles?.includes(realRole)) return false;
    if (item.showOnlyForRealRoles && !(realRole && item.showOnlyForRealRoles.includes(realRole))) return false;
    return true;
  });

  if (hiddenModules.length === 0 && hiddenItems.length === 0) return roleFiltered;

  const kept: { item: NavItem; module: string }[] = [];
  roleFiltered.forEach((item, i) => {
    if (hiddenItems.includes(item.href)) return;
    const moduleName = computeItemModule(roleFiltered, i);
    if (hiddenModules.includes(moduleName)) return;
    kept.push({ item, module: moduleName });
  });

  let lastModule: string | null = null;
  return kept.map(({ item, module }) => {
    const isNewModule = module !== lastModule;
    lastModule = module;
    return isNewModule && module !== "General"
      ? { ...item, section: module }
      : { ...item, section: undefined };
  });
}

// True if a role's Nav Visibility settings hide the item/module a pathname
// belongs to. Mirrors isNavItemActive's exact-match-then-prefix resolution
// so a hidden parent (e.g. a hidden "Budget" item) also hides its sub-routes.
export function isPathHidden(
  pathname: string,
  role: UserRole,
  hiddenModules: string[],
  hiddenItems: string[]
): boolean {
  const items = getNavItemsForRole(role);
  let idx = items.findIndex((item) => item.href === pathname);
  if (idx === -1) {
    idx = items.findIndex((item) => item.href !== "/" && pathname.startsWith(item.href + "/"));
  }
  if (idx === -1) return false;
  const item = items[idx];
  if (hiddenItems.includes(item.href)) return true;
  return hiddenModules.includes(computeItemModule(items, idx));
}

export const BOTTOM_NAV_ITEMS: Record<UserRole, NavItem[]> = {
  MANAGEMENT: [
    { label: "Dashboard", href: "/management/dashboard", iconName: "LayoutDashboard", roles: ["MANAGEMENT"] },
    { label: "Budget", href: "/management/budget", iconName: "PiggyBank", roles: ["MANAGEMENT"] },
    { label: "Faculty", href: "/management/faculty", iconName: "UsersRound", roles: ["MANAGEMENT"] },
    { label: "Profile", href: "/management/profile", iconName: "UserCircle", roles: ["MANAGEMENT"] },
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
    { label: "Locations", href: "/super-admin/locations", iconName: "MapPin", roles: ["SUPER_ADMIN"] },
    { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
    { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },
    { label: "Profile", href: "/super-admin/profile", iconName: "UserCircle", roles: ["SUPER_ADMIN"] },
  ],
  VICE_PRINCIPAL: [
    { label: "Home", href: "/vice-principal", iconName: "LayoutDashboard", roles: ["VICE_PRINCIPAL"] },
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["VICE_PRINCIPAL"] },
    { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["VICE_PRINCIPAL"] },
    { label: "Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["VICE_PRINCIPAL"] },
    // { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["VICE_PRINCIPAL"] },
    // { label: "Leaves", href: "/principal/leave", iconName: "CalendarClock", roles: ["VICE_PRINCIPAL"] },
  ],
  ADMINISTRATION: [
    { label: "Home", href: "/administration", iconName: "LayoutDashboard", roles: ["ADMINISTRATION"] },
    { label: "Vacancies", href: "/administration/vacancies", iconName: "ClipboardList", roles: ["ADMINISTRATION"] },
    { label: "Interviews", href: "/administration/interviews", iconName: "CalendarCheck", roles: ["ADMINISTRATION"] },
    { label: "Offers", href: "/administration/offers", iconName: "FileText", roles: ["ADMINISTRATION"] },
    { label: "Profile", href: "/administration/profile", iconName: "UserCircle", roles: ["ADMINISTRATION"] },
  ],
  HR_ADMIN: [
    { label: "Home", href: "/hr-admin", iconName: "LayoutDashboard", roles: ["HR_ADMIN"] },
    { label: "Candidates", href: "/hr-admin/candidates", iconName: "Users", roles: ["HR_ADMIN"] },
    { label: "Interviews", href: "/hr-admin/interviews", iconName: "CalendarCheck", roles: ["HR_ADMIN"] },
    { label: "Offers", href: "/hr-admin/offers", iconName: "FileText", roles: ["HR_ADMIN"] },
    { label: "Profile", href: "/hr-admin/profile", iconName: "UserCircle", roles: ["HR_ADMIN"] },
  ],
  ADMIN_OFFICE: [
    { label: "Home", href: "/admin-office", iconName: "LayoutDashboard", roles: ["ADMIN_OFFICE"] },
    { label: "Profile", href: "/admin-office/profile", iconName: "UserCircle", roles: ["ADMIN_OFFICE"] },
  ],
  PLACEMENT_DEPT: [
    { label: "Home", href: "/placement-dept", iconName: "LayoutDashboard", roles: ["PLACEMENT_DEPT"] },
    { label: "Profile", href: "/placement-dept/profile", iconName: "UserCircle", roles: ["PLACEMENT_DEPT"] },
  ],
  LIBRARY: [
    { label: "Home", href: "/library", iconName: "LayoutDashboard", roles: ["LIBRARY"] },
    { label: "Attendance", href: "/library/attendance", iconName: "ClipboardCheck", roles: ["LIBRARY"] },
    { label: "Staff", href: "/library/staff-attendance", iconName: "ClipboardCheck", roles: ["LIBRARY"] },
    { label: "Profile", href: "/library/profile", iconName: "UserCircle", roles: ["LIBRARY"] },
  ],
  COLLEGE_ACCOUNTS: [
    { label: "Home", href: "/college-accounts", iconName: "LayoutDashboard", roles: ["COLLEGE_ACCOUNTS"] },
    { label: "Hiring", href: "/college-accounts/hiring", iconName: "FolderOpen", roles: ["COLLEGE_ACCOUNTS"] },
    { label: "Candidates", href: "/college-accounts/candidates", iconName: "UserCog", roles: ["COLLEGE_ACCOUNTS"] },
    { label: "Profile", href: "/college-accounts/profile", iconName: "UserCircle", roles: ["COLLEGE_ACCOUNTS"] },
  ],
  EXAM_CELL: [
    { label: "Home", href: "/exam-cell", iconName: "LayoutDashboard", roles: ["EXAM_CELL"] },
    { label: "Configure", href: "/exam-cell/configure", iconName: "ClipboardList", roles: ["EXAM_CELL"] },
    { label: "Attendance", href: "/exam-cell/attendance", iconName: "ClipboardCheck", roles: ["EXAM_CELL"] },
    { label: "Staff", href: "/exam-cell/staff-attendance", iconName: "ClipboardCheck", roles: ["EXAM_CELL"] },
    { label: "Profile", href: "/exam-cell/profile", iconName: "UserCircle", roles: ["EXAM_CELL"] },
  ],
  LOCATION_DEPT_HEAD: [
    { label: "Home", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Vacancies", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Profile", href: "/location-dept-head/profile", iconName: "UserCircle", roles: ["LOCATION_DEPT_HEAD"] },
  ],
  PRINCIPAL: [
    { label: "Home", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
    // Deciding a hiring request is Principal/VP authority, not College
    // Admin's - same exclusion as the sidebar's "Hiring Requests" item above.
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL"], hideForRealRoles: ["COLLEGE_ADMIN"] },
    { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["PRINCIPAL"] },
    { label: "Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["PRINCIPAL"] },
    // { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL"] },
    // { label: "Leaves", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL"] },
    // { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL"] },
  ],
  // Dead at runtime - session/client role is normalized to PRINCIPAL for
  // College Admin (see src/app/api/auth/session/route.ts, src/hooks/useAuth.ts),
  // so getNavItemsForRole/BOTTOM_NAV_ITEMS lookups always resolve via the
  // PRINCIPAL key above. Kept only to satisfy Record<UserRole, ...>.
  COLLEGE_ADMIN: [
    { label: "Home", href: "/principal", iconName: "LayoutDashboard", roles: ["COLLEGE_ADMIN"] },
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["COLLEGE_ADMIN"] },
    { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["COLLEGE_ADMIN"] },
    { label: "Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["COLLEGE_ADMIN"] },
  ],
  // Same reasoning as COLLEGE_ADMIN just above - Director's session role is
  // also normalized to PRINCIPAL, so this is dead at runtime too. Kept only
  // to satisfy Record<UserRole, ...>.
  DIRECTOR: [
    { label: "Home", href: "/principal", iconName: "LayoutDashboard", roles: ["DIRECTOR"] },
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["DIRECTOR"] },
    { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["DIRECTOR"] },
    { label: "Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["DIRECTOR"] },
  ],
  HOD: [
    { label: "Home", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
    { label: "Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"] },
    { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"] },
    { label: "Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"] },
    // { label: "Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"] },
    // { label: "Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
  ],
  // A Department Office login's session role is normalized to "HOD" (see
  // api/auth/session), so it never actually reads this entry - it gets the HOD
  // one above. Present because the map is Record<UserRole, …> and every role
  // needs a key; kept identical so it can't drift into a different answer if
  // some future caller reads it by the un-normalized role.
  DEPARTMENT_OFFICE: [
    { label: "Home", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
    { label: "Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"] },
    { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"] },
    { label: "Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"] },
  ],
  COLLEGE_OFFICE: [
    { label: "Home", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
    { label: "Students", href: "/college-office/students", iconName: "GraduationCap", roles: ["COLLEGE_OFFICE"] },
    { label: "Import Students", href: "/college-office/students/import", iconName: "Upload", roles: ["COLLEGE_OFFICE"] },
    { label: "Non-Technical Staff", href: "/college-office/non-technical-staff", iconName: "UsersRound", roles: ["COLLEGE_OFFICE"] },
    { label: "Faculty", href: "/college-office/faculty", iconName: "Wallet", roles: ["COLLEGE_OFFICE"] },
    { label: "HOD / Principal", href: "/college-office/staff", iconName: "Wallet", roles: ["COLLEGE_OFFICE"] },
    { label: "Hiring Pipeline", href: "/college-office/pipeline", iconName: "GitBranch", roles: ["COLLEGE_OFFICE"] },
    { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },
    { label: "Attendance", href: "/college-office/attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_OFFICE"] },
    { label: "Staff Attendance", href: "/college-office/staff-attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_OFFICE"] },
    { label: "Profile", href: "/college-office/profile", iconName: "UserCircle", roles: ["COLLEGE_OFFICE"] },
  ],
  COLLEGE_STAFF: [
    { label: "Home", href: "/college-staff", iconName: "LayoutDashboard", roles: ["COLLEGE_STAFF"] },
    { label: "Attendance", href: "/college-staff/attendance", iconName: "ClipboardCheck", roles: ["COLLEGE_STAFF"] },
    { label: "Profile", href: "/college-staff/profile", iconName: "UserCircle", roles: ["COLLEGE_STAFF"] },
  ],
  ACADEMICS: [
    { label: "Home", href: "/academics", iconName: "LayoutDashboard", roles: ["ACADEMICS"] },
    { label: "Subjects", href: "/academics/subjects", iconName: "Library", roles: ["ACADEMICS"] },
    { label: "Profile", href: "/academics/profile", iconName: "UserCircle", roles: ["ACADEMICS"] },
  ],
  IQAC_COORDINATOR: [
    { label: "Home", href: "/iqac-coordinator", iconName: "LayoutDashboard", roles: ["IQAC_COORDINATOR"] },
    { label: "Profile", href: "/iqac-coordinator/profile", iconName: "UserCircle", roles: ["IQAC_COORDINATOR"] },
  ],
  T_AND_P: [
    { label: "Home", href: "/t-and-p", iconName: "LayoutDashboard", roles: ["T_AND_P"] },
    { label: "Attendance", href: "/t-and-p/attendance", iconName: "ClipboardCheck", roles: ["T_AND_P"] },
    { label: "Staff", href: "/t-and-p/staff-attendance", iconName: "ClipboardCheck", roles: ["T_AND_P"] },
    { label: "Profile", href: "/t-and-p/profile", iconName: "UserCircle", roles: ["T_AND_P"] },
  ],
  R_AND_D: [
    { label: "Home", href: "/r-and-d", iconName: "LayoutDashboard", roles: ["R_AND_D"] },
    { label: "Publications", href: "/r-and-d/publications", iconName: "FlaskConical", roles: ["R_AND_D"] },
    { label: "Research Profiles", href: "/r-and-d/research-profiles", iconName: "IdCard", roles: ["R_AND_D"] },
    { label: "Citation Metrics", href: "/r-and-d/citation-metrics", iconName: "TrendingUp", roles: ["R_AND_D"] },
    { label: "Consultancy Projects", href: "/r-and-d/consultancy-projects", iconName: "HandCoins", roles: ["R_AND_D"] },
    { label: "Seed Funding", href: "/r-and-d/seed-funding", iconName: "PiggyBank", roles: ["R_AND_D"] },
    { label: "Sponsored Projects", href: "/r-and-d/sponsored-projects", iconName: "Landmark", roles: ["R_AND_D"] },
    { label: "Discovery & Innovation", href: "/r-and-d/discovery-innovation", iconName: "Lightbulb", roles: ["R_AND_D"] },
    { label: "Ph.D. Supervision", href: "/r-and-d/phd-supervision", iconName: "GraduationCap", roles: ["R_AND_D"] },
    { label: "Research Services", href: "/r-and-d/research-services", iconName: "Presentation", roles: ["R_AND_D"] },
    { label: "Hackathons", href: "/r-and-d/hackathons", iconName: "Trophy", roles: ["R_AND_D"] },
    { label: "Innovations", href: "/r-and-d/innovations", iconName: "Sparkles", roles: ["R_AND_D"] },
    { label: "Profile", href: "/r-and-d/profile", iconName: "UserCircle", roles: ["R_AND_D"] },
  ],
  RND_COORDINATOR: [
    { label: "Home", href: "/rnd-coordinator", iconName: "LayoutDashboard", roles: ["RND_COORDINATOR"] },
  ],
  PANEL_MEMBER: [
    { label: "Home", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
    { label: "Teaching", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"] },
    { label: "Students", href: "/panel/students", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
    { label: "Profile", href: "/panel/profile", iconName: "UserCircle", roles: ["PANEL_MEMBER"] },
    // { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"] },
    // { label: "Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
    // { label: "Payslips", href: "/panel/payslips", iconName: "Wallet", roles: ["PANEL_MEMBER"] },
    // My Interviews injected dynamically when assigned — see Sidebar.tsx
  ],
  ACCOUNTS: [
    { label: "Home", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
    { label: "Hiring", href: "/accounts/hiring", iconName: "UserCheck", roles: ["ACCOUNTS"] },
    { label: "Pipeline", href: "/accounts/pipeline", iconName: "GitBranch", roles: ["ACCOUNTS"] },
    { label: "Salary", href: "/accounts/salary-structures", iconName: "Landmark", roles: ["ACCOUNTS"] },
    { label: "Profile", href: "/accounts/profile", iconName: "UserCircle", roles: ["ACCOUNTS"] },
  ],
  FINANCE: [
    { label: "Home", href: "/finance", iconName: "LayoutDashboard", roles: ["FINANCE"] },
    { label: "Approvals", href: "/finance/budget-approvals", iconName: "ClipboardCheck", roles: ["FINANCE"] },
    { label: "Payments", href: "/finance/payments", iconName: "IndianRupee", roles: ["FINANCE"] },
    { label: "Reports", href: "/finance/reports", iconName: "BarChart3", roles: ["FINANCE"] },
    { label: "Profile", href: "/finance/profile", iconName: "UserCircle", roles: ["FINANCE"] },
  ],
  PURCHASE_DEPT: [
    { label: "Home", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
    { label: "Pending", href: "/purchase/pending", iconName: "Clock", roles: ["PURCHASE_DEPT"] },
    { label: "Browse", href: "/purchase/browse", iconName: "MapPin", roles: ["PURCHASE_DEPT"] },
    { label: "Indents", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
    { label: "Profile", href: "/purchase/profile", iconName: "UserCircle", roles: ["PURCHASE_DEPT"] },
  ],
  WEBMASTER: [
    { label: "Home", href: "/webmaster", iconName: "LayoutDashboard", roles: ["WEBMASTER"] },
    { label: "Credentials", href: "/webmaster/credential-requests", iconName: "KeyRound", roles: ["WEBMASTER"] },
    { label: "Accounts", href: "/webmaster/users", iconName: "Users", roles: ["WEBMASTER"] },
    { label: "Profile", href: "/webmaster/profile", iconName: "UserCircle", roles: ["WEBMASTER"] },
  ],
  STUDENT: [],
  CLASS_LEADER: [
    { label: "Home", href: "/class-leader", iconName: "LayoutDashboard", roles: ["CLASS_LEADER"] },
    { label: "Timetable", href: "/class-leader/timetable", iconName: "CalendarDays", roles: ["CLASS_LEADER"] },
  ],
};
