import { describe, expect, it } from "vitest";
import { CUSTOMIZABLE_ROLES } from "./roles";

describe("CUSTOMIZABLE_ROLES", () => {
  it("includes the student-facing dashboards, whose sidebars have no section headers", () => {
    expect(CUSTOMIZABLE_ROLES).toContain("STUDENT");
    expect(CUSTOMIZABLE_ROLES).toContain("CLASS_LEADER");
  });
  it("includes the usual college staff roles", () => {
    for (const r of ["PRINCIPAL", "VICE_PRINCIPAL", "HOD", "PANEL_MEMBER", "COLLEGE_OFFICE"] as const) expect(CUSTOMIZABLE_ROLES).toContain(r);
  });
  it("leaves out global and location-scoped roles (a college has no sidebar for them)", () => {
    for (const r of ["SUPER_ADMIN", "MANAGEMENT", "FINANCE", "ADMINISTRATION", "HR_ADMIN"] as const) expect(CUSTOMIZABLE_ROLES).not.toContain(r);
  });
  it("has no duplicates", () => {
    expect(new Set(CUSTOMIZABLE_ROLES).size).toBe(CUSTOMIZABLE_ROLES.length);
  });
});
