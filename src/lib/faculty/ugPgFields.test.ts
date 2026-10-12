import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// UG / PG Details: "Course" is now labelled "Degree", "Branch" is "Course/Branch", the B.Tech-or-BE picker reads
// "Select type of degree", and a Specialization field follows Course/Branch. Wording only - the stored keys
// (course, degreeType, branch) are unchanged and Specialization is stored as `specialization`, so every record that is
// already saved keeps its data. Postdoctoral, Ph.D. and the school levels are not touched by this change.

const h = vi.hoisted(() => ({ csv: "" }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => null }));
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { EXPORT_FIELDS, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { degreeTypeError } from "@/lib/faculty/degreeType";
import { academicProfileFirestoreUpdates, applyAcademicProfileChanges, diffAcademicProfile } from "@/lib/faculty/academicProfileChanges";
import { getResumeHTML } from "@/lib/pdf/resumeTemplate";
import { DegreeFields, DegreeView, hasDegreeData } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail, FacultyMember } from "@/types";

const SPEC = "Power Electronics and Drives";
const pg = {
  domain: "ENGINEERING", course: "M.Tech/ME", degreeType: "M.Tech", branch: "EEE", institutionName: "National Institute of Technology",
  institutionType: "INSTITUTE", affiliatedUniversity: "NIT", place: "Warangal", percentageCgpa: "80.8", yearOfPassing: 2015, hallTicketNumber: "13761D2105",
} as unknown as DegreeDetail;
const ug = { ...pg, course: "B.Tech/BE", degreeType: "B.Tech", institutionName: "SCRK", place: "Chilakaluripet" } as unknown as DegreeDetail;
const withSpec = (d: DegreeDetail) => ({ ...d, specialization: SPEC }) as DegreeDetail;

const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const form = (level: "UG" | "PG" | "DOCTORAL" | "POST_DOCTORAL", value: DegreeDetail) => html(createElement(DegreeFields, { label: "x", level, value, onChange: noop }));
const view = (level: "UG" | "PG" | "DOCTORAL" | "POST_DOCTORAL", degree: DegreeDetail) => html(createElement(DegreeView, { label: "x", level, degree }));
// Visible label / caption texts in document order (tags inside a label, such as the required-star span, are stripped).
const labels = (markup: string) => [...markup.matchAll(/<(?:label|p)(?=[\s>])[^>]*>(.*?)<\/(?:label|p)>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").replace(/\s*\*$/, "").trim()).filter(Boolean);
const group = (key: string) => EXPORT_FIELDS.find((f) => f.key === key) as ExportGroupField;

describe("form (Add / Edit)", () => {
  it.each(["UG", "PG"] as const)("%s: Degree, type-of-degree picker, Course/Branch, then Specialization", (level) => {
    const m = form(level, level === "UG" ? ug : pg);
    const l = labels(m);
    expect(l).toContain("Degree");
    expect(l).toContain("Select type of degree");
    expect(l).toContain("Course/Branch");
    expect(l).toContain("Specialization");
    expect(l).not.toContain("Course");
    expect(l).not.toContain("Branch");
    expect(l.indexOf("Course/Branch")).toBeLessThan(l.indexOf("Specialization"));
    expect(l.indexOf("Specialization")).toBeLessThan(l.indexOf("Institution Type"));
  });
  it("keeps showing what is already saved (stored keys unchanged)", () => {
    const m = form("PG", withSpec(pg));
    expect(m).toContain('value="EEE"');
    expect(m).toContain(`value="${SPEC}"`);
    expect(m).toContain('value="National Institute of Technology"');
  });
  it("Postdoctoral / Ph.D. forms keep their own wording", () => {
    for (const level of ["DOCTORAL", "POST_DOCTORAL"] as const) {
      const l = labels(form(level, { ...pg, status: "AWARDED" } as DegreeDetail));
      expect(l).not.toContain("Select type of degree");
      expect(l).not.toContain("Course/Branch");
    }
    // Post-Doctoral now mirrors Ph.D.: no Course / Branch, a Name of the Department instead.
    const post = labels(form("POST_DOCTORAL", pg));
    expect(post).not.toContain("Branch");
    expect(post).not.toContain("Course");
    expect(post).toContain("Name of the Department");
  });
});

describe("read-only view", () => {
  it.each(["UG", "PG"] as const)("%s: shows Degree, Type of Degree, Course/Branch, Specialization in that order", (level) => {
    const m = view(level, withSpec(level === "UG" ? ug : pg));
    const order = ["Degree", "Type of Degree", "Course/Branch", "Specialization"].map((t) => m.indexOf(`>${t}<`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(m).toContain(SPEC);
    expect(m).not.toContain(">Course<");
    expect(m).not.toContain(">Branch<");
  });
  it("an entry saved before Specialization existed shows no empty Specialization row", () => {
    const m = view("PG", pg);
    expect(m).toContain("Course/Branch");
    expect(m).not.toContain(">Specialization<");
    expect(m).toContain("EEE");
  });
  it("a specialization-only UG/PG entry still counts as having data", () => {
    expect(hasDegreeData({ specialization: SPEC } as DegreeDetail, "PG")).toBe(true);
  });
  it("Ph.D. and school views are unchanged", () => {
    expect(view("DOCTORAL", { specialization: "ML", institutionName: "IIT", status: "AWARDED" } as DegreeDetail)).toContain(">Specialization<");
    const post = view("POST_DOCTORAL", { branch: "Materials", institutionName: "X", status: "AWARDED" } as DegreeDetail);
    expect(post).not.toContain(">Branch<");
    expect(post).toContain(">Name of the Department<"); // a stored Branch shows as the department
    expect(post).toContain("Materials");
  });
});

describe("validation message wording (same rules)", () => {
  it("still requires the type of degree for B.Tech/BE and M.Tech/ME, with the new wording", () => {
    const m = degreeTypeError({ ugDetails: { ...ug, degreeType: undefined } });
    expect(m).toContain("Select type of degree (B.Tech or BE)");
    expect(m).toContain("is required when Degree is B.Tech/BE");
    expect(degreeTypeError({ pgDetails: { ...pg, degreeType: undefined } })).toContain("M.Tech or ME");
    expect(degreeTypeError({ ugDetails: { ...ug, course: "BBA", degreeType: "BE" } as DegreeDetail })).toContain("Type of degree is only applicable");
    expect(degreeTypeError({ ugDetails: ug, pgDetails: pg })).toBeNull();
  });
});

describe("save path stores the new key without disturbing anything else", () => {
  it("adding a specialization changes only that UG/PG entry, and every other value is kept", () => {
    const before = { ugDetails: ug, pgDetails: pg, additionalPgDetails: [pg] };
    const after = { ...before, pgDetails: withSpec(pg) };
    const changes = diffAcademicProfile(before, after);
    expect(Object.keys(changes.set)).toEqual(["pgDetails"]);
    const updates = academicProfileFirestoreUpdates(before, changes, "DELETE");
    expect(updates["academicProfile.pgDetails"]).toEqual({ ...pg, specialization: SPEC });
    expect(Object.keys(updates)).not.toContain("academicProfile.ugDetails");
    expect(Object.keys(updates)).not.toContain("academicProfile.additionalPgDetails");
    expect((applyAcademicProfileChanges(before, changes) as typeof after).pgDetails.specialization).toBe(SPEC);
  });
  it("an additional UG/PG entry's specialization is stored on its list", () => {
    const before = { additionalUgDetails: [ug] };
    const after = { additionalUgDetails: [withSpec(ug)] };
    expect(academicProfileFirestoreUpdates(before, diffAcademicProfile(before, after), "DELETE")["academicProfile.additionalUgDetails"]).toEqual([{ ...ug, specialization: SPEC }]);
  });
});

describe("faculty CSV export", () => {
  const faculty = (ap: unknown) => ({ id: "f1", employeeId: "EMP1", legalName: "Dr X", academicProfile: ap }) as unknown as FacultyMember;
  const cell = (header: string) => {
    const rows: string[][] = [];
    let row: string[] = [], cur = "", q = false;
    for (let i = 0; i < h.csv.length; i++) {
      const c = h.csv[i];
      if (q) { if (c === '"' && h.csv[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows[1][rows[0].indexOf(header)];
  };
  beforeEach(() => { h.csv = ""; });

  it("UG and PG columns use the new names, Specialization right after Course/Branch", () => {
    for (const key of ["ugDetailsGroup", "pgDetailsGroup"]) {
      const l = group(key).subFieldLabels;
      expect(l.slice(0, 4)).toEqual(["Degree", "Type of Degree", "Course/Branch", "Specialization"]);
      expect(l).not.toContain("Course");
      expect(l).not.toContain("Branch");
    }
  });
  it("exports the saved values, the new Specialization, and stays blank for an older entry", () => {
    exportFacultyCsv([faculty({ ugDetails: ug, pgDetails: withSpec(pg), additionalPgDetails: [pg] })], {}, ["ugDetailsGroup", "pgDetailsGroup"]);
    expect(cell("UG Details")).toContain("Degree: B.Tech/BE | Type of Degree: B.Tech | Course/Branch: EEE | Specialization:  | Institution Name: SCRK");
    const pgCell = cell("PG Details");
    expect(pgCell).toContain(`Course/Branch: EEE | Specialization: ${SPEC} | Institution Name: National Institute of Technology`);
    expect(pgCell).toContain("Specialization:  | Institution Name:");
  });
  it("the Ph.D. and Postdoctoral columns are unchanged", () => {
    expect(group("phdDetailsGroup").subFieldLabels[0]).toBe("Specialization");
    expect(group("postdoctoralFellowshipDetailsGroup").subFieldLabels[0]).toBe("Specialization");
  });
});

describe("PDF resume and public profile", () => {
  it("the resume adds the Specialization after Course/Branch for UG/PG, and is unchanged without one", () => {
    const withIt = getResumeHTML({ name: "Dr X", academicProfile: { pgDetails: withSpec(pg), ugDetails: ug } } as never);
    expect(withIt).toContain(`M.Tech/ME (M.Tech) EEE ${SPEC}`);
    expect(withIt).toContain("B.Tech/BE (B.Tech) EEE");
    expect(withIt).not.toContain("B.Tech/BE (B.Tech) EEE undefined");
  });
});
