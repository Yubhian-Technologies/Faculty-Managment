import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import {
  collegeTypeLabel, institutionTypeLabel, universityTypeLabel, withInstitutionType, withUniversityType,
} from "@/lib/faculty/institutionType";
import { degreeHasData } from "@/lib/faculty/degreeHasData";
import { diffAcademicProfile } from "@/lib/faculty/academicProfileChanges";
import { DegreeFields, DegreeView } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail } from "@/types";

// "Institution Type" on UG / PG / Ph.D. / Post-Doctoral: Institute is now shown as "Affiliated College" (stored value
// unchanged), College Type / University Type follow it, and an optional "Additional Information (if any)" follows Hall
// Ticket Number. Everything is additive - a record saved before this has none of the new keys and must read as before.

const OLD_UG = {
  domain: "ENGINEERING", course: "B.Tech/BE", degreeType: "B.Tech", branch: "CSE", institutionType: "INSTITUTE",
  institutionName: "SCRK", affiliatedUniversity: "JNTUK", place: "Chilakaluripet", percentageCgpa: "80", yearOfPassing: 2010, hallTicketNumber: "H1",
} as unknown as DegreeDetail;
const OLD_PHD = { institutionName: "IIT Madras", departmentName: "CSE", place: "Chennai", specialization: "ML", status: "AWARDED", yearOfAward: 2012 } as DegreeDetail;

const noop = () => {};
type Level = "UG" | "PG" | "DOCTORAL" | "POST_DOCTORAL";
const form = (level: Level, value: DegreeDetail) => renderToStaticMarkup(createElement(DegreeFields, { label: "x", level, value, onChange: noop }));
const view = (level: Level, degree: DegreeDetail) => renderToStaticMarkup(createElement(DegreeView, { label: "x", level, degree }));
const labels = (m: string) => [...m.matchAll(/<(?:label|p)(?=[\s>])[^>]*>(.*?)<\/(?:label|p)>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").replace(/\s*\*$/, "").trim()).filter(Boolean);

describe("labels", () => {
  it("INSTITUTE is shown as Affiliated College, UNIVERSITY as University; nothing else", () => {
    expect(institutionTypeLabel("INSTITUTE")).toBe("Affiliated College");
    expect(institutionTypeLabel("UNIVERSITY")).toBe("University");
    expect(institutionTypeLabel(undefined)).toBeUndefined();
    expect(collegeTypeLabel("AUTONOMOUS")).toBe("Autonomous College");
    expect(collegeTypeLabel("NON_AUTONOMOUS")).toBe("Non-Autonomous College");
  });
  it("University Type: fixed choices by label, Others shows what was typed", () => {
    expect(universityTypeLabel({ universityType: "STATE" })).toBe("State University");
    expect(universityTypeLabel({ universityType: "DEEMED" })).toBe("Deemed to be University");
    expect(universityTypeLabel({ universityType: "IIIT" })).toBe("IIIT");
    expect(universityTypeLabel({ universityType: "OTHERS", universityTypeOther: " Central University " })).toBe("Central University");
    expect(universityTypeLabel({ universityType: "OTHERS" })).toBe("Others");
    expect(universityTypeLabel({})).toBeUndefined();
  });
});

describe("switching the type only touches the new keys", () => {
  it("Affiliated College -> University drops College Type, keeps every older field", () => {
    const v = { ...OLD_UG, collegeType: "AUTONOMOUS" } as DegreeDetail;
    const next = withInstitutionType(v, "UNIVERSITY");
    expect(next).toEqual({ ...OLD_UG, institutionType: "UNIVERSITY" });
    expect("collegeType" in next).toBe(false);
  });
  it("University -> Affiliated College drops University Type and its Others text", () => {
    const v = { ...OLD_UG, institutionType: "UNIVERSITY", universityType: "OTHERS", universityTypeOther: "x" } as DegreeDetail;
    const next = withInstitutionType(v, "INSTITUTE");
    expect("universityType" in next || "universityTypeOther" in next).toBe(false);
    expect(next.institutionName).toBe("SCRK");
    expect(next.affiliatedUniversity).toBe("JNTUK");
  });
  it("re-picking the same type changes nothing; leaving Others clears the typed text", () => {
    expect(withInstitutionType(OLD_UG, "INSTITUTE")).toBe(OLD_UG);
    const o = withUniversityType({ ...OLD_UG, institutionType: "UNIVERSITY" } as DegreeDetail, "OTHERS");
    const typed = { ...o, universityTypeOther: "Open University" } as DegreeDetail;
    expect(withUniversityType(typed, "STATE")).toEqual({ ...o, universityType: "STATE" });
    expect(Object.values(withUniversityType(typed, "STATE")).includes(undefined)).toBe(false);
  });
});

describe.each(["UG", "PG", "DOCTORAL", "POST_DOCTORAL"] as const)("%s form", (level) => {
  const base = level === "UG" || level === "PG" ? OLD_UG : OLD_PHD;
  it("Institution Type offers Affiliated College / University", () => {
    const m = form(level, base);
    expect(labels(m)).toContain("Institution Type");
    expect(m).not.toContain(">Institute<");
  });
  it("Affiliated College shows College Type; University shows University Type, never both", () => {
    const col = labels(form(level, { ...base, institutionType: "INSTITUTE" } as DegreeDetail));
    expect(col).toContain("College Type");
    expect(col).not.toContain("University Type");
    const uni = labels(form(level, { ...base, institutionType: "UNIVERSITY" } as DegreeDetail));
    expect(uni).toContain("University Type");
    expect(uni).not.toContain("College Type");
    const none = labels(form(level, { ...base, institutionType: undefined } as DegreeDetail));
    expect(none).not.toContain("College Type");
    expect(none).not.toContain("University Type");
  });
  it("Others shows a text box holding the typed value", () => {
    const m = form(level, { ...base, institutionType: "UNIVERSITY", universityType: "OTHERS", universityTypeOther: "Central University" } as DegreeDetail);
    expect(m).toContain('value="Central University"');
    expect(m).toContain("Please specify university type");
    expect(form(level, { ...base, institutionType: "UNIVERSITY", universityType: "IIT" } as DegreeDetail)).not.toContain("Please specify university type");
  });
  it("Additional Information (if any) comes right after Hall Ticket Number, and is not required", () => {
    const m = form(level, base);
    const l = labels(m);
    expect(l.indexOf("Additional Information (if any)")).toBe(l.indexOf("Hall Ticket Number") + 1);
    expect(m).not.toMatch(/Additional Information \(if any\)<span[^>]*> \*/);
  });
  it("Affiliated University (already stored on ~485 entries) is still shown and kept", () => {
    if (level !== "UG" && level !== "PG") return;
    expect(form(level, OLD_UG)).toContain('value="JNTUK"');
  });
});

describe("old records without the new keys", () => {
  it("UG view shows the old values, Affiliated College as the type, and no empty new rows", () => {
    const m = view("UG", OLD_UG);
    expect(m).toContain("Affiliated College");
    expect(m).toContain("SCRK");
    expect(m).toContain("JNTUK");
    expect(m).not.toContain(">College Type<");
    expect(m).not.toContain(">Additional Information");
  });
  it("Ph.D. / Postdoc view of an old entry shows no Institution Type row at all", () => {
    for (const level of ["DOCTORAL", "POST_DOCTORAL"] as const) {
      const m = view(level, OLD_PHD);
      expect(m).not.toContain(">Institution Type<");
      expect(m).toContain("IIT Madras");
    }
  });
  it("new values show in the view; the University Type 'Others' text replaces the word Others", () => {
    const m = view("PG", { ...OLD_UG, institutionType: "UNIVERSITY", universityType: "OTHERS", universityTypeOther: "Central University", additionalInformation: "Lateral entry" } as DegreeDetail);
    expect(m).toContain(">University Type<");
    expect(m).toContain("Central University");
    expect(m).toContain(">Additional Information (if any)<");
    expect(m).toContain("Lateral entry");
    const col = view("UG", { ...OLD_UG, collegeType: "NON_AUTONOMOUS" } as DegreeDetail);
    expect(col).toContain("Non-Autonomous College");
  });
  it("an entry holding only Additional Information counts as having data", () => {
    expect(degreeHasData({ additionalInformation: "x" } as DegreeDetail, "PG")).toBe(true);
    expect(degreeHasData({ additionalInformation: "  " } as DegreeDetail, "PG")).toBe(false);
  });
  it("saving an old entry untouched produces no change to save", () => {
    const profile = { ugDetails: OLD_UG, phdDetails: OLD_PHD };
    expect(diffAcademicProfile(profile, JSON.parse(JSON.stringify(profile)))).toEqual({ set: {}, remove: [] });
  });
});

describe.each(["UG", "PG", "DOCTORAL", "POST_DOCTORAL"] as const)("%s institution name label", (level) => {
  const base = level === "UG" || level === "PG" ? OLD_UG : OLD_PHD;
  const typed = (t: DegreeDetail["institutionType"]) => ({ ...base, institutionType: t }) as DegreeDetail;
  it("University -> 'University/Institution Name' in the form and the view; the value shown is the stored institutionName", () => {
    const f = labels(form(level, typed("UNIVERSITY")));
    expect(f).toContain("University/Institution Name");
    expect(f).not.toContain("Institution Name");
    expect(form(level, typed("UNIVERSITY"))).toContain(`value="${base.institutionName}"`);
    const v = view(level, typed("UNIVERSITY"));
    expect(v).toContain(">University/Institution Name<");
    expect(v).toContain(base.institutionName);
  });
  it("Affiliated College, nothing picked, and old records keep 'Institution Name'", () => {
    for (const t of ["INSTITUTE", undefined] as const) {
      const f = labels(form(level, typed(t)));
      expect(f).toContain("Institution Name");
      expect(f).not.toContain("University/Institution Name");
      expect(view(level, typed(t))).not.toContain("University/Institution Name");
    }
  });
  it("the label follows the picker and the stored name survives switching back and forth", () => {
    const uni = withInstitutionType(base, "UNIVERSITY");
    const back = withInstitutionType(uni, "INSTITUTE");
    expect(uni.institutionName).toBe(base.institutionName);
    expect(back.institutionName).toBe(base.institutionName);
    expect(labels(form(level, uni))).toContain("University/Institution Name");
    expect(labels(form(level, back))).toContain("Institution Name");
  });
});
