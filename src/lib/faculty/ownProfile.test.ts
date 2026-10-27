import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ROLE_DASHBOARD_PATHS, rolesInheritedBy } from "@/types";
import { detailsOnlyInLogin, holdsFacultyRole, ownFacultyProfilePath, resolveOwnProfileTarget } from "./ownProfile";

vi.mock("next/navigation", () => ({ usePathname: () => "/hod/profile", useRouter: () => ({ replace: () => undefined }) }));

describe("ownFacultyProfilePath", () => {
  it("maps each role-profile address to the same address under the faculty profile", () => {
    expect(ownFacultyProfilePath("/hod/profile")).toBe("/panel/profile");
    expect(ownFacultyProfilePath("/hod/profile/personal")).toBe("/panel/profile/personal");
    expect(ownFacultyProfilePath("/hod/profile/qualification/edit")).toBe("/panel/profile/qualification/edit");
    expect(ownFacultyProfilePath("/principal/profile")).toBe("/panel/profile");
    expect(ownFacultyProfilePath("/principal/profile/experience/edit")).toBe("/panel/profile/experience/edit");
  });

  it("leaves every other address alone", () => {
    for (const p of ["/panel/profile", "/hod/profiles", "/hod/faculty/f1/personal", "/college-office/profile", "/student/profile", "/principal/profile-completion", "/hod"]) {
      expect(ownFacultyProfilePath(p), p).toBeNull();
    }
  });
});

describe("holdsFacultyRole", () => {
  it("is true for a Faculty login and for an HOD / Principal who also holds the Faculty role", () => {
    expect(holdsFacultyRole("PANEL_MEMBER", [])).toBe(true);
    expect(holdsFacultyRole("HOD", ["HOD", "PANEL_MEMBER"])).toBe(true);
    expect(holdsFacultyRole("VICE_PRINCIPAL", ["PANEL_MEMBER"])).toBe(true);
  });
  it("is false for a role-only login - it must keep its own profile page", () => {
    expect(holdsFacultyRole("HOD", ["HOD"])).toBe(false);
    expect(holdsFacultyRole("PRINCIPAL", undefined)).toBe(false);
    expect(holdsFacultyRole(undefined, null)).toBe(false);
  });
});

describe("detailsOnlyInLogin - nothing may drop out of sight", () => {
  const record = { fatherName: "R KUMAR", academicProfile: { ugDetails: { course: "BBA", institutionName: "X" } } };

  it("is empty when the faculty record already holds everything the login holds", () => {
    expect(detailsOnlyInLogin({ fatherName: "R KUMAR", academicProfile: { ugDetails: { course: "BBA" } } }, record)).toEqual([]);
    expect(detailsOnlyInLogin({ name: "A", email: "a@x.in", role: "HOD" }, record)).toEqual([]);
    expect(detailsOnlyInLogin(null, record)).toEqual([]);
  });

  it("names every detail that only the login holds", () => {
    const login = { motherName: "D", bloodGroup: "O+", academicProfile: { awardsRecognition: [{ titleOfAward: "Best Teacher" }], ugDetails: { course: "BBA" } } };
    expect(detailsOnlyInLogin(login, record).sort()).toEqual(["academicProfile.awardsRecognition", "bloodGroup", "motherName"]);
  });

  it("ignores blanks - a row or field of empty strings is nothing", () => {
    expect(detailsOnlyInLogin({ fatherName: "", academicProfile: { academicExperience: [{ institutionName: "", place: "" }] } }, record)).toEqual([]);
  });

  it("compares by current key names, so a login still on the old names is read correctly", () => {
    const login = { academicProfile: { previousInstitutions: [{ institutionName: "ABC College" }] } };
    expect(detailsOnlyInLogin(login, { academicProfile: {} })).toEqual(["academicProfile.academicExperience"]);
    expect(detailsOnlyInLogin(login, { academicProfile: { academicExperience: [{ institutionName: "ABC College" }] } })).toEqual([]);
  });

  it("a value in the same field on both sides is covered (the record wins; nothing is hidden)", () => {
    expect(detailsOnlyInLogin({ fatherName: "OLD" }, { fatherName: "NEW" })).toEqual([]);
  });
});

describe("resolveOwnProfileTarget", () => {
  const me = (extra: Record<string, unknown> = {}) => vi.fn(async () => ({ facultyRecord: true, faculty: { fatherName: "R" }, ...extra }));
  const base = { pathname: "/hod/profile/personal/edit", role: "HOD", heldRoles: ["HOD", "PANEL_MEMBER"], login: { name: "A" } };

  it("sends an HOD / Principal who is faculty to the same page of the faculty profile", async () => {
    expect(await resolveOwnProfileTarget({ ...base, fetchMe: me() })).toBe("/panel/profile/personal/edit");
    expect(await resolveOwnProfileTarget({ ...base, pathname: "/principal/profile", role: "VICE_PRINCIPAL", fetchMe: me() })).toBe("/panel/profile");
  });

  it("keeps the role page for a login with no faculty record", async () => {
    expect(await resolveOwnProfileTarget({ ...base, fetchMe: async () => ({ facultyRecord: false }) })).toBeNull();
    expect(await resolveOwnProfileTarget({ ...base, fetchMe: async () => ({}) })).toBeNull();
    expect(await resolveOwnProfileTarget({ ...base, fetchMe: async () => null })).toBeNull();
  });

  it("keeps the role page when the login lacks the Faculty role, without even asking", async () => {
    const fetchMe = me();
    expect(await resolveOwnProfileTarget({ ...base, heldRoles: ["HOD"], fetchMe })).toBeNull();
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it("keeps the role page while the login holds details the faculty record lacks", async () => {
    const login = { motherName: "D", academicProfile: { awardsRecognition: [{ titleOfAward: "Best" }] } };
    expect(await resolveOwnProfileTarget({ ...base, login, fetchMe: me() })).toBeNull();
    // ...and moves them once the record holds it
    const covered = me({ faculty: { motherName: "D", academicProfile: { awardsRecognition: [{ titleOfAward: "Best" }] } } });
    expect(await resolveOwnProfileTarget({ ...base, login, fetchMe: covered })).toBe("/panel/profile/personal/edit");
  });

  it("any failure leaves the person where they are", async () => {
    expect(await resolveOwnProfileTarget({ ...base, fetchMe: async () => { throw new Error("offline"); } })).toBeNull();
  });

  it("never touches an address that is not a role profile", async () => {
    const fetchMe = me();
    expect(await resolveOwnProfileTarget({ ...base, pathname: "/hod/faculty", fetchMe })).toBeNull();
    expect(fetchMe).not.toHaveBeenCalled();
  });
});

describe("access", () => {
  it("HOD, Principal and Vice Principal may open the faculty profile pages (they inherit the Faculty role's dashboard)", () => {
    expect(ROLE_DASHBOARD_PATHS.PANEL_MEMBER).toBe("/panel");
    for (const role of ["HOD", "PRINCIPAL", "VICE_PRINCIPAL"] as const) expect(rolesInheritedBy(role), role).toContain("PANEL_MEMBER");
  });
});

describe("the role-profile pages", () => {
  const CRLF = new RegExp("\r\n", "g");
  const pages = [
    ["src/app/(dashboard)/hod/profile/page.tsx", "HodProfilePage"],
    ["src/app/(dashboard)/hod/profile/[module]/page.tsx", "HodProfileModulePage"],
    ["src/app/(dashboard)/hod/profile/[module]/edit/page.tsx", "HodProfileModuleEditPage"],
    ["src/app/(dashboard)/principal/profile/page.tsx", "PrincipalProfilePage"],
    ["src/app/(dashboard)/principal/profile/[module]/page.tsx", "PrincipalProfileModulePage"],
    ["src/app/(dashboard)/principal/profile/[module]/edit/page.tsx", "PrincipalProfileModuleEditPage"],
  ];

  it("each one is wrapped by the redirect and still contains its own original page", () => {
    for (const [file, name] of pages) {
      const src = readFileSync(file, "utf8").replace(CRLF, "\n");
      expect(src, file).toContain(`export default function ${name}() {`);
      expect(src, file).toContain(`<FacultyProfileRedirect><${name}Content /></FacultyProfileRedirect>`);
      expect(src, file).toContain(`function ${name}Content() {`); // the original page, unchanged inside
    }
  });

  it("the wrapper shows nothing of the role page until it has decided (no wrong-profile flash, no extra requests)", async () => {
    const { FacultyProfileRedirect } = await import("@/components/faculty/FacultyProfileRedirect");
    const html = renderToStaticMarkup(createElement(FacultyProfileRedirect, null, createElement("p", null, "ROLE PAGE")));
    expect(html).toContain("Loading");
    expect(html).not.toContain("ROLE PAGE");
  });

  it("the faculty profile itself is not wrapped (it is the destination)", () => {
    const src = readFileSync("src/app/(dashboard)/panel/profile/page.tsx", "utf8");
    expect(src).not.toContain("FacultyProfileRedirect");
  });
});
