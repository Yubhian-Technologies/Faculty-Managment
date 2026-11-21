import { describe, expect, it } from "vitest";
import { computeItemModule, getNavItemsForRole, migrateHiddenModules } from "./navConfig";
import type { UserRole } from "@/types";

// Regrouping the Principal / HOD / Faculty / Student sidebars is presentation only:
// every role must keep exactly the same pages (routes) it had, and a college's saved
// hidden-module list must keep hiding what it used to.

const EXPECTED: Record<string, string[]> = {
  "VICE_PRINCIPAL": [
    "/vice-principal",
    "/principal/courses",
    "/principal/students",
    "/principal/timetable",
    "/principal/mid-timetable",
    "/principal/holiday-calendar",
    "/principal/internal-marks",
    "/principal/results-analysis",
    "/principal/mentoring",
    "/certificates",
    "/principal/faculty/profile-completion",
    "/principal/faculty",
    "/principal/leave-approvals",
    "/principal/leave-history",
    "/principal/student-permissions",
    "/principal/attendance-report",
    "/principal/attendance-reports",
    "/principal/circulars",
    "/principal/vacancies",
    "/principal/vacancies/general-admin",
    "/principal/budget",
    "/principal/payroll",
    "/principal/budget/report",
    "/principal/purchase-clearance",
    "/principal/indents",
    "/principal/profile",
    "/principal/attendance",
    "/principal/leave",
    "/payslips",
    "/leave/adjustments",
    "/principal/audit-logs",
    "/principal/role-assignments",
    "/principal/incident-record",
    "/principal/settings"
  ],
  "PRINCIPAL": [
    "/principal",
    "/principal/courses",
    "/principal/students",
    "/principal/timetable",
    "/principal/mid-timetable",
    "/principal/holiday-calendar",
    "/principal/internal-marks",
    "/principal/results-analysis",
    "/principal/mentoring",
    "/certificates",
    "/principal/faculty/profile-completion",
    "/principal/faculty",
    "/principal/leave-approvals",
    "/principal/leave-history",
    "/principal/student-permissions",
    "/principal/attendance-report",
    "/principal/attendance-reports",
    "/principal/circulars",
    "/principal/vacancies",
    "/principal/budget",
    "/principal/payroll",
    "/principal/budget/report",
    "/principal/purchase-clearance",
    "/principal/indents",
    "/principal/profile",
    "/principal/attendance",
    "/principal/leave",
    "/payslips",
    "/principal/audit-logs",
    "/principal/role-assignments",
    "/principal/incident-record",
    "/principal/settings"
  ],
  "HOD": [
    "/hod",
    "/hod/faculty",
    "/hod/sections",
    "/hod/mentoring",
    "/hod/certificate-requests",
    "/hod/incident-record",
    "/hod/students",
    "/hod/settings/sub-departments",
    "/hod/settings/designations",
    "/hod/settings",
    "/hod/settings/department-office",
    "/hod/subjects",
    "/hod/teaching-assignments",
    "/hod/internal-exam",
    "/hod/results-analysis",
    "/hod/faculty/profile-completion",
    "/hod/question-banks",
    "/hod/cea",
    "/hod/timetable",
    "/hod/leave-approvals",
    "/hod/leave-history",
    "/hod/student-permissions",
    "/hod/faculty-attendance",
    "/hod/attendance-reports",
    "/hod/student-attendance-import",
    "/hod/leave/profiles",
    "/hod/budget",
    "/hod/indents",
    "/hod/purchase-clearance",
    "/hod/pipeline",
    "/hod/candidates",
    "/hod/attendance",
    "/hod/leave",
    "/payslips",
    "/leave/adjustments",
    "/hod/teaching",
    "/hod/profile"
  ],
  "PANEL_MEMBER": [
    "/panel",
    "/panel/teaching",
    "/panel/timetable-incharge",
    "/panel/assignment-requests",
    "/panel/faculty-timetable",
    "/panel/internal-exam",
    "/panel/cea",
    "/panel/mid-bank",
    "/panel/mid-timetable",
    "/panel/invigilation",
    "/panel/mark-attendance",
    "/panel/student-permissions",
    "/panel/monthly-records",
    "/panel/topics-covered",
    "/panel/mentoring",
    "/panel/section",
    "/panel/students",
    "/panel/students/batches",
    "/panel/students/class-representatives",
    "/panel/feedback",
    "/panel/certificates",
    "/panel/leave",
    "/leave/adjustments",
    "/panel/attendance",
    "/panel/profile",
    "/payslips"
  ],
  "STUDENT": [
    "/student",
    "/student/certificates",
    "/student/timetable",
    "/student/mid-timetable",
    "/student/holidays",
    "/student/attendance",
    "/student/results",
    "/student/cea",
    "/student/mentoring",
    "/student/library",
    "/student/documents",
    "/student/permissions",
    "/student/profile"
  ]
};

describe("sidebar regrouping", () => {
  for (const [role, hrefs] of Object.entries(EXPECTED)) {
    it(`${role} keeps exactly its routes, dashboard first`, () => {
      const items = getNavItemsForRole(role as UserRole);
      expect(items.map((i) => i.href).sort()).toEqual([...hrefs].sort());
      expect(items[0].href).toBe(hrefs[0]);
    });
    it(`${role} groups are contiguous and named`, () => {
      const items = getNavItemsForRole(role as UserRole);
      const seen: string[] = [];
      items.forEach((_, i) => {
        const m = computeItemModule(items, i);
        if (seen[seen.length - 1] !== m) {
          expect(seen).not.toContain(m); // a module never reappears after another
          seen.push(m);
        }
      });
    });
  }

  it("a saved legacy module hides the groups it was split into, and nothing else", () => {
    expect(migrateHiddenModules("HOD", ["Department"]).sort()).toEqual(["Academics", "Department"]);
    expect(migrateHiddenModules("PRINCIPAL", ["Academic Management"])).toContain("Academics");
    expect(migrateHiddenModules("PANEL_MEMBER", ["My Work"]).sort()).toEqual(["Academics", "Additional Duties", "My Work", "Students"]);
    // Renamed sections (Nov 2026): a college that hid the old name keeps it hidden under the new one.
    expect(migrateHiddenModules("PANEL_MEMBER", ["Students & Attendance"])).toContain("Students");
    expect(migrateHiddenModules("PANEL_MEMBER", ["Incharge Duties"])).toContain("Additional Duties");
    expect(migrateHiddenModules("PANEL_MEMBER", ["Leave & Attendance"])).toContain("My Leave & Attendance");
    expect(migrateHiddenModules("HOD", ["Hiring"])).toContain("Recruitment");
    expect(migrateHiddenModules("HOD", ["Budget & Purchase"])).toContain("Budget & Purchases");
    expect(migrateHiddenModules("PRINCIPAL", ["Hiring Pipeline"])).toContain("Recruitment");
    // The Dec 2026 regrouping mixes pages from several old groups, so it never hides a whole new group.
    expect(migrateHiddenModules("HOD", ["Approvals"])).not.toContain("Students");
    expect(migrateHiddenModules("PRINCIPAL", ["Staff & HR"])).not.toContain("Faculty & Staff");
    expect(migrateHiddenModules("HOD", [])).toEqual([]);
  });
});

describe("regrouped by who a page is about (Dec 2026)", () => {
  it("HOD: Students, Faculty, Academics, Department, then budget, recruitment, own work", async () => {
    const { groupNavItems } = await import("./navGroups");
    const titles = groupNavItems(getNavItemsForRole("HOD")).map((g) => g.title);
    expect(titles).toEqual([null, "Students", "Faculty", "Academics", "Department", "Budget & Purchases", "Recruitment", "My Work", "Personal"]);
  });

  it("Principal / VP: Students, Faculty & Staff, Academics, Recruitment, Finance, Administration, My Work", async () => {
    const { groupNavItems } = await import("./navGroups");
    for (const role of ["PRINCIPAL", "VICE_PRINCIPAL"] as const) {
      expect(groupNavItems(getNavItemsForRole(role)).map((g) => g.title))
        .toEqual([null, "Students", "Faculty & Staff", "Academics", "Recruitment", "Finance", "Administration", "My Work"]);
    }
  });

  it("a page a college hid by its old group stays hidden - only that page, never its new neighbours", async () => {
    const { hiddenItemsFromMovedModules } = await import("./navConfig");
    // HOD hid "Approvals": its pages stay hidden wherever they moved; the rest of Students / Faculty stays visible.
    const hod = hiddenItemsFromMovedModules("HOD", ["Approvals"]).sort();
    expect(hod).toEqual(expect.arrayContaining(["/hod/leave-approvals", "/hod/student-permissions", "/hod/certificate-requests", "/hod/incident-record"]));
    expect(hod).not.toContain("/hod/students");
    expect(hod).not.toContain("/hod/faculty");
    // HOD hid "Department": Faculty / Students pages moved out of it stay hidden; Department's own setup stays hidden as a group.
    expect(hiddenItemsFromMovedModules("HOD", ["Department"])).toEqual(expect.arrayContaining(["/hod/students", "/hod/mentoring", "/hod/faculty"]));
    expect(migrateHiddenModules("HOD", ["Department"])).toContain("Department");
    // Principal hid "Staff & HR": Faculty, Profile Completion and Circulars stay hidden; Role Assignments does not.
    const pr = hiddenItemsFromMovedModules("PRINCIPAL", ["Staff & HR"]);
    expect(pr).toEqual(expect.arrayContaining(["/principal/faculty", "/principal/faculty/profile-completion", "/principal/circulars"]));
    expect(pr).not.toContain("/principal/role-assignments");
    // Older names still carry through (Payroll & Budget -> Finance pages).
    expect(hiddenItemsFromMovedModules("PRINCIPAL", ["Payroll & Budget"])).toEqual(expect.arrayContaining(["/principal/budget", "/principal/payroll"]));
    expect(hiddenItemsFromMovedModules("HOD", [])).toEqual([]);
  });

  it("every page hidden through an old group before is still hidden after (HOD, Principal, VP)", async () => {
    const { hiddenItemsFromMovedModules, isPathHidden } = await import("./navConfig");
    const OLD: Record<string, Record<string, string[]>> = {
      HOD: {
        Department: ["/hod/faculty", "/hod/faculty/profile-completion", "/hod/sections", "/hod/students", "/hod/mentoring", "/hod/settings/sub-departments", "/hod/settings/designations", "/hod/settings", "/hod/settings/department-office"],
        Approvals: ["/hod/leave-approvals", "/hod/leave-history", "/hod/student-permissions", "/hod/certificate-requests", "/hod/incident-record"],
        "Attendance & Leave": ["/hod/faculty-attendance", "/hod/attendance-reports", "/hod/student-attendance-import", "/hod/leave/profiles"],
      },
      PRINCIPAL: {
        "Staff & HR": ["/principal/faculty", "/principal/faculty/profile-completion", "/principal/circulars"],
        "Leave & Attendance": ["/principal/leave-approvals", "/principal/leave-history", "/principal/student-permissions", "/principal/attendance-report", "/principal/attendance-reports"],
        "Budget & Purchase": ["/principal/budget", "/principal/payroll", "/principal/budget/report", "/principal/purchase-clearance", "/principal/indents"],
        Personal: ["/principal/attendance", "/principal/leave", "/principal/payslips", "/payslips"],
      },
    };
    for (const [role, groups] of Object.entries(OLD)) {
      for (const [group, hrefs] of Object.entries(groups)) {
        const modules = migrateHiddenModules(role as UserRole, [group]);
        const items = hiddenItemsFromMovedModules(role as UserRole, modules);
        for (const h of hrefs) {
          if (!getNavItemsForRole(role as UserRole).some((i) => i.href === h)) continue;
          expect(isPathHidden(h, role as UserRole, modules, items), `${role} ${group} ${h}`).toBe(true);
        }
      }
    }
  });
});
