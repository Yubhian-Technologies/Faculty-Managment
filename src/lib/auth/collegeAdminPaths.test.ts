import { describe, expect, it } from "vitest";
import { dashboardPathFor, fromCollegeAdminPath, isCollegeAdminRewriteSource, toCollegeAdminPath } from "./collegeAdminPaths";

describe("toCollegeAdminPath", () => {
  it("moves Principal and R&D pages under /college-admin", () => {
    expect(toCollegeAdminPath("/principal")).toBe("/college-admin");
    expect(toCollegeAdminPath("/principal/courses")).toBe("/college-admin/courses");
    expect(toCollegeAdminPath("/principal/faculty/profile-completion")).toBe("/college-admin/faculty/profile-completion");
    expect(toCollegeAdminPath("/r-and-d")).toBe("/college-admin/r-and-d");
    expect(toCollegeAdminPath("/r-and-d/publications/new")).toBe("/college-admin/r-and-d/publications/new");
  });

  it("leaves every other path alone, including look-alike prefixes", () => {
    expect(toCollegeAdminPath("/principal-extra")).toBe("/principal-extra");
    expect(toCollegeAdminPath("/leave/adjustments")).toBe("/leave/adjustments");
    expect(toCollegeAdminPath("/college-admin/courses")).toBe("/college-admin/courses");
  });
});

describe("fromCollegeAdminPath", () => {
  it("is the inverse of toCollegeAdminPath", () => {
    for (const p of ["/principal", "/principal/courses", "/r-and-d", "/r-and-d/seed-funding"]) {
      expect(fromCollegeAdminPath(toCollegeAdminPath(p))).toBe(p);
    }
  });

  it("leaves a path outside /college-admin alone", () => {
    expect(fromCollegeAdminPath("/principal/courses")).toBe("/principal/courses");
    expect(fromCollegeAdminPath("/college-adminx")).toBe("/college-adminx");
  });
});

describe("isCollegeAdminRewriteSource", () => {
  it("recognises the pages a College Admin is moved off", () => {
    expect(isCollegeAdminRewriteSource("/principal/students")).toBe(true);
    expect(isCollegeAdminRewriteSource("/r-and-d")).toBe(true);
    expect(isCollegeAdminRewriteSource("/hod")).toBe(false);
  });
});

describe("dashboardPathFor", () => {
  it("sends a College Admin to /college-admin even though its role reads PRINCIPAL", () => {
    expect(dashboardPathFor("PRINCIPAL", "COLLEGE_ADMIN")).toBe("/college-admin");
  });

  it("sends everyone else to their role's dashboard", () => {
    expect(dashboardPathFor("PRINCIPAL", "PRINCIPAL")).toBe("/principal");
    expect(dashboardPathFor("PRINCIPAL")).toBe("/principal");
    expect(dashboardPathFor("HOD", "DEPARTMENT_OFFICE")).toBe("/hod");
    expect(dashboardPathFor("NOPE")).toBeUndefined();
  });
});
