import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every control that would CHANGE something is hidden for a RESIGNED/RETIRED person (the API denies the write
// regardless - these keep the screens honest), and every one is still there for everyone else.

const h = vi.hoisted(() => ({ readOnly: false }));

vi.mock("@/store/authStore", () => ({
  useAuthStore: (sel: (s: { user: { uid: string; collegeId: string; readOnlyAccess?: boolean } }) => unknown) =>
    sel({ user: { uid: "u1", collegeId: "c1", readOnlyAccess: h.readOnly || undefined } }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "u1", name: "Dr X", collegeId: "c1", role: "PANEL_MEMBER", profilePhotoUrl: undefined } }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ module: "personal" }), useRouter: () => ({ push: () => {} }), usePathname: () => "/panel/profile" }));
vi.mock("@/components/shared/PageHeader", () => ({
  PageHeader: ({ actions }: { actions?: React.ReactNode }) => createElement("header", null, actions),
}));
vi.mock("@/components/shared/ProfilePhotoUpload", () => ({ ProfilePhotoUpload: () => createElement("i", null, "PHOTO-UPLOAD") }));
vi.mock("@/components/shared/Avatar", () => ({ Avatar: () => createElement("i", null, "AVATAR-ONLY") }));
vi.mock("@/components/shared/ChangePasswordDialog", () => ({ ChangePasswordDialog: () => createElement("i", null, "CHANGE-PASSWORD") }));
vi.mock("@/components/shared/PublicProfileLinkButton", () => ({ PublicProfileLinkButton: () => createElement("i", null, "PUBLIC-LINK") }));
vi.mock("@/components/faculty/MyResumeDownloadButton", () => ({ MyResumeDownloadButton: () => createElement("i", null, "RESUME") }));
vi.mock("@/components/faculty/FacultyProfileHub", () => ({
  MyProfileModuleTiles: () => null, FacultyIdentityFacts: () => null, FacultyStatusBadge: () => null,
}));
vi.mock("@/components/faculty/FacultyProfileModuleContent", () => ({ FacultyProfileModuleContent: () => null }));
vi.mock("@/hooks/useCollegeType", () => ({ useCollegeType: () => ({ collegeType: "ENGINEERING" }) }));
vi.mock("@/hooks/useAppliedFilters", () => ({ useAppliedFilters: () => ({ applied: { year: 2026, month: 10 }, dirty: false, applyFilters: () => {}, month: 10, year: 2026, setMonth: () => {}, setYear: () => {} }) }));
vi.mock("@/components/attendance/MarkAttendanceDialog", () => ({ MarkAttendanceDialog: () => null }));
vi.mock("@/components/shared/LoadButton", () => ({ LoadButton: () => null }));

// useEffect never runs in a server render, so give the pages the state their effects would have loaded.
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useState: <T,>(init: T | (() => T)) => real.useState(init) };
});

import { useReadOnlyAccess } from "@/hooks/useReadOnlyAccess";
import FacultyProfilePage from "@/app/(dashboard)/panel/profile/page";
import { MyProfileModulePage } from "@/components/faculty/MyProfileModulePage";

beforeEach(() => { h.readOnly = false; });

describe("useReadOnlyAccess", () => {
  it("mirrors the auth store flag", () => {
    let seen: boolean | undefined;
    const C = () => { seen = useReadOnlyAccess(); return null; };
    renderToStaticMarkup(createElement(C)); expect(seen).toBe(false);
    h.readOnly = true;
    renderToStaticMarkup(createElement(C)); expect(seen).toBe(true);
  });
});

describe("My Profile page", () => {
  it("RESIGNED/RETIRED: no photo upload/delete, no Change Password; the photo is just shown", () => {
    h.readOnly = true;
    const html = renderToStaticMarkup(createElement(FacultyProfilePage));
    expect(html).toContain("AVATAR-ONLY");
    expect(html).not.toContain("PHOTO-UPLOAD");
    expect(html).not.toContain("CHANGE-PASSWORD");
    expect(html).toContain("RESUME");                         // viewing / downloading their own record stays
  });
  it("everyone else: unchanged", () => {
    const html = renderToStaticMarkup(createElement(FacultyProfilePage));
    expect(html).toContain("PHOTO-UPLOAD");
    expect(html).toContain("CHANGE-PASSWORD");
    expect(html).not.toContain("AVATAR-ONLY");
  });
});

describe("profile section pages", () => {
  it("RESIGNED/RETIRED: no Edit button; everyone else keeps it", () => {
    h.readOnly = true;
    expect(renderToStaticMarkup(createElement(MyProfileModulePage, { basePath: "/panel/profile" }))).not.toContain("/edit");
    h.readOnly = false;
    expect(renderToStaticMarkup(createElement(MyProfileModulePage, { basePath: "/panel/profile" }))).toContain("/panel/profile/personal/edit");
  });
});
