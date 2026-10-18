import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PROFILE_MODULES } from "@/lib/faculty/profileModules";
import { QualificationModule, ExperienceModule, MentorshipModule, FinancialModule, ProfileFieldsView } from "./ProfileFieldsView";

// The numbered section heading ("1 General & Academic Profile" ...) is hidden on a module's own page
// (hideHeader) but the content is unchanged, and the all-in-one profile view keeps its headings.
const profile = { highestQualification: "Ph.D", monthlySalary: 123456, researchAreasInterests: ["AI"] } as never;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("module headings", () => {
  it.each([
    ["Qualification", QualificationModule, "General & Academic Profile"],
    ["Experience", ExperienceModule, "Previous Experience"],
    ["Mentorship", MentorshipModule, PROFILE_MODULES.mentorship.label],
    ["Financial", FinancialModule, PROFILE_MODULES.financial.label],
  ] as const)("%s: heading shown by default, hidden with hideHeader, same content either way", (_n, Module, title) => {
    const withHeader = html(createElement(Module as never, { profile }));
    const without = html(createElement(Module as never, { profile, hideHeader: true }));
    expect(withHeader).toContain(title.replaceAll("&", "&amp;"));
    expect(without).not.toContain(title.replaceAll("&", "&amp;"));
    // everything except the heading row is identical
    expect(without.length).toBeLessThan(withHeader.length);
  });

  it("hiding the heading never hides the data", () => {
    const out = html(createElement(QualificationModule, { profile, hideHeader: true }));
    expect(out).toContain("Ph.D");
    expect(html(createElement(FinancialModule, { profile, hideHeader: true }))).toContain("123456");
  });

  it("the all-in-one profile view keeps every heading", () => {
    const out = html(createElement(ProfileFieldsView, { profile }));
    expect(out).toContain("General &amp; Academic Profile");
    expect(out).toContain("Previous Experience");
  });
});
