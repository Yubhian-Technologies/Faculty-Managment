import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Field of Study / Degree catalogue: Medicine and Law are gone; Pharmaceutical Science and Dental Science are new; UG Management
// and Arts & Science are trimmed; PG Management is MBA / PGDM / MMS / M.Com; Diploma in Pharmacy is a new Intermediate course.
// Nothing stored is touched: a value saved under a former option keeps showing as itself, every other stored value keeps showing
// through the existing "Other + text" path, and nothing is cleared.

const h = vi.hoisted(() => ({ csv: "" }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => null }));
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { SelectItem } from "@/components/ui/select";
import { DegreeFields, DegreeView, EDUCATION_DOMAIN_LABELS, type DegreeLevel } from "@/components/shared/ProfileFieldPrimitives";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { isDiplomaCourse, diplomaBranchPlaceholder } from "@/lib/faculty/schoolCourses";
import type { DegreeDetail, FacultyMember } from "@/types";

const d = (v: Record<string, unknown>) => v as unknown as DegreeDetail;
const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const labels = (m: string) => [...m.matchAll(/<(?:label|p)(?=[\s>])[^>]*>(.*?)<\/(?:label|p)>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").replace(/\s*\*$/, "").trim()).filter(Boolean);

// DegreeFields has no hooks, so it can be called as a function and its element tree inspected / driven.
type El = ReactElement<{ children?: ReactNode; value?: string; onValueChange?: (v: string) => void }>;
const tree = (level: DegreeLevel, value: DegreeDetail, onChange: (v: DegreeDetail) => void = noop) =>
  (DegreeFields as unknown as (p: unknown) => ReactNode)({ label: "x", level, value, onChange });
function findSelect(node: ReactNode, placeholder: string): El | null {
  if (Array.isArray(node)) { for (const n of node) { const r = findSelect(n, placeholder); if (r) return r; } return null; }
  if (!isValidElement(node)) return null;
  const el = node as El;
  const flat = JSON.stringify(el.props, (_k, v) => (typeof v === "function" ? "fn" : isValidElement(v) ? { p: (v as El).props } : v));
  if (typeof el.props.onValueChange === "function" && flat.includes(`"placeholder":"${placeholder}"`)) return el;
  return findSelect(el.props.children, placeholder);
}
function items(node: ReactNode): { value: string; text: string }[] {
  if (Array.isArray(node)) return node.flatMap(items);
  if (!isValidElement(node)) return [];
  const el = node as El;
  const own = el.type === SelectItem ? [{ value: String(el.props.value), text: String(el.props.children) }] : [];
  return [...own, ...items(el.props.children)];
}
const domainOptions = (level: DegreeLevel, value = d({})) => items(findSelect(tree(level, value), level === "DOCTORAL" || level === "POST_DOCTORAL" ? "Select domain" : "Select field of study"));
const courseSelect = (level: DegreeLevel, value: DegreeDetail) => findSelect(tree(level, value), "Select degree");
const degreeOptions = (level: DegreeLevel, domain: string, course = "") => items(courseSelect(level, d({ domain, course }))).map((i) => i.value);

describe("Field of Study list (UG, PG, Ph.D., Post-Doctoral share it)", () => {
  const want = ["MANAGEMENT", "ENGINEERING", "ARTS_SCIENCE", "PHARMACEUTICAL_SCIENCE", "DENTAL_SCIENCE", "OTHERS"];
  it.each(["UG", "PG", "DOCTORAL", "POST_DOCTORAL"] as const)("%s offers the new list without Medicine or Law", (level) => {
    const o = domainOptions(level);
    expect(o.map((x) => x.value)).toEqual(want);
    expect(o.map((x) => x.text)).toEqual(["Management", "Engineering", "Arts and Science", "Pharmaceutical Science", "Dental Science", "Others"]);
  });
  it("the label map has no Medicine / Law", () => {
    expect(Object.keys(EDUCATION_DOMAIN_LABELS)).toEqual(want);
  });
});

describe("UG Degree options", () => {
  it("Management: BBA, BMC, BBM, IPM (BBA+MBA), BHM, B.Com, then Other", () => {
    expect(degreeOptions("UG", "MANAGEMENT")).toEqual(["BBA", "BMC", "BBM", "IPM (BBA+MBA)", "BHM", "B.Com", "Other"]);
  });
  it("Arts and Science: B.A., BFA, BSW, B.Sc., BCA, then Other", () => {
    expect(degreeOptions("UG", "ARTS_SCIENCE")).toEqual(["B.A.", "BFA", "BSW", "B.Sc.", "BCA", "Other"]);
  });
  it("Pharmaceutical Science: B.Pharm; Dental Science: BDS - both still offer Other", () => {
    expect(degreeOptions("UG", "PHARMACEUTICAL_SCIENCE")).toEqual(["B.Pharm", "Other"]);
    expect(degreeOptions("UG", "DENTAL_SCIENCE")).toEqual(["BDS", "Other"]);
  });
  it("Engineering is unchanged and still lists BCA", () => {
    expect(degreeOptions("UG", "ENGINEERING")).toEqual(["B.Tech/BE", "B.Tech - M.Tech Integrated/Dual Degree", "BCA", "Diploma in Engineering", "Other"]);
  });
  it("Others offers only Other", () => {
    expect(degreeOptions("UG", "OTHERS")).toEqual(["Other"]);
  });
});

describe("PG Degree options", () => {
  it("Management: MBA, PGDM, MMS, M.Com, then Other", () => {
    expect(degreeOptions("PG", "MANAGEMENT")).toEqual(["MBA", "PGDM", "MMS", "M.Com", "Other"]);
  });
  it("Pharmaceutical Science: M.Pharm, Pharm.D; Dental Science: MDS - both still offer Other", () => {
    expect(degreeOptions("PG", "PHARMACEUTICAL_SCIENCE")).toEqual(["M.Pharm", "Pharm.D", "Other"]);
    expect(degreeOptions("PG", "DENTAL_SCIENCE")).toEqual(["MDS", "Other"]);
  });
  it("Engineering and Arts and Science are unchanged", () => {
    expect(degreeOptions("PG", "ENGINEERING")).toEqual(["M.Tech/ME", "MCA (2-Year)", "MCA (3-Year)", "MCM", "Other"]);
    expect(degreeOptions("PG", "ARTS_SCIENCE")).toEqual(["M.Sc.", "M.A.", "MS", "M.Ed", "M.Des.", "M.Arch.", "M.F.Tech.", "M.Plan", "MFA", "Other"]);
  });
});

describe("values already saved keep showing as themselves", () => {
  const selected = (level: DegreeLevel, domain: string, course: string) => courseSelect(level, d({ domain, course }))!.props.value;
  it("current options stay normal selections (the stored spellings B.A. and B.Sc., and B.Com under Management)", () => {
    expect(selected("UG", "ARTS_SCIENCE", "B.A.")).toBe("B.A.");
    expect(selected("UG", "ARTS_SCIENCE", "B.Sc.")).toBe("B.Sc.");
    expect(selected("UG", "MANAGEMENT", "B.Com")).toBe("B.Com");
    expect(selected("PG", "MANAGEMENT", "M.Com")).toBe("M.Com");
    expect(selected("UG", "ENGINEERING", "B.Tech/BE")).toBe("B.Tech/BE");
    expect(selected("PG", "ENGINEERING", "M.Tech/ME")).toBe("M.Tech/ME");
  });
  it("a FORMER option stays selectable for that entry only (PG 1-Year / 2-Year MBA, UG IPM)", () => {
    expect(selected("PG", "MANAGEMENT", "2-Year MBA")).toBe("2-Year MBA");
    expect(selected("PG", "MANAGEMENT", "1-Year MBA")).toBe("1-Year MBA");
    expect(degreeOptions("PG", "MANAGEMENT", "2-Year MBA")).toEqual(["MBA", "PGDM", "MMS", "M.Com", "2-Year MBA", "Other"]);
    expect(selected("UG", "MANAGEMENT", "IPM")).toBe("IPM");
    // new entries (or other entries) never see them
    expect(degreeOptions("PG", "MANAGEMENT")).not.toContain("2-Year MBA");
    expect(degreeOptions("PG", "MANAGEMENT", "MBA")).not.toContain("2-Year MBA");
  });
  it("any other stored value (free text, B.Com stored under Arts and Science) shows as Other with its text kept", () => {
    expect(selected("UG", "ARTS_SCIENCE", "B.Com")).toBe("Other");
    expect(selected("PG", "ARTS_SCIENCE", "M.Phil")).toBe("Other");
    const m = html(createElement(DegreeFields, { label: "x", level: "UG", value: d({ domain: "ARTS_SCIENCE", course: "B.Com", institutionName: "X" }), onChange: noop }));
    expect(m).toContain('value="B.Com"');
  });
  it("a stored course is never changed just by opening the form: picking it back reports the same entry", () => {
    let got: DegreeDetail | undefined;
    const sel = findSelect(tree("PG", d({ domain: "MANAGEMENT", course: "2-Year MBA", institutionName: "X", place: "Y" }), (v) => { got = v; }), "Select degree")!;
    sel.props.onValueChange!("2-Year MBA");
    expect(got).toMatchObject({ domain: "MANAGEMENT", course: "2-Year MBA", institutionName: "X", place: "Y" });
  });
  it("a stray stored domain that is no longer in the list (MEDICINE / LAW) is shown as typed, not dropped", () => {
    const m = html(createElement(DegreeFields, { label: "x", level: "UG", value: d({ domain: "MEDICINE", course: "MBBS" }), onChange: noop }));
    expect(m).toContain('value="MEDICINE"');
    expect(html(createElement(DegreeView, { label: "x", level: "UG", degree: d({ domain: "MEDICINE", course: "MBBS" }) }))).toContain("MEDICINE");
  });
});

describe("Specialization box", () => {
  const has = (level: DegreeLevel, domain: string) => labels(html(createElement(DegreeFields, { label: "x", level, value: d({ domain, course: "x" }), onChange: noop }))).includes("Specialization");
  it("hidden for UG Dental Science only", () => {
    expect(has("UG", "DENTAL_SCIENCE")).toBe(false);
    expect(has("PG", "DENTAL_SCIENCE")).toBe(true);
    for (const dom of ["PHARMACEUTICAL_SCIENCE", "MANAGEMENT", "ARTS_SCIENCE", "ENGINEERING", "OTHERS"]) { expect(has("UG", dom)).toBe(true); expect(has("PG", dom)).toBe(true); }
  });
  it("a Specialization stored on a UG Dental entry is not cleared and still shows in the view", () => {
    let got: DegreeDetail | undefined;
    const sel = findSelect(tree("UG", d({ domain: "DENTAL_SCIENCE", course: "BDS", specialization: "Oral Surgery" }), (v) => { got = v; }), "Select degree")!;
    sel.props.onValueChange!("Other");
    expect(got).toMatchObject({ specialization: "Oral Surgery" });
    expect(html(createElement(DegreeView, { label: "x", level: "UG", degree: d({ domain: "DENTAL_SCIENCE", course: "BDS", specialization: "Oral Surgery" }) }))).toContain("Oral Surgery");
  });
});

describe("view labels for the new fields of study", () => {
  it("shows the readable names", () => {
    expect(html(createElement(DegreeView, { label: "x", level: "UG", degree: d({ domain: "PHARMACEUTICAL_SCIENCE", course: "B.Pharm" }) }))).toContain("Pharmaceutical Science");
    expect(html(createElement(DegreeView, { label: "x", level: "PG", degree: d({ domain: "DENTAL_SCIENCE", course: "MDS" }) }))).toContain("Dental Science");
    expect(html(createElement(DegreeView, { label: "x", level: "POST_DOCTORAL", degree: d({ domain: "PHARMACEUTICAL_SCIENCE", institutionName: "X", status: "AWARDED" }) }))).toContain("Pharmaceutical Science");
  });
});

describe("Intermediate / Diploma / ITI: Diploma in Pharmacy", () => {
  const base = { board: "SBTET", institutionName: "Govt Polytechnic", place: "Vijayawada", percentageCgpa: "80", yearOfPassing: 2015, hallTicketNumber: "1", branch: "" };
  it("is a Course option right after Diploma", () => {
    const o = items(findSelect(tree("INTERMEDIATE", d({ ...base, course: "Diploma" })), "Select course")).map((i) => i.value);
    expect(o).toEqual(["Intermediate", "ITI", "Diploma", "Diploma in Pharmacy", "Others"]);
  });
  it("picking it shows the Branch box with the D.Pharm placeholder; Diploma keeps its own placeholder", () => {
    const pharm = html(createElement(DegreeFields, { label: "x", level: "INTERMEDIATE", value: d({ ...base, course: "Diploma in Pharmacy", branch: "D.Pharm" }), onChange: noop }));
    expect(labels(pharm)).toContain("Branch");
    expect(pharm).toContain('placeholder="D.Pharm"');
    expect(pharm).toContain('value="D.Pharm"');
    const dip = html(createElement(DegreeFields, { label: "x", level: "INTERMEDIATE", value: d({ ...base, course: "Diploma" }), onChange: noop }));
    expect(dip).toContain('placeholder="e.g. CIV, EEE, MEC"');
    expect(dip).not.toContain('placeholder="D.Pharm"');
  });
  it("the read-only view shows the Branch of a Diploma in Pharmacy entry", () => {
    expect(html(createElement(DegreeView, { label: "x", level: "INTERMEDIATE", degree: d({ ...base, course: "Diploma in Pharmacy", branch: "D.Pharm" }) }))).toContain(">Branch<");
  });
  it("helper recognises exactly the two diploma courses", () => {
    expect(isDiplomaCourse("Diploma")).toBe(true);
    expect(isDiplomaCourse("Diploma in Pharmacy")).toBe(true);
    for (const c of ["Intermediate", "ITI", "Others", "", undefined, null, "Diploma in Engineering"]) expect(isDiplomaCourse(c as string)).toBe(false);
    expect(diplomaBranchPlaceholder("Diploma in Pharmacy")).toBe("D.Pharm");
  });
  describe("CSV export", () => {
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
    it("exports the Branch of a Diploma in Pharmacy entry, and still of a plain Diploma", () => {
      exportFacultyCsv([faculty({ intermediateDiplomaIti: d({ ...base, course: "Diploma in Pharmacy", branch: "D.Pharm" }) })], {}, ["intermediateDiplomaIti"]);
      expect(cell("Intermediate / Diploma / ITI")).toContain("Course: Diploma in Pharmacy | Subject:  | Branch: D.Pharm | Trade: ");
      exportFacultyCsv([faculty({ intermediateDiplomaIti: d({ ...base, course: "Diploma", branch: "CIV" }) })], {}, ["intermediateDiplomaIti"]);
      expect(cell("Intermediate / Diploma / ITI")).toContain("Course: Diploma | Subject:  | Branch: CIV | Trade: ");
    });
  });
});
