import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Secondary Education: "School Name". Intermediate / Diploma / ITI: "College Name" plus, right after Course, an optional
// free-text Subject (Intermediate) / Branch (Diploma, the existing `branch` key) / Trade (ITI, new `trade` key). UG / PG:
// "Domain" is labelled "Field of Study". Labels and two new optional keys only - every stored key and value is unchanged,
// and a value typed under one course is never cleared when the course is changed.

const h = vi.hoisted(() => ({ csv: "" }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => null }));
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { EXPORT_FIELDS, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { academicProfileFirestoreUpdates, diffAcademicProfile } from "@/lib/faculty/academicProfileChanges";
import { DegreeFields, DegreeView, hasDegreeData, type DegreeLevel } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail, FacultyMember } from "@/types";

const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const d = (v: Record<string, unknown>) => v as unknown as DegreeDetail;
const form = (level: DegreeLevel, value: DegreeDetail) => html(createElement(DegreeFields, { label: "x", level, value, onChange: noop }));
const view = (level: DegreeLevel, degree: DegreeDetail) => html(createElement(DegreeView, { label: "x", level, degree }));
const labels = (m: string) => [...m.matchAll(/<(?:label|p)(?=[\s>])[^>]*>(.*?)<\/(?:label|p)>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").replace(/\s*\*$/, "").trim()).filter(Boolean);
const group = (key: string) => EXPORT_FIELDS.find((f) => f.key === key) as ExportGroupField;

// Shapes found in the live data (153 Intermediate, 23 Diploma, 0 ITI, plus free-text courses typed by people).
const base = { board: "Board of Intermediate Education, A.P.", institutionName: "Gayatri Junior College", place: "Kakinada", percentageCgpa: "73.9", yearOfPassing: 2004, hallTicketNumber: "4071419", certificateUrl: "https://example.com/c.pdf", branch: "" };
const INTERMEDIATE = d({ ...base, course: "Intermediate" });
const DIPLOMA = d({ ...base, course: "Diploma" });
const ITI = d({ ...base, course: "ITI" });
const FREE_TEXT = [d({ ...base, course: "M P.C." }), d({ ...base, course: "Pre University Course (PUC), M.Bi.P.C group" }), d({ ...base, course: "HSSC" }), d({ ...base, course: "Others" }), d({ ...base, course: "" })];
const SECONDARY = d({ course: "SSC", board: "Board of Secondary Education, Andhra Pradesh", institutionName: "Z P High School", place: "Appanapalli", percentageCgpa: "80.6", yearOfPassing: 2002, hallTicketNumber: "0231326", certificateUrl: "https://example.com/c.pdf" });

describe("Secondary Education - School Name", () => {
  it("form and view say School Name (not Institution Name); the stored value is shown unchanged", () => {
    const f = form("HIGH_SCHOOL", SECONDARY);
    expect(labels(f)).toContain("School Name");
    expect(labels(f)).not.toContain("Institution Name");
    expect(f).toContain('value="Z P High School"');
    const v = view("HIGH_SCHOOL", SECONDARY);
    expect(v).toContain(">School Name<");
    expect(v).not.toContain(">Institution Name<");
    expect(v).toContain("Z P High School");
  });
  it("Secondary has no Subject / Branch / Trade field", () => {
    const l = labels(form("HIGH_SCHOOL", SECONDARY));
    for (const x of ["Subject", "Branch", "Trade"]) expect(l).not.toContain(x);
  });
});

describe("Intermediate / Diploma / ITI form", () => {
  it.each([
    ["Intermediate", INTERMEDIATE, "Subject"],
    ["Diploma", DIPLOMA, "Branch"],
    ["ITI", ITI, "Trade"],
  ] as const)("%s: College Name, and %s right after Course (before Board), nothing else added", (_c, deg, field) => {
    const l = labels(form("INTERMEDIATE", deg));
    expect(l).toContain("College Name");
    expect(l).not.toContain("Institution Name");
    expect(l.indexOf(field)).toBe(l.indexOf("Course") + 1);
    expect(l.indexOf(field)).toBeLessThan(l.indexOf("Board"));
    for (const other of ["Subject", "Branch", "Trade"].filter((x) => x !== field)) expect(l).not.toContain(other);
  });
  it("shows the stored value of the field that applies (Branch for Diploma is the existing `branch` key)", () => {
    expect(form("INTERMEDIATE", d({ ...INTERMEDIATE, subject: "M.P.C" }))).toContain('value="M.P.C"');
    expect(form("INTERMEDIATE", d({ ...DIPLOMA, branch: "CIV" }))).toContain('value="CIV"');
    expect(form("INTERMEDIATE", d({ ...ITI, trade: "Fitter" }))).toContain('value="Fitter"');
  });
  it("Others, a blank course and the free-text courses already in the data get no extra field and render as before", () => {
    for (const deg of FREE_TEXT) {
      const m = form("INTERMEDIATE", deg);
      const l = labels(m);
      for (const x of ["Subject", "Branch", "Trade"]) expect(l).not.toContain(x);
      expect(l).toContain("College Name");
      expect(m).toContain('value="Gayatri Junior College"');
      expect(m).toContain('value="4071419"');
    }
  });
  it("a Subject is an optional free-text box: an entry saved without one still shows an empty box", () => {
    const m = form("INTERMEDIATE", INTERMEDIATE);
    expect(labels(m)).toContain("Subject");
    expect(m).toContain('placeholder="e.g. M.P.C, Bi.P.C"');
    expect(m).not.toMatch(/Subject<span/); // no required marker
  });
});

describe("Intermediate / Diploma / ITI read-only view", () => {
  it("shows College Name and only the field that matches the course, only when it has a value", () => {
    const v1 = view("INTERMEDIATE", d({ ...INTERMEDIATE, subject: "Bi.P.C" }));
    expect(v1).toContain(">College Name<");
    expect(v1).toContain(">Subject<");
    expect(v1).toContain("Bi.P.C");
    expect(view("INTERMEDIATE", d({ ...DIPLOMA, branch: "EEE" }))).toContain(">Branch<");
    expect(view("INTERMEDIATE", d({ ...ITI, trade: "Electrician" }))).toContain(">Trade<");
    // nothing entered -> no empty row (all 180 existing entries look exactly as before)
    const none = view("INTERMEDIATE", INTERMEDIATE);
    for (const x of [">Subject<", ">Branch<", ">Trade<"]) expect(none).not.toContain(x);
  });
  it("a value left from an earlier course is kept but not shown under the new course", () => {
    const stale = d({ ...DIPLOMA, branch: "CIV", subject: "M.P.C", trade: "Fitter" });
    const v = view("INTERMEDIATE", stale);
    expect(v).toContain("CIV");
    expect(v).not.toContain("M.P.C");
    expect(v).not.toContain("Fitter");
  });
  it("a Subject-only / Trade-only entry still counts as having data", () => {
    expect(hasDegreeData(d({ subject: "M.P.C" }), "INTERMEDIATE")).toBe(true);
    expect(hasDegreeData(d({ trade: "Fitter" }), "INTERMEDIATE")).toBe(true);
  });
});

// ---- real interaction: change the Course dropdown and see what the form hands to onChange ------------------------
type AnyEl = ReactElement<{ children?: unknown; onValueChange?: (v: string) => void }>;
function selectOnChange(el: unknown, placeholder: string): ((v: string) => void) | null {
  // DegreeFields has no hooks, so it can be called as a plain function and its element tree walked.
  const walk = (node: unknown): ((v: string) => void) | null => {
    if (!isValidElement(node)) return Array.isArray(node) ? (node.map(walk).find(Boolean) ?? null) : null;
    const n = node as AnyEl;
    const flat = JSON.stringify(n.props, (_k, v) => (typeof v === "function" ? "fn" : isValidElement(v) ? { t: "el", p: (v as AnyEl).props } : v));
    if (typeof n.props.onValueChange === "function" && flat.includes(placeholder)) return n.props.onValueChange;
    return walk(n.props.children);
  };
  return walk(el);
}
describe("changing the course never clears previously entered values", () => {
  const saved = d({ ...INTERMEDIATE, course: "Diploma", subject: "M.P.C", branch: "CIV", trade: "Fitter" });
  it.each(["Intermediate", "ITI", "Diploma", "Others"])("switching the Course to %s keeps subject, branch and trade", (next) => {
    let got: DegreeDetail | undefined;
    const el = (DegreeFields as unknown as (p: unknown) => unknown)({ label: "x", level: "INTERMEDIATE", value: saved, onChange: (v: DegreeDetail) => { got = v; } });
    const onCourse = selectOnChange(el, "Select course");
    expect(onCourse).toBeTruthy();
    onCourse!(next);
    expect(got).toMatchObject({ course: next, subject: "M.P.C", branch: "CIV", trade: "Fitter", institutionName: "Gayatri Junior College", hallTicketNumber: "4071419", certificateUrl: "https://example.com/c.pdf" });
  });
});

describe("UG / PG - Field of Study (stored key `domain` unchanged)", () => {
  const ug = d({ domain: "ENGINEERING", course: "B.Tech/BE", degreeType: "B.Tech", branch: "EEE", institutionName: "X", place: "Y", percentageCgpa: "8", yearOfPassing: 2013 });
  it.each(["UG", "PG"] as const)("%s form and view say Field of Study", (level) => {
    const f = labels(form(level, ug));
    expect(f).toContain("Field of Study");
    expect(f).not.toContain("Domain");
    const v = view(level, ug);
    expect(v).toContain(">Field of Study<");
    expect(v).toContain("Engineering"); // the stored code still shows its readable name
    expect(v).not.toContain(">Domain<");
  });
  it("stored free-text values still display", () => {
    expect(view("UG", d({ ...ug, domain: "B.Sc" }))).toContain("B.Sc");
    expect(view("PG", d({ ...ug, domain: "MSC" }))).toContain("MSC");
  });
  it("Ph.D. and Post-Doctoral also say Field of Study (same stored key `domain`)", () => {
    const doc = d({ domain: "ENGINEERING", specialization: "ML", institutionName: "IIT", status: "AWARDED" });
    for (const level of ["DOCTORAL", "POST_DOCTORAL"] as const) {
      expect(labels(form(level, doc))).toContain("Field of Study");
      expect(labels(form(level, doc))).not.toContain("Domain");
      expect(view(level, doc)).toContain(">Field of Study<");
      expect(view(level, doc)).not.toContain(">Domain<");
    }
  });
});

describe("save path", () => {
  it("adding a Subject / Branch / Trade changes only the Intermediate entry and keeps every other value", () => {
    const profile = { secondaryEducation: SECONDARY, intermediateDiplomaIti: INTERMEDIATE, ugDetails: d({ course: "BBA", institutionName: "U" }) };
    for (const [field, extra] of [["subject", { subject: "M.P.C" }], ["trade", { trade: "Fitter" }]] as const) {
      const after = { ...profile, intermediateDiplomaIti: { ...INTERMEDIATE, ...extra } };
      const changes = diffAcademicProfile(profile, after);
      expect(Object.keys(changes.set)).toEqual(["intermediateDiplomaIti"]);
      const upd = academicProfileFirestoreUpdates(profile, changes, "DELETE");
      expect(upd["academicProfile.intermediateDiplomaIti"]).toEqual({ ...INTERMEDIATE, [field]: Object.values(extra)[0] });
      expect(Object.keys(upd)).not.toContain("academicProfile.secondaryEducation");
      expect(Object.keys(upd)).not.toContain("academicProfile.ugDetails");
    }
  });
  it("Diploma Branch is stored in the existing `branch` key", () => {
    const before = { intermediateDiplomaIti: DIPLOMA };
    const after = { intermediateDiplomaIti: { ...DIPLOMA, branch: "MEC" } };
    expect(academicProfileFirestoreUpdates(before, diffAcademicProfile(before, after), "DELETE")["academicProfile.intermediateDiplomaIti"]).toMatchObject({ course: "Diploma", branch: "MEC", institutionName: "Gayatri Junior College" });
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

  it("column names: Secondary has School Name; Intermediate has Subject, Branch, Trade after Course and College Name", () => {
    expect(group("secondaryEducation").subFieldLabels).toEqual(["Course", "Board", "School Name", "Percentage / CGPA", "Year of Passing", "Place", "Hall Ticket Number"]);
    expect(group("intermediateDiplomaIti").subFieldLabels).toEqual(["Course", "Subject", "Branch", "Trade", "Board", "College Name", "Percentage / CGPA", "Year of Passing", "Place", "Hall Ticket Number"]);
  });
  it("exports each course's own field in its own column, with every existing value in place", () => {
    const run = (deg: DegreeDetail) => { exportFacultyCsv([faculty({ secondaryEducation: SECONDARY, intermediateDiplomaIti: deg })], {}, ["secondaryEducation", "intermediateDiplomaIti"]); return cell("Intermediate / Diploma / ITI"); };
    expect(run(d({ ...INTERMEDIATE, subject: "M.P.C" }))).toContain("Course: Intermediate | Subject: M.P.C | Branch:  | Trade:  | Board: Board of Intermediate Education, A.P. | College Name: Gayatri Junior College");
    expect(run(d({ ...DIPLOMA, branch: "CIV" }))).toContain("Course: Diploma | Subject:  | Branch: CIV | Trade:  | Board:");
    expect(run(d({ ...ITI, trade: "Fitter" }))).toContain("Course: ITI | Subject:  | Branch:  | Trade: Fitter | Board:");
    expect(cell("Secondary Education")).toContain("School Name: Z P High School");
    expect(cell("Intermediate / Diploma / ITI")).toContain("Hall Ticket Number: 4071419");
  });
  it("a value left over from an earlier course is not exported under the wrong course", () => {
    exportFacultyCsv([faculty({ intermediateDiplomaIti: d({ ...DIPLOMA, branch: "CIV", subject: "M.P.C", trade: "Fitter" }) })], {}, ["intermediateDiplomaIti"]);
    expect(cell("Intermediate / Diploma / ITI")).toContain("Subject:  | Branch: CIV | Trade: ");
    expect(cell("Intermediate / Diploma / ITI")).not.toContain("M.P.C");
  });
  it("an entry with only a free-text course (as in the live data) exports as before with blank new columns", () => {
    exportFacultyCsv([faculty({ intermediateDiplomaIti: FREE_TEXT[0] })], {}, ["intermediateDiplomaIti"]);
    expect(cell("Intermediate / Diploma / ITI")).toContain("Course: M P.C. | Subject:  | Branch:  | Trade:  | Board:");
  });
});
