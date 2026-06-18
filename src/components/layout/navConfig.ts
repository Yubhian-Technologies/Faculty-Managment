import type { UserRole } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  iconName: string;
  roles: UserRole[];
  badge?: string;
  section?: string; // optional section header rendered above this item
}

export const NAV_ITEMS: NavItem[] = [
  // Super Admin
  { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
  { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
  { label: "All Users", href: "/super-admin/users", iconName: "Users", roles: ["SUPER_ADMIN"] },
  { label: "Audit Logs", href: "/super-admin/audit-logs", iconName: "ScrollText", roles: ["SUPER_ADMIN"] },
  { label: "Gen Admin Vacancies", href: "/super-admin/vacancies", iconName: "ClipboardList", roles: ["SUPER_ADMIN"] },
  { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },

  // Principal
  { label: "Dashboard", href: "/principal", iconName: "LayoutDashboard", roles: ["PRINCIPAL"] },
  { label: "Vacancy Requests", href: "/principal/vacancies", iconName: "ClipboardList", roles: ["PRINCIPAL"], section: "Institution" },
  { label: "Departments", href: "/principal/departments", iconName: "BookOpen", roles: ["PRINCIPAL"] },
  { label: "Staff", href: "/principal/staff", iconName: "UsersRound", roles: ["PRINCIPAL"] },
  { label: "Interview Plans", href: "/principal/interviews", iconName: "CalendarCheck", roles: ["PRINCIPAL"] },
  { label: "Hiring Decisions", href: "/principal/decisions", iconName: "UserCheck", roles: ["PRINCIPAL"] },
  { label: "Leave Approvals", href: "/principal/leave", iconName: "CalendarClock", roles: ["PRINCIPAL"], section: "Administration" },
  { label: "Attendance Report", href: "/principal/attendance", iconName: "ClipboardCheck", roles: ["PRINCIPAL"] },
  { label: "Payroll", href: "/principal/payslips", iconName: "Wallet", roles: ["PRINCIPAL"] },
  { label: "Training Approvals", href: "/principal/training", iconName: "GraduationCap", roles: ["PRINCIPAL"] },
  { label: "Grievance Desk", href: "/principal/grievance", iconName: "AlertCircle", roles: ["PRINCIPAL"] },
  { label: "Documents", href: "/principal/documents", iconName: "FolderOpen", roles: ["PRINCIPAL"] },
  { label: "Reports", href: "/principal/reports", iconName: "BarChart2", roles: ["PRINCIPAL"] },

  // HOD
  { label: "Dashboard", href: "/hod", iconName: "LayoutDashboard", roles: ["HOD"] },
  { label: "Faculty", href: "/hod/faculty", iconName: "UsersRound", roles: ["HOD"], section: "Department" },
  { label: "Leave Approvals", href: "/hod/leave-approvals", iconName: "CalendarClock", roles: ["HOD"] },
  { label: "My Leave", href: "/hod/leave", iconName: "CalendarClock", roles: ["HOD"], section: "My Work" },
  { label: "My Attendance", href: "/hod/attendance", iconName: "ClipboardCheck", roles: ["HOD"] },
  { label: "Teaching Load", href: "/hod/teaching", iconName: "BookOpen", roles: ["HOD"] },
  { label: "My Payslips", href: "/hod/payslips", iconName: "Wallet", roles: ["HOD"] },
  { label: "My Appraisal", href: "/hod/appraisal", iconName: "TrendingUp", roles: ["HOD"] },
  { label: "Training", href: "/hod/training", iconName: "GraduationCap", roles: ["HOD"] },
  { label: "Grievance", href: "/hod/grievance", iconName: "AlertCircle", roles: ["HOD"] },
  { label: "My Documents", href: "/hod/documents", iconName: "FolderOpen", roles: ["HOD"] },
  { label: "Vacancy Request", href: "/hod/vacancy", iconName: "ClipboardPlus", roles: ["HOD"], section: "Hiring" },
  { label: "Candidates", href: "/hod/candidates", iconName: "Users", roles: ["HOD"] },
  { label: "Hiring Batches", href: "/hod/batches", iconName: "Layers", roles: ["HOD"] },
  { label: "Interview Setup", href: "/hod/setup", iconName: "Settings2", roles: ["HOD"] },

  // College Office
  { label: "Dashboard", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
  { label: "Interview Setup", href: "/college-office/setup", iconName: "Building", roles: ["COLLEGE_OFFICE"] },
  { label: "Documents", href: "/college-office/documents", iconName: "FolderOpen", roles: ["COLLEGE_OFFICE"] },
  { label: "Candidates", href: "/college-office/candidates", iconName: "UserCog", roles: ["COLLEGE_OFFICE"] },

  // Faculty (PANEL_MEMBER) — My Interviews is injected dynamically in Sidebar when assigned
  { label: "Dashboard", href: "/panel", iconName: "LayoutDashboard", roles: ["PANEL_MEMBER"] },
  { label: "Leave", href: "/panel/leave", iconName: "CalendarClock", roles: ["PANEL_MEMBER"] },
  { label: "Attendance", href: "/panel/attendance", iconName: "ClipboardCheck", roles: ["PANEL_MEMBER"] },
  { label: "Teaching Load", href: "/panel/teaching", iconName: "BookOpen", roles: ["PANEL_MEMBER"] },
  { label: "Payslips", href: "/panel/payslips", iconName: "Wallet", roles: ["PANEL_MEMBER"] },
  { label: "Appraisal", href: "/panel/appraisal", iconName: "TrendingUp", roles: ["PANEL_MEMBER"] },
  { label: "Training", href: "/panel/training", iconName: "GraduationCap", roles: ["PANEL_MEMBER"] },
  { label: "Grievance", href: "/panel/grievance", iconName: "AlertCircle", roles: ["PANEL_MEMBER"] },
  { label: "My Documents", href: "/panel/documents", iconName: "FolderOpen", roles: ["PANEL_MEMBER"] },

  // Accounts
  { label: "Dashboard", href: "/accounts", iconName: "LayoutDashboard", roles: ["ACCOUNTS"] },
  { label: "Salary Records", href: "/accounts/salary", iconName: "IndianRupee", roles: ["ACCOUNTS"] },
  { label: "Offer Letters", href: "/accounts/offers", iconName: "FileText", roles: ["ACCOUNTS"] },
];

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export const BOTTOM_NAV_ITEMS: Record<UserRole, NavItem[]> = {
  SUPER_ADMIN: [
    { label: "Dashboard", href: "/super-admin", iconName: "LayoutDashboard", roles: ["SUPER_ADMIN"] },
    { label: "Colleges", href: "/super-admin/colleges", iconName: "Building2", roles: ["SUPER_ADMIN"] },
    { label: "Vacancies", href: "/super-admin/vacancies", iconName: "ClipboardList", roles: ["SUPER_ADMIN"] },
    { label: "Settings", href: "/super-admin/settings", iconName: "Settings2", roles: ["SUPER_ADMIN"] },
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
    { label: "Hiring", href: "/hod/vacancy", iconName: "ClipboardPlus", roles: ["HOD"] },
  ],
  COLLEGE_OFFICE: [
    { label: "Home", href: "/college-office", iconName: "LayoutDashboard", roles: ["COLLEGE_OFFICE"] },
    { label: "Setup", href: "/college-office/setup", iconName: "Building", roles: ["COLLEGE_OFFICE"] },
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
  STUDENT: [],
};
