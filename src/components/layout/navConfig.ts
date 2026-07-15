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

export const NAV_ITEMS: NavItem[] = [
  // Management (read-only)
  { label: "Dashboard", href: "/management/dashboard", iconName: "LayoutDashboard", roles: ["MANAGEMENT"] },
  { label: "Budget", href: "/management/budget", iconName: "PiggyBank", roles: ["MANAGEMENT"] },
  { label: "Faculty Details", href: "/management/faculty", iconName: "UsersRound", roles: ["MANAGEMENT"] },

  // Super Admin
  { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
  { label: "Locations", href: "/super-admin/locations", iconName: "MapPin", roles: ["SUPER_ADMIN"] },
  { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
  { label: "All Users", href: "/super-admin/users", iconName: "Users", roles: ["SUPER_ADMIN"] },
  { label: "Audit Logs", href: "/super-admin/audit-logs", iconName: "ScrollText", roles: ["SUPER_ADMIN"] },
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

  // Location Dept Head
  { label: "Dashboard", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "Hiring Requests", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"], section: "Hiring" },
  { label: "My Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
  { label: "My Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },

  // Vice Principal
  { label: "Dashboard", href: "/vice-principal", iconName: "LayoutDashboard", roles: ["VICE_PRINCIPAL"] },
  { label: "General Admin Vacancies", href: "/vice-principal/vacancies", iconName: "ClipboardPlus", roles: ["VICE_PRINCIPAL"], section: "Hiring" },
  { label: "Budget", href: "/principal/budget", iconName: "PiggyBank", roles: ["VICE_PRINCIPAL"] },
  { label: "Budget Report", href: "/principal/budget/report", iconName: "FileText", roles: ["VICE_PRINCIPAL"] },

  // Principal
  { label: "Dashboard", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
  { label: "Hiring Requests", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL"], section: "Institution" },
  { label: "Departments", href: "/principal/departments", iconName: "BookOpen", roles: ["PRINCIPAL"] },
  { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL"] },
  { label: "Interview Plans", href: "/principal/interviews", iconName: "CalendarCheck", roles: ["PRINCIPAL"] },
  { label: "Hiring Decisions", href: "/principal/decisions", iconName: "UserCheck", roles: ["PRINCIPAL"] },
  { label: "Leave Approvals", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL"], section: "Administration" },
  { label: "Attendance Report", href: "/principal/attendance", iconName: "ClipboardCheck", roles: ["PRINCIPAL"] },
  { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL"] },
  { label: "Budget", href: "/principal/budget", iconName: "PiggyBank", roles: ["PRINCIPAL"] },
  { label: "Budget Report", href: "/principal/budget/report", iconName: "FileText", roles: ["PRINCIPAL"] },
  { label: "Training Approvals", href: "/principal/training", iconName: "GraduationCap", roles: ["PRINCIPAL"] },
  { label: "Grievance Desk", href: "/principal/grievance", iconName: "AlertCircle", roles: ["PRINCIPAL"] },
  { label: "Documents", href: "/principal/documents", iconName: "FolderOpen", roles: ["PRINCIPAL"] },
  { label: "Reports", href: "/principal/reports", iconName: "BarChart2", roles: ["PRINCIPAL"] },
  { label: "My Profile", href: "/principal/profile", iconName: "UserCircle", roles: ["PRINCIPAL"] },

  // HOD
  { label: "Dashboard", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
  { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"], section: "Department" },
  { label: "Sections", href: "/hod/sections", iconName: "BookMarked", roles: ["HOD"] },
  { label: "Subjects", href: "/hod/subjects", iconName: "Library", roles: ["HOD"] },
  { label: "Timetable", href: "/hod/timetable", iconName: "CalendarDays", roles: ["HOD"] },
  { label: "Leave Approvals", href: "/hod/leave-approvals", iconName: "CalendarClock", roles: ["HOD"] },
  { label: "Leave Profiles", href: "/hod/leave/profiles", iconName: "ClipboardList", roles: ["HOD"] },
  { label: "My Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"], section: "My Work" },
  { label: "My Attendance", href: "/hod/attendance", iconName: "ClipboardCheck", roles: ["HOD"] },
  { label: "Teaching Load", href: "/hod/teaching", iconName: "BookOpen", roles: ["HOD"] },
  { label: "My Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
  { label: "Budget", href: "/hod/budget", iconName: "PiggyBank", roles: ["HOD"] },
  { label: "Indents", href: "/hod/indents", iconName: "ShoppingCart", roles: ["HOD"] },
  { label: "Purchase Clearance", href: "/hod/purchase-clearance", iconName: "Receipt", roles: ["HOD"] },
  { label: "My Appraisal", href: "/hod/appraisal", iconName: "TrendingUp", roles: ["HOD"] },
  { label: "Training", href: "/hod/training", iconName: "GraduationCap", roles: ["HOD"] },
  { label: "Grievance", href: "/hod/grievance", iconName: "AlertCircle", roles: ["HOD"] },
  { label: "My Documents", href: "/hod/documents", iconName: "FolderOpen", roles: ["HOD"] },
  { label: "Hiring Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"], section: "Hiring" },
  { label: "Candidates", href: "/hod/candidates", iconName: "Users", roles: ["HOD"] },
  { label: "My Profile", href: "/hod/profile", iconName: "UserCircle", roles: ["HOD"], section: "My Work" },

  // College Office
  { label: "Dashboard", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
  { label: "Documents", href: "/college-office/documents", iconName: "FolderOpen", roles: ["COLLEGE_OFFICE"] },
  { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },

  // Faculty (PANEL_MEMBER) — My Interviews is injected dynamically in Sidebar when assigned
  { label: "Dashboard", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
  { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"] },
  { label: "Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
  { label: "Teaching Load", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"] },
  { label: "Payslips", href: "/panel/payslips", iconName: "Wallet", roles: ["PANEL_MEMBER"] },
  { label: "My Feedback", href: "/panel/feedback", iconName: "MessageSquare", roles: ["PANEL_MEMBER"] },
  { label: "Appraisal", href: "/panel/appraisal", iconName: "TrendingUp", roles: ["PANEL_MEMBER"] },
  { label: "Training", href: "/panel/training", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
  { label: "Grievance", href: "/panel/grievance", iconName: "AlertCircle", roles: ["PANEL_MEMBER"] },
  { label: "My Documents", href: "/panel/documents", iconName: "FolderOpen", roles: ["PANEL_MEMBER"] },
  { label: "My Profile", href: "/panel/profile", iconName: "UserCircle", roles: ["PANEL_MEMBER"] },

  // Accounts
  { label: "Dashboard", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
  { label: "Salary Records", href: "/accounts/salary", iconName: "IndianRupee", roles: ["ACCOUNTS"] },
  { label: "Offer Letters", href: "/accounts/offers", iconName: "FileText", roles: ["ACCOUNTS"] },

  // Finance
  { label: "Dashboard", href: "/finance", iconName: "LayoutDashboard", roles: ["FINANCE"] },
  { label: "Budget Management", href: "/finance/budget", iconName: "Wallet", roles: ["FINANCE"], section: "Budgets" },
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

  // Purchase Department
  { label: "Dashboard", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
  { label: "Indent Requests", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
  { label: "Purchase Requests", href: "/purchase/requests", iconName: "ShoppingCart", roles: ["PURCHASE_DEPT"] },
];

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
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
    { label: "Vacancies", href: "/vice-principal/vacancies", iconName: "ClipboardPlus", roles: ["VICE_PRINCIPAL"] },
    { label: "Budget", href: "/principal/budget", iconName: "PiggyBank", roles: ["VICE_PRINCIPAL"] },
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
  LOCATION_DEPT_HEAD: [
    { label: "Home", href: "/location-dept-head", iconName: "LayoutDashboard", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Vacancies", href: "/location-dept-head/vacancies", iconName: "ClipboardPlus", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Candidates", href: "/location-dept-head/candidates", iconName: "Users", roles: ["LOCATION_DEPT_HEAD"] },
    { label: "Interviews", href: "/location-dept-head/interviews", iconName: "CalendarCheck", roles: ["LOCATION_DEPT_HEAD"] },
  ],
  PRINCIPAL: [
    { label: "Home", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
    { label: "Vacancies", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL"] },
    { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL"] },
    { label: "Leaves", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL"] },
    { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL"] },
  ],
  HOD: [
    { label: "Home", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
    { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"] },
    { label: "Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"] },
    { label: "Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
    { label: "Pipeline", href: "/hod/pipeline", iconName: "GitBranch", roles: ["HOD"] },
  ],
  COLLEGE_OFFICE: [
    { label: "Home", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
    { label: "Documents", href: "/college-office/documents", iconName: "FolderOpen", roles: ["COLLEGE_OFFICE"] },
    { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },
  ],
  PANEL_MEMBER: [
    { label: "Home", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
    { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"] },
    { label: "Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
    { label: "Teaching", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"] },
    { label: "Payslips", href: "/panel/payslips", iconName: "Wallet", roles: ["PANEL_MEMBER"] },
    // My Interviews injected dynamically when assigned — see Sidebar.tsx
  ],
  ACCOUNTS: [
    { label: "Home", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
    { label: "Salary", href: "/accounts/salary", iconName: "IndianRupee", roles: ["ACCOUNTS"] },
    { label: "Offers", href: "/accounts/offers", iconName: "FileText", roles: ["ACCOUNTS"] },
  ],
  FINANCE: [
    { label: "Home", href: "/finance", iconName: "LayoutDashboard", roles: ["FINANCE"] },
    { label: "Approvals", href: "/finance/budget-approvals", iconName: "ClipboardCheck", roles: ["FINANCE"] },
    { label: "Payments", href: "/finance/payments", iconName: "IndianRupee", roles: ["FINANCE"] },
    { label: "Reports", href: "/finance/reports", iconName: "BarChart3", roles: ["FINANCE"] },
  ],
  PURCHASE_DEPT: [
    { label: "Home", href: "/purchase", iconName: "LayoutDashboard", roles: ["PURCHASE_DEPT"] },
    { label: "Indents", href: "/purchase/indents", iconName: "ClipboardList", roles: ["PURCHASE_DEPT"] },
    { label: "Requests", href: "/purchase/requests", iconName: "ShoppingCart", roles: ["PURCHASE_DEPT"] },
  ],
  STUDENT: [],
};
