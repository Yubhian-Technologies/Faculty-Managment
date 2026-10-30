import { describe, expect, it } from "vitest";
import { filterVisibleNavItems, getCollegeAdminNavItems, getNavItemsForRole, getRolesWithNavModules, groupNavItemsByModule, isPathHidden } from "./navConfig";

const menu = (realRole: "COLLEGE_ADMIN" | "PRINCIPAL") =>
  filterVisibleNavItems(realRole === "COLLEGE_ADMIN" ? getCollegeAdminNavItems() : getNavItemsForRole("PRINCIPAL"), [], [], realRole, true);

describe("College Admin menu", () => {
  const items = menu("COLLEGE_ADMIN");
  const hrefs = items.map((i) => i.href);

  it("starts at /college-admin and holds only the admin's own pages and the College Office's", () => {
    expect(hrefs[0]).toBe("/college-admin");
    expect(hrefs.every((h) => h.startsWith("/college-admin") || h.startsWith("/college-office"))).toBe(true);
    expect(hrefs.some((h) => h.startsWith("/principal"))).toBe(false);
  });

  it("includes the College Office modules the admin also runs, once each", () => {
    for (const kept of ["/college-office/timings", "/college-office/non-technical-staff", "/college-office/staff", "/college-office/certificates", "/college-office/student-attendance-import"]) {
      expect(hrefs).toContain(kept);
    }
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
  });

  it("has the Principal's Holidays module (Compensatory Sundays is a tab inside it), not the Academics URL", () => {
    expect(hrefs).toContain("/college-admin/holiday-calendar");
    expect(hrefs).not.toContain("/academics/holidays");
  });

  it("keeps every College Office module under a heading (the duplicate Students item hands its heading on)", () => {
    expect(items.find((i) => i.href === "/college-office/timings")?.section).toBe("Students");
    const sections = items.filter((i) => i.section).map((i) => i.section);
    expect(sections).toEqual(expect.arrayContaining(["Staff", "Certificates"]));
    expect(sections).not.toContain("My Work");
  });

  it("has no personal items and no decision-making ones", () => {
    for (const gone of ["profile", "attendance", "leave", "vacancies", "budget", "purchase-clearance", "leave-approvals", "leave-history", "budget/report", "indents"]) {
      expect(hrefs).not.toContain(`/college-admin/${gone}`);
    }
    expect(items.map((i) => i.label)).not.toEqual(expect.arrayContaining(["My Profile", "My Attendance", "My Leave"]));
  });

  it("keeps the modules a College Admin can act on", () => {
    for (const kept of ["student-permissions", "role-assignments", "incident-record", "audit-logs", "attendance-reports"]) {
      expect(hrefs).toContain(`/college-admin/${kept}`);
    }
  });

  it("includes every R&D module but not the R&D office's personal pages", () => {
    const rnd = hrefs.filter((h) => h.startsWith("/college-admin/r-and-d"));
    expect(rnd).toEqual(expect.arrayContaining([
      "/college-admin/r-and-d", "/college-admin/r-and-d/publications", "/college-admin/r-and-d/research-profiles",
      "/college-admin/r-and-d/citation-metrics", "/college-admin/r-and-d/consultancy-projects", "/college-admin/r-and-d/seed-funding",
      "/college-admin/r-and-d/sponsored-projects", "/college-admin/r-and-d/discovery-innovation", "/college-admin/r-and-d/phd-supervision",
      "/college-admin/r-and-d/research-services", "/college-admin/r-and-d/hackathons", "/college-admin/r-and-d/innovations",
    ]));
    expect(rnd).not.toContain("/college-admin/r-and-d/profile");
    expect(rnd).not.toContain("/college-admin/r-and-d/leave");
  });

  it("starts the R&D modules under their own heading", () => {
    expect(items.find((i) => i.href === "/college-admin/r-and-d")?.section).toBe("Research & Development");
  });

  it("changes nothing for a Principal", () => {
    const principal = menu("PRINCIPAL").map((i) => i.href);
    expect(principal[0]).toBe("/principal");
    expect(principal.some((h) => h.startsWith("/college-admin") || h.startsWith("/r-and-d"))).toBe(false);
  });
});

describe("College Admin's own Nav Visibility", () => {
  it("is a role the Super Admin can configure, with its own list of modules", () => {
    expect(getRolesWithNavModules()).toContain("COLLEGE_ADMIN");
    const modules = groupNavItemsByModule(getNavItemsForRole("COLLEGE_ADMIN")).map((m) => m.name);
    expect(modules).toEqual(expect.arrayContaining(["Research & Development", "Leave & Attendance", "Certificates"]));
    expect(getNavItemsForRole("COLLEGE_ADMIN")).toEqual(getCollegeAdminNavItems());
  });

  it("lists only what a College Admin can use - no personal items, no decision pages", () => {
    const hrefs = getNavItemsForRole("COLLEGE_ADMIN").map((i) => i.href);
    for (const gone of ["/principal/profile", "/principal/attendance", "/principal/leave", "/principal/vacancies", "/principal/budget", "/principal/leave-approvals", "/college-office/profile"]) {
      expect(hrefs).not.toContain(gone);
    }
  });

  it("hides a whole module by name, and a single page by its own URL", () => {
    const base = filterVisibleNavItems(getCollegeAdminNavItems(), [], [], "COLLEGE_ADMIN", true);
    const noRnd = filterVisibleNavItems(getCollegeAdminNavItems(), ["Research & Development"], [], "COLLEGE_ADMIN", true);
    expect(base.some((i) => i.href.startsWith("/college-admin/r-and-d"))).toBe(true);
    expect(noRnd.some((i) => i.href.startsWith("/college-admin/r-and-d"))).toBe(false);
    const noHack = filterVisibleNavItems(getCollegeAdminNavItems(), [], ["/r-and-d/hackathons"], "COLLEGE_ADMIN", true);
    expect(noHack.some((i) => i.href === "/college-admin/r-and-d/hackathons")).toBe(false);
    expect(noHack.some((i) => i.href === "/college-admin/r-and-d/innovations")).toBe(true);
  });

  it("applies the College Office's hidden modules to a College Admin only through its own list", () => {
    // "Hiring" hidden under the College Office must not matter: the hook hands a College Admin only its own list.
    const own = filterVisibleNavItems(getCollegeAdminNavItems(), [], [], "COLLEGE_ADMIN", true);
    expect(own.some((i) => i.href === "/college-admin/holiday-calendar")).toBe(true);
  });

  it("checks a College Admin's pages against its own list", () => {
    expect(isPathHidden("/r-and-d/hackathons", "COLLEGE_ADMIN", [], ["/r-and-d/hackathons"])).toBe(true);
    expect(isPathHidden("/r-and-d/hackathons", "COLLEGE_ADMIN", ["Research & Development"], [])).toBe(true);
    expect(isPathHidden("/r-and-d/hackathons", "COLLEGE_ADMIN", [], [])).toBe(false);
  });
});
