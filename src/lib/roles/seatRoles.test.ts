import { describe, expect, it } from "vitest";
import { canAssignSeat, canHoldSeat, isSingletonSeatRole, orderHeldRoles, pickEffectiveRole, roleMatchesSeat, SEAT_ROLES } from "./seatRoles";
import { getNavItemsForContext, getNavItemsForRoles, getWorkContexts, isPersonalNavItem, resolveWorkContext } from "@/components/layout/navConfig";

describe("pickEffectiveRole", () => {
  it("treats a faculty member who is also an HOD as an HOD where the endpoint accepts both", () => {
    expect(pickEffectiveRole(["HOD", "PANEL_MEMBER"], ["PANEL_MEMBER", "HOD"])).toBe("HOD");
  });
  it("uses the faculty role for a faculty-only endpoint", () => {
    expect(pickEffectiveRole(["HOD", "PANEL_MEMBER"], ["PANEL_MEMBER"])).toBe("PANEL_MEMBER");
  });
  it("denies when no held role is allowed", () => {
    expect(pickEffectiveRole(["PANEL_MEMBER"], ["PRINCIPAL"])).toBeNull();
  });
  it("picks the most senior of several seats", () => {
    expect(pickEffectiveRole(orderHeldRoles("PANEL_MEMBER", ["HOD", "VICE_PRINCIPAL"]), ["HOD", "VICE_PRINCIPAL"])).toBe("VICE_PRINCIPAL");
  });
});

describe("seat rules", () => {
  it("only supporting/office can't be HOD; anyone can be Principal or Library", () => {
    expect(canHoldSeat("PANEL_MEMBER", "HOD")).toBe(true);
    expect(canHoldSeat("COLLEGE_STAFF", "HOD")).toBe(false);
    expect(canHoldSeat("COLLEGE_OFFICE", "HOD")).toBe(false);
    expect(canHoldSeat("COLLEGE_STAFF", "LIBRARY")).toBe(true);
    expect(canHoldSeat("COLLEGE_OFFICE", "VICE_PRINCIPAL")).toBe(true);
  });
  it("lets the College Admin, Super Admin, Management and Administration appoint the Principal - not Principal/VP", () => {
    expect(canAssignSeat({ role: "PRINCIPAL", realRole: "COLLEGE_ADMIN" }, "PRINCIPAL")).toBe(true);
    expect(canAssignSeat({ role: "SUPER_ADMIN" }, "PRINCIPAL")).toBe(true);
    expect(canAssignSeat({ role: "MANAGEMENT" }, "PRINCIPAL")).toBe(true);
    expect(canAssignSeat({ role: "ADMINISTRATION" }, "PRINCIPAL")).toBe(true);
    expect(canAssignSeat({ role: "PRINCIPAL", realRole: "PRINCIPAL" }, "PRINCIPAL")).toBe(false);
    expect(canAssignSeat({ role: "VICE_PRINCIPAL" }, "PRINCIPAL")).toBe(false);
  });
  it("lets Principal and VP assign every other seat, but not faculty or HODs", () => {
    expect(canAssignSeat({ role: "PRINCIPAL" }, "HOD")).toBe(true);
    expect(canAssignSeat({ role: "VICE_PRINCIPAL" }, "HOD")).toBe(true);
    expect(canAssignSeat({ role: "HOD" }, "HOD")).toBe(false);
    expect(canAssignSeat({ role: "PANEL_MEMBER" }, "ACADEMICS")).toBe(false);
  });
});

describe("College Admin seat", () => {
  it("is a seat role, one per college, and anyone can hold it", () => {
    expect(SEAT_ROLES).toContain("COLLEGE_ADMIN");
    expect(isSingletonSeatRole("COLLEGE_ADMIN")).toBe(true);
    expect(isSingletonSeatRole("PRINCIPAL")).toBe(true);
    expect(canHoldSeat("COLLEGE_OFFICE", "COLLEGE_ADMIN")).toBe(true);
  });
  it("compares a stored College Admin role raw, so it never looks like the Principal's account", () => {
    expect(roleMatchesSeat("COLLEGE_ADMIN", "COLLEGE_ADMIN")).toBe(true);
    expect(roleMatchesSeat("COLLEGE_ADMIN", "PRINCIPAL")).toBe(false);
    expect(roleMatchesSeat("PRINCIPAL", "COLLEGE_ADMIN")).toBe(false);
    expect(roleMatchesSeat("DEPARTMENT_OFFICE", "HOD")).toBe(true);
  });
  it("gives a College Office person with the seat Principal-level access", () => {
    expect(pickEffectiveRole(orderHeldRoles("COLLEGE_OFFICE", ["COLLEGE_ADMIN"]), ["PRINCIPAL"])).toBe("PRINCIPAL");
  });
});

describe("multi-role navigation", () => {
  it("classifies personal items by href shape, not by section", () => {
    expect(isPersonalNavItem({ href: "/principal/profile" })).toBe(true);
    expect(isPersonalNavItem({ href: "/hod/leave" })).toBe(true);
    expect(isPersonalNavItem({ href: "/leave/adjustments" })).toBe(true);
    expect(isPersonalNavItem({ href: "/hod/teaching" })).toBe(true);
    // Position modules that merely look similar:
    expect(isPersonalNavItem({ href: "/principal/leave-approvals" })).toBe(false);
    expect(isPersonalNavItem({ href: "/principal/settings" })).toBe(false);
    expect(isPersonalNavItem({ href: "/college-office/staff-attendance" })).toBe(false);
    expect(isPersonalNavItem({ href: "/hod/leave/profiles" })).toBe(false);
  });

  it("gives a faculty HOD their own modules plus the HOD position modules - and no duplicate personal ones", () => {
    const items = getNavItemsForRoles("PANEL_MEMBER", ["HOD", "PANEL_MEMBER"]);
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain("/panel/profile");
    expect(hrefs).toContain("/panel/leave");
    expect(hrefs).toContain("/hod/leave-approvals");
    expect(hrefs).toContain("/hod/faculty");
    expect(hrefs).not.toContain("/hod/profile");
    expect(hrefs).not.toContain("/hod/leave");
    expect(hrefs).not.toContain("/hod/attendance");
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(items.find((i) => i.href === "/hod")?.label).toBe("Head of Department Dashboard");
  });

  it("keeps the Principal's Settings page when it's a seat", () => {
    const hrefs = getNavItemsForRoles("PANEL_MEMBER", ["PRINCIPAL", "PANEL_MEMBER"]).map((i) => i.href);
    expect(hrefs).toContain("/principal/settings");
    expect(hrefs).toContain("/principal/role-assignments");
    expect(hrefs).not.toContain("/principal/profile");
  });

  it("is unchanged for a login with a single role", () => {
    expect(getNavItemsForRoles("PANEL_MEMBER", ["PANEL_MEMBER"]).map((i) => i.href)).toEqual(
      getNavItemsForRoles("PANEL_MEMBER").map((i) => i.href)
    );
  });
});

describe("working-as contexts", () => {
  const roles = ["PRINCIPAL", "HOD", "PANEL_MEMBER"] as never;
  it("has no contexts without seats", () => {
    expect(getWorkContexts("PANEL_MEMBER", ["PANEL_MEMBER"])).toEqual([]);
  });
  it("lists seats first, then My Work, and defaults to the most senior seat", () => {
    expect(getWorkContexts("PANEL_MEMBER", roles).map((c) => c.key)).toEqual(["PRINCIPAL", "HOD", "ME"]);
    expect(resolveWorkContext("PANEL_MEMBER", roles, undefined, "/principal")).toBe("PRINCIPAL");
  });
  it("shows only the chosen seat's modules plus a My Work group", () => {
    const hrefs = getNavItemsForContext("PANEL_MEMBER", roles, "HOD").map((i) => i.href);
    expect(hrefs).toContain("/hod/leave-approvals");
    expect(hrefs).toContain("/panel/profile");
    expect(hrefs).not.toContain("/principal/settings");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("My Work is the primary role's own sidebar, without seat modules", () => {
    const hrefs = getNavItemsForContext("PANEL_MEMBER", roles, "ME").map((i) => i.href);
    expect(hrefs).toEqual(getNavItemsForRoles("PANEL_MEMBER").map((i) => i.href));
  });
  it("follows the page: landing on another seat's page switches to that context", () => {
    expect(resolveWorkContext("PANEL_MEMBER", roles, "PRINCIPAL", "/hod/leave-approvals")).toBe("HOD");
    expect(resolveWorkContext("PANEL_MEMBER", roles, "HOD", "/hod/leave-approvals")).toBe("HOD");
  });
});
