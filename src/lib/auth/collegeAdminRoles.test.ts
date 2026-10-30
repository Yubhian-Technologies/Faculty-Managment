import { describe, expect, it } from "vitest";
import { withCollegeAdminRoles } from "./collegeAdminRoles";

describe("withCollegeAdminRoles", () => {
  it("adds the R&D role to a College Admin login", () => {
    expect(withCollegeAdminRoles("COLLEGE_ADMIN", ["PRINCIPAL"])).toEqual(["PRINCIPAL", "R_AND_D"]);
  });

  it("does not repeat it when the login already holds it", () => {
    expect(withCollegeAdminRoles("COLLEGE_ADMIN", ["PRINCIPAL", "R_AND_D"])).toEqual(["PRINCIPAL", "R_AND_D"]);
  });

  it("gives nothing to a login that holds no roles (deactivated or signed out)", () => {
    expect(withCollegeAdminRoles("COLLEGE_ADMIN", [])).toEqual([]);
  });

  it.each(["PRINCIPAL", "VICE_PRINCIPAL", "DIRECTOR", "HOD", "PANEL_MEMBER", "R_AND_D", ""])("never changes the roles of %s", (realRole) => {
    const held = ["PRINCIPAL"];
    expect(withCollegeAdminRoles(realRole, held)).toBe(held);
  });
});
