import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacultyProfileModuleContent } from "./FacultyProfileModuleContent";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";

// The line saying what a tab holds is part of the page HEADING (title, then the person's name, then this line),
// not text inside the white card. These tests pin that placement.

const esc = (s: string) => s.replace(/&/g, "&amp;");
const CRLF = new RegExp("\r\n", "g");

describe("PageHeader note", () => {
  const header = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PageHeader, { title: "Personal & Contact Information", ...props }));

  it("shows under the title and the person's name, in that order", () => {
    const html = header({ description: "KUDUPUDI VENU GOPAL", note: PROFILE_MODULES.personal.description });
    const at = (needle: string) => html.indexOf(esc(needle));
    expect(at("Personal & Contact Information")).toBeGreaterThanOrEqual(0);
    expect(at("KUDUPUDI VENU GOPAL")).toBeGreaterThan(at("Personal & Contact Information"));
    expect(at("Personal information, contact details")).toBeGreaterThan(at("KUDUPUDI VENU GOPAL"));
    expect(html).toContain('data-testid="page-note"');
  });

  it("is optional - every other page's header is exactly what it was", () => {
    expect(header({ description: "x" })).not.toContain("page-note");
    expect(header({})).not.toContain("page-note");
  });
});

describe("tab pages", () => {
  it("the card no longer repeats the description", () => {
    const html = renderToStaticMarkup(createElement(FacultyProfileModuleContent, { moduleKey: "financial", faculty: { academicProfile: { monthlySalary: 50000 } } as never }));
    expect(html).not.toContain("Salary structure, increments");
  });

  it("every faculty tab page hands its tab's description to the header", () => {
    const pages = [
      "src/app/(dashboard)/hod/faculty/[id]/[module]/page.tsx",
      "src/app/(dashboard)/management/faculty/[collegeId]/departments/[deptId]/faculty/[facultyId]/[module]/page.tsx",
      "src/app/(dashboard)/principal/faculty/[deptId]/[facultyId]/[module]/page.tsx",
      "src/app/(dashboard)/principal/profile/[module]/page.tsx",
      "src/app/(dashboard)/principal/staff/[uid]/[module]/page.tsx",
      "src/app/(dashboard)/super-admin/users/[uid]/[module]/page.tsx",
      "src/components/faculty/MyProfileModulePage.tsx",
      "src/components/faculty/FacultyModuleEditPage.tsx",
      "src/components/faculty/MyProfileModuleEditPage.tsx",
      "src/app/(dashboard)/principal/profile/[module]/edit/page.tsx",
      "src/app/(dashboard)/principal/staff/[uid]/[module]/edit/page.tsx",
      "src/app/(dashboard)/super-admin/users/[uid]/[module]/edit/page.tsx",
    ];
    for (const file of pages) {
      // the repository is checked out with Windows or Unix line endings; compare on one
      const src = readFileSync(file, "utf8").replace(CRLF, "\n");
      const headers = [...src.matchAll(/<PageHeader\s*\n\s*title=\{[^\n]*moduleDef\.label[^\n]*\}\n(?:[^\n]*\n){0,3}/g)].map((m) => m[0]);
      expect(headers.length, file).toBeGreaterThan(0);
      for (const h of headers) expect(h, file).toContain("note={moduleDef.description}");
    }
  });
});
