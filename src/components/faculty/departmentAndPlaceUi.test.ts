import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The certificate uploader pulls in browser-only code; it is irrelevant here.
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { DegreeFields, DegreeView } from "@/components/shared/ProfileFieldPrimitives";
import { ExperienceFields } from "@/components/faculty/AcademicProfileModuleFields";
import { ExperienceModule } from "@/components/faculty/ProfileFieldsView";
import type { DegreeDetail, FacultyProfileFields } from "@/types";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};
const phd: DegreeDetail = {
  course: "", branch: "", institutionName: "IIT Madras", departmentName: "Department of CSE", place: "Chennai",
  percentageCgpa: "", specialization: "ML", status: "AWARDED", yearOfAward: 2012,
};

describe("Ph.D. form: Name of the Department", () => {
  it("is shown for Ph.D. directly before Place, in the form and in the read-only view", () => {
    const form = html(createElement(DegreeFields, { label: "Ph.D. Details", level: "DOCTORAL", value: phd, onChange: noop }));
    expect(form).toContain("Name of the Department");
    expect(form.indexOf("Name of the Department")).toBeLessThan(form.indexOf(">Place<"));
    expect(form.indexOf("Name of the Department")).toBeGreaterThan(form.indexOf("Institution Name"));
    expect(form).toContain("Department of CSE"); // the saved value is what the input shows

    const view = html(createElement(DegreeView, { label: "Ph.D. Details", level: "DOCTORAL", degree: phd }));
    expect(view).toContain("Name of the Department");
    expect(view).toContain("Department of CSE");
    expect(view.indexOf("Name of the Department")).toBeLessThan(view.indexOf("Place"));
  });

  it("is NOT shown for UG, PG or Postdoctoral entries", () => {
    for (const level of ["UG", "PG", "POST_DOCTORAL"] as const) {
      expect(html(createElement(DegreeFields, { label: "x", level, value: { ...phd, departmentName: "should not show" }, onChange: noop }))).not.toContain("Name of the Department");
      expect(html(createElement(DegreeView, { label: "x", level, degree: { ...phd, departmentName: "should not show" } }))).not.toContain("should not show");
    }
  });

  it("an older Ph.D. record (no department) shows an empty field in the form and nothing in the view", () => {
    const old = { ...phd };
    delete old.departmentName;
    expect(html(createElement(DegreeFields, { label: "Ph.D. Details", level: "DOCTORAL", value: old, onChange: noop }))).toContain("Name of the Department");
    expect(html(createElement(DegreeView, { label: "Ph.D. Details", level: "DOCTORAL", degree: old }))).not.toContain("Name of the Department");
  });

  it("a Ph.D. entry that has ONLY a department still counts as having data (the card is shown)", () => {
    const only = { course: "", branch: "", institutionName: "", percentageCgpa: "", departmentName: "Dept of Physics" } as DegreeDetail;
    expect(html(createElement(DegreeView, { label: "Ph.D. Details", level: "DOCTORAL", degree: only }))).toContain("Dept of Physics");
  });

});

describe("experience: Place of the University/College", () => {
  const profile: Partial<FacultyProfileFields> = {
    academicExperience: [{ institutionName: "BITS Pilani", place: "Hyderabad", designation: "Asst Prof", fromDate: "2014-01-01", toDate: "2018-01-01" }],
    industryExperience: [{ institutionName: "TCS", place: "Chennai", designation: "Engineer", fromDate: "2010-01-01", toDate: "2012-01-01" }],
    researchExperience: [{ institutionName: "ISRO", place: "Bengaluru", designation: "Scientist", fromDate: "2012-02-01", toDate: "2013-12-01" }],
  };

  it("the edit form shows it right after Institution Name (Academic tab is the default)", () => {
    const form = html(createElement(ExperienceFields, { value: profile as FacultyProfileFields, onChange: noop }));
    expect(form).toContain("Location of the Institution");
    expect(form.indexOf("Name of the Institution")).toBeLessThan(form.indexOf("Location of the Institution"));
    expect(form.indexOf("Location of the Institution")).toBeLessThan(form.indexOf("Designation"));
    expect(form).toContain("Hyderabad");
  });

  it("the read-only view shows it for Academic, Industry AND Research entries", () => {
    const view = html(createElement(ExperienceModule, { profile }));
    for (const place of ["Hyderabad", "Chennai", "Bengaluru"]) expect(view).toContain(place);
    expect(view.match(/Place of the University\/College/g)?.length).toBe(3);
  });

  it("an older entry (no place) shows no empty Place row in the view", () => {
    const view = html(createElement(ExperienceModule, { profile: { academicExperience: [{ institutionName: "BITS", designation: "Lecturer" }] } }));
    expect(view).toContain("BITS");
    expect(view).not.toContain("Place of the University/College");
  });
});
