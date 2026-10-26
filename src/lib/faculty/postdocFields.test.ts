import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Postdoctoral Fellowship Details now mirror Ph.D. Details (Status, Mode, Domain, Specialization, Institution Name,
// Name of the Department, Title of the Postdoc Thesis, Place, Percentage / CGPA, Year of Registration, Year of Award or
// Guide, Hall Ticket). Course is no longer shown; the old Branch is shown as the department. Ph.D. gains Percentage / CGPA
// after Place. Nothing stored is removed - the tests below use the shapes found in the live VIT data.

const h = vi.hoisted(() => ({ csv: "" }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => null }));
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { EXPORT_FIELDS, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { degreeHasData } from "@/lib/faculty/degreeHasData";
import { academicProfileFirestoreUpdates, diffAcademicProfile } from "@/lib/faculty/academicProfileChanges";
import { DegreeFields, DegreeView, hasDegreeData } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail, FacultyMember } from "@/types";

const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const form = (level: "DOCTORAL" | "POST_DOCTORAL", value: DegreeDetail) => html(createElement(DegreeFields, { label: "x", level, value, onChange: noop }));
const view = (level: "DOCTORAL" | "POST_DOCTORAL", degree: DegreeDetail) => html(createElement(DegreeView, { label: "x", level, degree }));
// Visible label texts in document order.
const labels = (m: string) => [...m.matchAll(/<(?:label|p)(?=[\s>])[^>]*>(.*?)<\/(?:label|p)>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").replace(/\s*\*$/, "").trim()).filter(Boolean);
const group = (key: string) => EXPORT_FIELDS.find((f) => f.key === key) as ExportGroupField;
const d = (v: Record<string, unknown>) => v as unknown as DegreeDetail;

// Real shapes from the live VIT data (employee ids dropped).
const FULL_PURSUING = d({ course: "Post-Doctoral Fellowship", institutionName: "Kuala Lumpur University of Science and Technology (KLUST)", place: "Malaysia", hallTicketNumber: "KLUSTPDR20260096", yearOfAward: 2026, status: "PURSUING", mode: "PART_TIME", yearOfRegistration: 2026, nameOfTheGuideSupervisor: "Prof. Rajeev Kumar" });
const FULL_AWARDED_WITH_BRANCH = d({ course: "Post-Doctoral Fellowship", branch: "Materials Science & Engineering", institutionName: "Cheongju University", place: "Cheongju city, South Korea", certificateUrl: "https://example.com/c.pdf", yearOfAward: 2020, status: "AWARDED", mode: "FULL_TIME", yearOfRegistration: 2016 });
const COURSE_AND_STATUS_ONLY = d({ course: "Post-Doctoral Fellowship", yearOfAward: 2026, status: "AWARDED", mode: "FULL_TIME" });
const STATUS_MODE_ONLY = d({ status: "AWARDED", mode: "FULL_TIME" });
const CERT_ONLY = d({ certificateUrl: "https://example.com/c.pdf", yearOfAward: 2026 });
const PLACEHOLDER_ONLY = d({ yearOfAward: 2026 });

describe("Postdoctoral form (Add / Edit)", () => {
  it("has exactly the Ph.D. fields in the Ph.D. order, with the Postdoc thesis label", () => {
    const l = labels(form("POST_DOCTORAL", FULL_PURSUING));
    const want = ["Status", "Mode", "Field of Study", "Specialization", "Institution Name", "Name of the Department", "Title of the Postdoc Thesis", "Place", "Percentage / CGPA", "Year of Registration", "Name of the Guide / Supervisor", "Hall Ticket Number"];
    expect(l.filter((x) => want.includes(x))).toEqual(want);
    expect(l).not.toContain("Course");
    expect(l).not.toContain("Branch");
    expect(l).not.toContain("Title of the Ph.D Thesis");
  });
  it("offers Year of Award instead of the guide once Awarded", () => {
    const l = labels(form("POST_DOCTORAL", FULL_AWARDED_WITH_BRANCH));
    expect(l).toContain("Year of Award");
    expect(l).not.toContain("Name of the Guide / Supervisor");
  });
  it("an older entry's Branch is offered as its department, and nothing else about it is hidden from the saved values", () => {
    const m = form("POST_DOCTORAL", FULL_AWARDED_WITH_BRANCH);
    expect(m).toContain('value="Materials Science &amp; Engineering"'); // department box pre-filled from the stored branch
    expect(m).toContain('value="Cheongju University"');
    expect(m).toContain('value="Cheongju city, South Korea"');
  });
});

describe("Ph.D. form gains Percentage / CGPA after Place", () => {
  const phd = d({ specialization: "ML", institutionName: "IIT", departmentName: "CSE", thesisTitle: "T", place: "Chennai", percentageCgpa: "8.1", status: "AWARDED", yearOfAward: 2012 });
  it("sits right after Place, and the old legacy note is gone", () => {
    const m = form("DOCTORAL", phd);
    const l = labels(m);
    expect(l[l.indexOf("Place") + 1]).toBe("Percentage / CGPA");
    expect(m).toContain('value="8.1"');
    expect(m).not.toContain("Legacy note");
  });
  it("view shows it as a normal field; none stored means no row", () => {
    expect(view("DOCTORAL", phd)).toContain(">Percentage / CGPA<");
    expect(view("DOCTORAL", { ...phd, percentageCgpa: "" } as DegreeDetail)).not.toContain("Percentage / CGPA");
    expect(view("DOCTORAL", phd)).not.toContain("(legacy)");
  });
});

describe("Postdoctoral read-only view", () => {
  it("shows the Ph.D.-style fields; the stored branch reads as the department; the stored Course is not shown", () => {
    const m = view("POST_DOCTORAL", FULL_AWARDED_WITH_BRANCH);
    expect(m).toContain(">Name of the Department<");
    expect(m).toContain("Materials Science &amp; Engineering");
    expect(m).toContain("Cheongju University");
    expect(m).toContain("View Certificate");
    expect(m).not.toContain(">Course<");
    expect(m).not.toContain(">Branch<");
    expect(m).not.toContain("Post-Doctoral Fellowship</p>");
  });
  it("a real department / thesis / percentage typed later shows under the new labels", () => {
    const m = view("POST_DOCTORAL", { ...FULL_AWARDED_WITH_BRANCH, departmentName: "Chemistry", specialization: "Polymers", thesisTitle: "Batteries", percentageCgpa: "9.0" } as DegreeDetail);
    for (const t of [">Specialization<", ">Name of the Department<", ">Title of the Postdoc Thesis<", ">Percentage / CGPA<", "Chemistry", "Polymers", "Batteries", "9.0"]) expect(m).toContain(t);
    expect(m).not.toContain("Materials Science"); // the explicit department wins over the old branch
  });
});

describe("which of the 9 live shapes still show a card (nothing real is hidden)", () => {
  it.each([
    ["full pursuing entry", FULL_PURSUING, true],
    ["full awarded entry with a branch and certificate", FULL_AWARDED_WITH_BRANCH, true],
    ["course + status + mode", COURSE_AND_STATUS_ONLY, true],
    ["status + mode only", STATUS_MODE_ONLY, true],
    ["certificate only", CERT_ONLY, true],
    ["only the placeholder year", PLACEHOLDER_ONLY, false],
  ] as const)("%s", (_n, deg, shows) => {
    expect(hasDegreeData(deg, "POST_DOCTORAL")).toBe(shows);
    expect(view("POST_DOCTORAL", deg) !== "").toBe(shows);
  });
  it("a stored Course alone is not displayed, so it does not make an otherwise empty card appear", () => {
    expect(degreeHasData(d({ course: "Post-Doctoral Fellowship" }), "POST_DOCTORAL")).toBe(false);
    expect(degreeHasData(d({ course: "Post-Doctoral Fellowship" }), "PG")).toBe(true); // other levels unchanged
  });
  it("a department or thesis alone counts as data for Post-Doctoral", () => {
    expect(degreeHasData(d({ departmentName: "Chemistry" }), "POST_DOCTORAL")).toBe(true);
    expect(degreeHasData(d({ thesisTitle: "T" }), "POST_DOCTORAL")).toBe(true);
  });
});

describe("saving keeps every stored key", () => {
  it("typing the department adds departmentName and leaves course and branch exactly as stored", () => {
    const before = { postdoctoralFellowshipDetails: FULL_AWARDED_WITH_BRANCH, phdDetails: d({ institutionName: "IIT" }) };
    const after = { ...before, postdoctoralFellowshipDetails: { ...FULL_AWARDED_WITH_BRANCH, departmentName: "Materials Science & Engineering", specialization: "Alloys", thesisTitle: "T" } };
    const changes = diffAcademicProfile(before, after);
    expect(Object.keys(changes.set)).toEqual(["postdoctoralFellowshipDetails"]);
    const saved = academicProfileFirestoreUpdates(before, changes, "DELETE")["academicProfile.postdoctoralFellowshipDetails"] as Record<string, unknown>;
    expect(saved).toMatchObject({ course: "Post-Doctoral Fellowship", branch: "Materials Science & Engineering", departmentName: "Materials Science & Engineering", specialization: "Alloys", thesisTitle: "T", certificateUrl: "https://example.com/c.pdf", institutionName: "Cheongju University" });
    expect(Object.keys(academicProfileFirestoreUpdates(before, changes, "DELETE"))).not.toContain("academicProfile.phdDetails");
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

  it("Postdoctoral and Ph.D. have the same columns (own thesis label), Percentage / CGPA after Place", () => {
    const post = group("postdoctoralFellowshipDetailsGroup").subFieldLabels;
    const phd = group("phdDetailsGroup").subFieldLabels;
    expect(post.map((l) => (l === "Title of the Postdoc Thesis" ? "Title of the Ph.D Thesis" : l))).toEqual(phd);
    expect(post.slice(-3)).toEqual(["Place", "Percentage / CGPA", "Hall Ticket Number"]);
  });
  it("a live-shaped entry exports its old branch as the department (not as the Specialization) and keeps every other value", () => {
    exportFacultyCsv([faculty({ postdoctoralFellowshipDetails: FULL_AWARDED_WITH_BRANCH })], {}, ["postdoctoralFellowshipDetailsGroup"]);
    const c = cell("Postdoctoral Fellowship Details");
    expect(c).toContain("Specialization:  | Institution Name: Cheongju University");
    expect(c).toContain("Name of the Department: Materials Science & Engineering");
    expect(c).toContain("Place: Cheongju city, South Korea");
  });
  it("Ph.D. export still falls back to Branch for an old specialization", () => {
    exportFacultyCsv([faculty({ phdDetails: d({ branch: "Thermal", institutionName: "X", status: "AWARDED" }) })], {}, ["phdDetailsGroup"]);
    expect(cell("Ph.D. Details")).toContain("Specialization: Thermal");
  });
});
