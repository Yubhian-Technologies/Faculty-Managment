import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { EmptyModuleState } from "./EmptyModuleState";
import { FacultyProfileModuleContent } from "./FacultyProfileModuleContent";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";

const CRLF = new RegExp("\r\n", "g");
const client = new QueryClient();
const content = (moduleKey: ProfileModuleKey, faculty: unknown, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(FacultyProfileModuleContent, { moduleKey, faculty: faculty as never, ...extra })));

describe("EmptyModuleState", () => {
  it("asks for the details and offers an Edit button that goes to the edit page", () => {
    const html = renderToStaticMarkup(createElement(EmptyModuleState, { moduleKey: "qualification", editHref: "/hod/faculty/f1/qualification/edit" }));
    expect(html).toContain("Please enter the academic details here.");
    expect(html).toContain('href="/hod/faculty/f1/qualification/edit"');
    expect(html).toContain("Edit");
  });

  it("without an edit link it only states that nothing is entered - no button", () => {
    const html = renderToStaticMarkup(createElement(EmptyModuleState, { moduleKey: "financial" }));
    expect(html).toContain("No compensation details have been entered yet.");
    expect(html).not.toContain("<a ");
    expect(html).not.toMatch(/please enter/i);
  });
});

describe("a tab with nothing entered", () => {
  const empty = { employeeId: "E1", legalName: "A KUMAR" };

  it("shows the message and Edit button instead of an empty heading", () => {
    for (const tab of ["personal", "qualification", "experience", "mentorship", "others"] as ProfileModuleKey[]) {
      const html = content(tab, empty, { editHref: `/x/${tab}/edit`, ratificationHistory: true });
      expect(html, tab).toContain('data-testid="empty-module-state"');
      expect(html, tab).toContain(`href="/x/${tab}/edit"`);
      expect(html, tab).toContain("Please enter the");
    }
  });

  it("teaching shows it when there are no assignments, and not when there are", () => {
    expect(content("teaching-load", empty, { editHref: "/x/teaching-load/edit" })).toContain('data-testid="empty-module-state"');
    const previous = { ...empty, previousTeachingAssignments: [{ id: "a", source: "INTERNAL", academicYear: "2024-2025", course: "B.Tech", year: "1st", semester: "I", subject: "Maths", passPercentage: "85" }] };
    expect(content("teaching-load", previous, { editHref: "/x" })).not.toContain('data-testid="empty-module-state"');
  });

  it("research never shows it", () => {
    expect(content("research", empty, { editHref: "/x" })).not.toContain('data-testid="empty-module-state"');
  });

  it("a view-only page (no edit link) shows the plain sentence with no button", () => {
    const html = content("others", empty);
    expect(html).toContain("No additional information details have been entered yet.");
    expect(html).not.toContain("Please enter");
  });
});

describe("a tab with something entered is shown exactly as before", () => {
  it("shows the details, not the empty state", () => {
    const html = content("others", { academicProfile: { otherInformation: "Chess club" } }, { editHref: "/x/others/edit" });
    expect(html).toContain("Chess club");
    expect(html).not.toContain('data-testid="empty-module-state"');
    const q = content("qualification", { academicProfile: { ugDetails: { course: "BBA", institutionName: "SCRK" } } }, { editHref: "/x" });
    expect(q).toContain("SCRK");
    expect(q).not.toContain('data-testid="empty-module-state"');
  });
});

describe("pages offer the empty-state Edit only when their own header does", () => {
  const pages = [
    "src/app/(dashboard)/hod/faculty/[id]/[module]/page.tsx",
    "src/app/(dashboard)/principal/faculty/[deptId]/[facultyId]/[module]/page.tsx",
    "src/app/(dashboard)/principal/staff/[uid]/[module]/page.tsx",
    "src/app/(dashboard)/super-admin/users/[uid]/[module]/page.tsx",
    "src/app/(dashboard)/principal/profile/[module]/page.tsx",
    "src/components/faculty/MyProfileModulePage.tsx",
  ];
  it("one editHref drives both the header button and the empty state", () => {
    for (const file of pages) {
      const src = readFileSync(file, "utf8").replace(CRLF, "\n");
      expect((src.match(/const editHref = /g) ?? []).length, file).toBe(1);
      expect(src, file).toContain("{editHref && (");
      expect(src, file).toContain("<FacultyProfileModuleContent editHref={editHref}");
      // the edit address is written once (in editHref); the header button just uses it
      expect((src.match(/\/edit`/g) ?? []).length, file).toBe(1);
    }
  });

  it("the Management view (read-only) never offers an edit", () => {
    const src = readFileSync("src/app/(dashboard)/management/faculty/[collegeId]/departments/[deptId]/faculty/[facultyId]/[module]/page.tsx", "utf8");
    expect(src).not.toContain("editHref");
  });

  it("research and financial stay view-only on the HOD / Principal / staff pages, as their headers always were", () => {
    for (const file of pages.slice(0, 3)) {
      const src = readFileSync(file, "utf8").replace(CRLF, "\n");
      expect(src, file).toContain('moduleKey !== "research" && moduleKey !== "financial"');
    }
  });
});
