import type { UserRole } from "@/types";

// ─── Location-level nav ────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  roles: UserRole[];
  badge?: string;
  section?: string; // optional section header rendered above this item
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

export const NAV_ITEMS: NavItem[] = [
  // Management
  { label: "Dashboard", href: "/management/dashboard", iconName: "LayoutDashboard", roles: ["MANAGEMENT"] },
  { label: "Locations", href: "/management/locations", iconName: "MapPin", roles: ["MANAGEMENT"], section: "Organization" },
  { label: "Add Administrator", href: "/management/users/new", iconName: "UserPlus", roles: ["MANAGEMENT"] },
  { label: "Faculty Details", href: "/management/faculty", iconName: "UsersRound", roles: ["MANAGEMENT"] },
  { label: "Budget", href: "/management/budget", iconName: "PiggyBank", roles: ["MANAGEMENT"], section: "Reports" },
  { label: "Budget History", href: "/management/indents", iconName: "ClipboardList", roles: ["MANAGEMENT"] },

  // Super Admin
  { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
  { label: "Locations", href: "/super-admin/locations", iconName: "MapPin", roles: ["SUPER_ADMIN"], section: "Organization" },
  { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
  { label: "All Users", href: "/super-admin/users", iconName: "Users", roles: ["SUPER_ADMIN"], section: "Users" },
  { label: "Add User", href: "/super-admin/users/new", iconName: "UserPlus", roles: ["SUPER_ADMIN"] },
  { label: "Audit Logs", href: "/super-admin/audit-logs", iconName: "ScrollText", roles: ["SUPER_ADMIN"], section: "System" },
  { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },

  // Administration
  { label: "Dashboard", href: "/administration", iconName: "LayoutDashboard", roles: ["ADMINISTRATION"] },
  { label: "Location Staff", href: "/administration/users", iconName: "Users", roles: ["ADMINISTRATION"], section: "Management" },
  { label: "Departments", href: "/administration/departments", iconName: "Settings2", roles: ["ADMINISTRATION"] },
  { label: "Colleges", href: "/administration/colleges", iconName: "Building2", roles: ["ADMINISTRATION"] },
  { label: "Hiring Requests", href: "/administration/vacancies", iconName: "ClipboardList", roles: ["ADMINISTRATION"], section: "Hiring" },
  { label: "Interview Plans", href: "/administration/interviews", iconName: "CalendarCheck", roles: ["ADMINISTRATION"] },
  { label: "Offer Letters", href: "/administration/offers", iconName: "FileText", roles: ["ADMINISTRATION"] },

  // HR Admin
  { label: "Dashboard", href: "/hr-admin", iconName: "LayoutDashboard", roles: ["HR_ADMIN"] },
  { label: "Hiring Requests", href: "/hr-admin/vacancies", iconName: "ClipboardPlus", roles: ["HR_ADMIN"], section: "Hiring" },
  { label: "Candidates", href: "/hr-admin/candidates", iconName: "Users", roles: ["HR_ADMIN"] },
  { label: "Interviews", href: "/hr-admin/interviews", iconName: "CalendarCheck", roles: ["HR_ADMIN"] },
  { label: "Offer Letters", href: "/hr-admin/offers", iconName: "FileText", roles: ["HR_ADMIN"] },

  // Admin Office
  { label: "Dashboard", href: "/admin-office", iconName: "LayoutDashboard", roles: ["ADMIN_OFFICE"] },

  // Office
  { label: "Dashboard", href: "/office", iconName: "LayoutDashboard", roles: ["OFFICE"] },

  // Placement Department
  { label: "Dashboard", href: "/placement-dept", iconName: "LayoutDashboard", roles: ["PLACEMENT_DEPT"] },

  // Library
  { label: "Dashboard", href: "/library", iconName: "LayoutDashboard", roles: ["LIBRARY"] },

  // Exam Cell
  { label: "Dashboard", href: "/exam-cell", iconName: "LayoutDashboard", roles: ["EXAM_CELL"] },

  // Location Dept Head
  { label: "Dashboard", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "Hiring Requests", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"], section: "Hiring" },
  { label: "My Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "My Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },

  // Vice Principal — own dashboard + General Admin Vacancies; everything else
  // is shared with Principal below (VICE_PRINCIPAL added to those roles arrays)
  // since the two roles carry equal authority per AGENTS.md.
  { label: "Dashboard", href: "/vice-principal", iconName: "LayoutDashboard", roles: ["VICE_PRINCIPAL"] },
  { label: "General Admin Vacancies", href: "/vice-principal/vacancies", iconName: "ClipboardPlus", roles: ["VICE_PRINCIPAL"], section: "Hiring" },

  // Principal (shared with Vice Principal — see note above)
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  // Grouped by functional domain (see PRINCIPAL_DASHBOARD.md), not by data location.
  { label: "Dashboard", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
  { label: "Hiring Requests", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Hiring Pipeline" },
  { label: "Interview Plans", href: "/principal/interviews", iconName: "CalendarCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Panel Scoring", href: "/panel/interviews", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Hiring Decisions", href: "/principal/decisions", iconName: "UserCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Departments", href: "/principal/departments", iconName: "BookOpen", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Academic Management" },
  { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Supporting Staff", href: "/principal/supporting-staff", iconName: "UserCog", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Student Promotion", href: "/principal/promotions", iconName: "GraduationCap", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Staff & HR Management" },
  { label: "College Members", href: "/principal/college-members", iconName: "UsersRound", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Leave Approvals", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Attendance Report", href: "/principal/attendance", iconName: "ClipboardCheck", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Training Approvals", href: "/principal/training", iconName: "GraduationCap", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Grievance Desk", href: "/principal/grievance", iconName: "AlertCircle", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Payroll & Budget" },
  { label: "Budget", href: "/principal/budget", iconName: "PiggyBank", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Budget Report", href: "/principal/budget/report", iconName: "FileText", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Purchase Clearance", href: "/principal/purchase-clearance", iconName: "Receipt", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Budget History", href: "/principal/indents", iconName: "ClipboardList", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "Documents", href: "/principal/documents", iconName: "FolderOpen", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Documents & Reporting" },
  { label: "Reports", href: "/principal/reports", iconName: "BarChart2", roles: ["PRINCIPAL", "VICE_PRINCIPAL"] },
  { label: "My Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["PRINCIPAL", "VICE_PRINCIPAL"], section: "Personal" },

  // HOD
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  { label: "Dashboard", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
  { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"], section: "Department" },
  { label: "Supporting Staff", href: "/hod/supporting-staff", iconName: "UserCog", roles: ["HOD"] },
  { label: "Sections", href: "/hod/sections", iconName: "BookMarked", roles: ["HOD"] },
  { label: "Incoming Students", href: "/hod/students/incoming", iconName: "UserPlus", roles: ["HOD"] },
  { label: "Sub-Departments", href: "/hod/settings/sub-departments", iconName: "Settings2", roles: ["HOD"] },
  { label: "Subjects", href: "/hod/subjects", iconName: "Library", roles: ["HOD"] },
  { label: "Timetable", href: "/hod/timetable", iconName: "CalendarDays", roles: ["HOD"] },
  { label: "Teaching Assignments", href: "/hod/teaching-assignments", iconName: "BookOpen", roles: ["HOD"] },
  { label: "Internal Marks", href: "/hod/internal-marks", iconName: "ClipboardList", roles: ["HOD"] },
  { label: "Leave Approvals", href: "/hod/leave-approvals", iconName: "CalendarClock", roles: ["HOD"], section: "Approvals" },
  { label: "Leave Profiles", href: "/hod/leave/profiles", iconName: "ClipboardList", roles: ["HOD"] },
  { label: "Budget", href: "/hod/budget", iconName: "PiggyBank", roles: ["HOD"], section: "Budget & Purchase" },
  { label: "Indents", href: "/hod/indents", iconName: "ShoppingCart", roles: ["HOD"] },
  { label: "Purchase Clearance", href: "/hod/purchase-clearance", iconName: "Receipt", roles: ["HOD"] },
  { label: "Hiring Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"], section: "Hiring" },
  { label: "Candidates", href: "/hod/candidates", iconName: "Users", roles: ["HOD"] },
  { label: "Panel Scoring", href: "/panel/interviews", iconName: "ClipboardCheck", roles: ["HOD"] },
  { label: "Past Hirings", href: "/hod/past-hirings", iconName: "History", roles: ["HOD"] },
  { label: "My Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"], section: "My Work" },
  { label: "My Attendance", href: "/hod/attendance", iconName: "ClipboardCheck", roles: ["HOD"] },
  { label: "Teaching Load", href: "/hod/teaching", iconName: "BookOpen", roles: ["HOD"] },
  { label: "My Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
  { label: "My Appraisal", href: "/hod/appraisal", iconName: "TrendingUp", roles: ["HOD"] },
  { label: "Training", href: "/hod/training", iconName: "GraduationCap", roles: ["HOD"] },
  { label: "Grievance", href: "/hod/grievance", iconName: "AlertCircle", roles: ["HOD"] },
  { label: "My Documents", href: "/hod/documents", iconName: "FolderOpen", roles: ["HOD"] },
  { label: "My Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"], section: "Personal" },

  // College Office
  { label: "Dashboard", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
  { label: "Sections", href: "/college-office/sections", iconName: "BookMarked", roles: ["COLLEGE_OFFICE"], section: "Students" },
  { label: "Documents", href: "/college-office/documents", iconName: "FolderOpen", roles: ["COLLEGE_OFFICE"], section: "Hiring" },
  { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },

  // College Staff (dynamic-title roles: Dean, IQAC Coordinator, T&P, etc.)
  { label: "Dashboard", href: "/college-staff", iconName: "LayoutDashboard", roles: ["COLLEGE_STAFF"] },

  // Faculty (PANEL_MEMBER) — My Interviews is injected dynamically in Sidebar when assigned
  // Full module set — Super Admin controls which modules/items are actually
  // visible per college via the Nav Visibility settings (filterVisibleNavItems).
  { label: "Dashboard", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
  { label: "Teaching Load", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"], section: "My Work" },
  { label: "Students", href: "/panel/students", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
  { label: "Internal Marks", href: "/panel/internal-marks", iconName: "ClipboardList", roles: ["PANEL_MEMBER"] },
  { label: "My Feedback", href: "/panel/feedback", iconName: "MessageSquare", roles: ["PANEL_MEMBER"] },
  { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"], section: "Leave & Attendance" },
  { label: "Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
  { label: "Payslips", href: "/panel/payslips", iconName: "Wallet", roles: ["PANEL_MEMBER"], section: "Personal" },
  { label: "Appraisal", href: "/panel/appraisal", iconName: "TrendingUp", roles: ["PANEL_MEMBER"] },
  { label: "Training", href: "/panel/training", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
  { label: "Grievance", href: "/panel/grievance", iconName: "AlertCircle", roles: ["PANEL_MEMBER"] },
  { label: "My Documents", href: "/panel/documents", iconName: "FolderOpen", roles: ["PANEL_MEMBER"] },
  { label: "My Profile", href: "/panel/profile", iconName: "UserCircle", roles: ["PANEL_MEMBER"] },

  // Accounts
  { label: "Dashboard", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
  { label: "Hiring — Offer Letters", href: "/accounts/hiring", iconName: "UserCheck", roles: ["ACCOUNTS"], section: "Hiring" },
  { label: "Salary Structures", href: "/accounts/salary-structures", iconName: "Landmark", roles: ["ACCOUNTS"], section: "Payroll" },

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

  // Purchase Department
  { label: "Dashboard", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
  { label: "Pending Requests", href: "/purchase/pending", iconName: "Clock", roles: ["PURCHASE_DEPT"], section: "Requests" },
  { label: "Latest Requests", href: "/purchase/latest", iconName: "History", roles: ["PURCHASE_DEPT"] },
  { label: "All Requests", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
  { label: "By Category", href: "/purchase/by-category", iconName: "Tags", roles: ["PURCHASE_DEPT"] },
  { label: "By Goods / Non-Goods", href: "/purchase/by-type", iconName: "PackageCheck", roles: ["PURCHASE_DEPT"] },
  { label: "Browse by Location", href: "/purchase/browse", iconName: "MapPin", roles: ["PURCHASE_DEPT"], section: "Organization" },
];

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
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
  hiddenItems: string[] = []
): NavItem[] {
  if (hiddenModules.length === 0 && hiddenItems.length === 0) return items;

  const kept: { item: NavItem; module: string }[] = [];
  items.forEach((item, i) => {
    if (hiddenItems.includes(item.href)) return;
    const moduleName = computeItemModule(items, i);
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
  ],
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
    { label: "Locations", href: "/super-admin/locations", iconName: "MapPin", roles: ["SUPER_ADMIN"] },
    { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
    { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },
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
  ],
  HR_ADMIN: [
    { label: "Home", href: "/hr-admin", iconName: "LayoutDashboard", roles: ["HR_ADMIN"] },
    { label: "Candidates", href: "/hr-admin/candidates", iconName: "Users", roles: ["HR_ADMIN"] },
    { label: "Interviews", href: "/hr-admin/interviews", iconName: "CalendarCheck", roles: ["HR_ADMIN"] },
    { label: "Offers", href: "/hr-admin/offers", iconName: "FileText", roles: ["HR_ADMIN"] },
  ],
  ADMIN_OFFICE: [
    { label: "Home", href: "/admin-office", iconName: "LayoutDashboard", roles: ["ADMIN_OFFICE"] },
  ],
  OFFICE: [
    { label: "Home", href: "/office", iconName: "LayoutDashboard", roles: ["OFFICE"] },
  ],
  PLACEMENT_DEPT: [
    { label: "Home", href: "/placement-dept", iconName: "LayoutDashboard", roles: ["PLACEMENT_DEPT"] },
  ],
  LIBRARY: [
    { label: "Home", href: "/library", iconName: "LayoutDashboard", roles: ["LIBRARY"] },
  ],
  EXAM_CELL: [
    { label: "Home", href: "/exam-cell", iconName: "LayoutDashboard", roles: ["EXAM_CELL"] },
  ],
  LOCATION_DEPT_HEAD: [
    { label: "Home", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Vacancies", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },
  ],
  PRINCIPAL: [
    { label: "Home", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL"] },
    { label: "Faculty", href: "/principal/faculty", iconName: "UsersRound", roles: ["PRINCIPAL"] },
    { label: "Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["PRINCIPAL"] },
    // { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL"] },
    // { label: "Leaves", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL"] },
    // { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL"] },
  ],
  HOD: [
    { label: "Home", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
    { label: "Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"] },
    { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"] },
    { label: "Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"] },
    // { label: "Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"] },
    // { label: "Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
  ],
  COLLEGE_OFFICE: [
    { label: "Home", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
    { label: "Sections", href: "/college-office/sections", iconName: "BookMarked", roles: ["COLLEGE_OFFICE"] },
    { label: "Documents", href: "/college-office/documents", iconName: "FolderOpen", roles: ["COLLEGE_OFFICE"] },
    { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },
  ],
  COLLEGE_STAFF: [
    { label: "Home", href: "/college-staff", iconName: "LayoutDashboard", roles: ["COLLEGE_STAFF"] },
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
    { label: "Salary", href: "/accounts/salary-structures", iconName: "Landmark", roles: ["ACCOUNTS"] },
  ],
  FINANCE: [
    { label: "Home", href: "/finance", iconName: "LayoutDashboard", roles: ["FINANCE"] },
    { label: "Approvals", href: "/finance/budget-approvals", iconName: "ClipboardCheck", roles: ["FINANCE"] },
    { label: "Payments", href: "/finance/payments", iconName: "IndianRupee", roles: ["FINANCE"] },
    { label: "Reports", href: "/finance/reports", iconName: "BarChart3", roles: ["FINANCE"] },
  ],
  PURCHASE_DEPT: [
    { label: "Home", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
    { label: "Pending", href: "/purchase/pending", iconName: "Clock", roles: ["PURCHASE_DEPT"] },
    { label: "Browse", href: "/purchase/browse", iconName: "MapPin", roles: ["PURCHASE_DEPT"] },
    { label: "Indents", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
  ],
  STUDENT: [],
};
