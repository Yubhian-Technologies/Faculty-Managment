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
    "/principal/internal-marks",
    "/principal/faculty",
    "/principal/staff",
    "/principal/leave-approvals",
    "/principal/leave-history",
    "/principal/attendance-report",
    "/principal/attendance-reports",
    "/principal/circulars",
    "/principal/vacancies",
    "/principal/vacancies/general-admin",
    "/principal/budget",
    "/principal/budget/report",
    "/principal/purchase-clearance",
    "/principal/indents",
    "/principal/profile",
    "/principal/attendance",
    "/principal/leave",
    "/leave/adjustments",
    "/principal/audit-logs",
    "/principal/role-assignments",
    "/principal/settings"
  ],
  "PRINCIPAL": [
    "/principal",
    "/principal/courses",
    "/principal/students",
    "/principal/timetable",
    "/principal/internal-marks",
    "/principal/faculty",
    "/principal/staff",
    "/principal/leave-approvals",
    "/principal/leave-history",
    "/principal/attendance-report",
    "/principal/attendance-reports",
    "/principal/circulars",
    "/principal/vacancies",
    "/principal/budget",
    "/principal/budget/report",
    "/principal/purchase-clearance",
    "/principal/indents",
    "/principal/profile",
    "/principal/attendance",
    "/principal/leave",
    "/principal/audit-logs",
    "/principal/role-assignments",
    "/principal/settings"
  ],
  "HOD": [
    "/hod",
    "/hod/faculty",
    "/hod/sections",
    "/hod/students",
    "/hod/settings/sub-departments",
    "/hod/settings/designations",
    "/hod/settings/department-office",
    "/hod/subjects",
    "/hod/teaching-assignments",
    "/hod/internal-exam",
    "/hod/mid-paper-setter",
    "/hod/timetable",
    "/hod/leave-approvals",
    "/hod/leave-history",
    "/hod/student-permissions",
    "/hod/faculty-attendance",
    "/hod/attendance-reports",
    "/hod/leave/profiles",
    "/hod/budget",
    "/hod/indents",
    "/hod/purchase-clearance",
    "/hod/pipeline",
    "/hod/candidates",
    "/hod/attendance",
    "/hod/leave",
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
    "/panel/mid-bank",
    "/panel/mark-attendance",
    "/panel/student-permissions",
    "/panel/monthly-records",
    "/panel/topics-covered",
    "/panel/students",
    "/panel/students/batches",
    "/panel/feedback",
    "/panel/leave",
    "/leave/adjustments",
    "/panel/attendance",
    "/panel/profile"
  ],
  "STUDENT": [
    "/student",
    "/student/timetable",
    "/student/attendance",
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
    expect(migrateHiddenModules("HOD", ["Approvals"]).sort()).toEqual(["Approvals", "Attendance & Leave"]);
    expect(migrateHiddenModules("PRINCIPAL", ["Staff & HR Management"])).toEqual(expect.arrayContaining(["Staff & HR", "Leave & Attendance"]));
    expect(migrateHiddenModules("PRINCIPAL", ["Staff & HR Management"])).not.toContain("Administration");
    expect(migrateHiddenModules("PRINCIPAL", ["Payroll & Budget"])).toContain("Budget & Purchase");
    expect(migrateHiddenModules("PRINCIPAL", ["Academic Management"])).toContain("Academics");
    expect(migrateHiddenModules("PANEL_MEMBER", ["My Work"]).sort()).toEqual(["Incharge Duties", "My Work", "Students & Attendance"]);
    expect(migrateHiddenModules("HOD", [])).toEqual([]);
  });
});
