import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "Title of the Ph.D Thesis" on Ph.D. entries - sits between "Name of the
// Department" and "Place". Stored as academicProfile.phdDetails.thesisTitle (and on
// every additionalPhdDetails entry), shown in the form and the read-only view, and
// carried by both CSV exports, the PDF resume and the public profile.

const h = vi.hoisted(() => ({ csv: "", db: null as unknown }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));
// The certificate uploader pulls in browser-only code; it is irrelevant here.
vi.mock("@/components/shared/CertificateUploadField", () => ({ CertificateUploadField: () => null }));

import { EXPORT_FIELDS, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { exportStaffCsv } from "@/lib/faculty/exportStaffCsv";
import { STAFF_COLUMNS } from "@/lib/faculty/staffCsvColumns";
import {
  academicProfileFirestoreUpdates, applyAcademicProfileChanges, diffAcademicProfile,
} from "@/lib/faculty/academicProfileChanges";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { getResumeHTML } from "@/lib/pdf/resumeTemplate";
import { DegreeFields, DegreeView, hasDegreeData } from "@/components/shared/ProfileFieldPrimitives";
import type { DegreeDetail, FacultyMember, FMSUser } from "@/types";

const THESIS = "Deep Learning for Medical Image Segmentation";
const THESIS_2 = "Quantum Error Correction in Noisy Devices";
const group = (key: string) => EXPORT_FIELDS.find((f) => f.key === key) as ExportGroupField;
const phd = {
  course: "", branch: "", institutionName: "IIT Madras", departmentName: "Department of Computer Science",
  thesisTitle: THESIS, place: "Chennai", percentageCgpa: "", specialization: "ML", status: "AWARDED", yearOfAward: 2012,
};
const profile = {
  phdDetails: phd,
  additionalPhdDetails: [{ ...phd, institutionName: "IISc", departmentName: "Department of Physics", thesisTitle: THESIS_2, place: "Bengaluru" }],
  postdoctoralFellowshipDetails: { course: "", branch: "", institutionName: "NUS", place: "Singapore", percentageCgpa: "", yearOfAward: 2014 },
};
const faculty = (ap: unknown) => ({ id: "f1", employeeId: "EMP1", legalName: "Dr X", academicProfile: ap }) as unknown as FacultyMember;

function cellOf(header: string): string {
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
  const i = rows[0].indexOf(header);
  if (i < 0) throw new Error(`no column "${header}" in ${rows[0].join(" / ")}`);
  return rows[1][i];
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

describe("form and read-only view", () => {
  const phdDegree = phd as unknown as DegreeDetail;

  it("the Ph.D. form shows the field after Name of the Department and directly before Place, with the saved value", () => {
    const form = html(createElement(DegreeFields, { label: "Ph.D. Details", level: "DOCTORAL", value: phdDegree, onChange: noop }));
    const dept = form.indexOf("Name of the Department");
    const title = form.indexOf("Title of the Ph.D Thesis");
    const place = form.indexOf(">Place<");
    expect(title).toBeGreaterThan(-1);
    expect(dept).toBeLessThan(title);
    expect(title).toBeLessThan(place);
    expect(form).toContain(THESIS);
  });

  it("the read-only view shows it in the same slot", () => {
    const view = html(createElement(DegreeView, { label: "Ph.D. Details", level: "DOCTORAL", degree: phdDegree }));
    expect(view).toContain("Title of the Ph.D Thesis");
    expect(view).toContain(THESIS);
    expect(view.indexOf("Name of the Department")).toBeLessThan(view.indexOf("Title of the Ph.D Thesis"));
    expect(view.indexOf("Title of the Ph.D Thesis")).toBeLessThan(view.indexOf("Place"));
  });

  it("is NOT offered for UG, PG or Postdoctoral entries", () => {
    for (const level of ["UG", "PG", "POST_DOCTORAL"] as const) {
      expect(html(createElement(DegreeFields, { label: "x", level, value: phdDegree, onChange: noop }))).not.toContain("Title of the Ph.D Thesis");
      expect(html(createElement(DegreeView, { label: "x", level, degree: phdDegree }))).not.toContain(THESIS);
    }
  });

  it("an older Ph.D. record (no title) shows an empty input in the form and no row in the view", () => {
    const old = { ...phdDegree } as Partial<DegreeDetail>;
    delete old.thesisTitle;
    expect(html(createElement(DegreeFields, { label: "x", level: "DOCTORAL", value: old as DegreeDetail, onChange: noop }))).toContain("Title of the Ph.D Thesis");
    expect(html(createElement(DegreeView, { label: "x", level: "DOCTORAL", degree: old as DegreeDetail }))).not.toContain("Title of the Ph.D Thesis");
  });

  it("an entry that has ONLY a thesis title still counts as having data (the card is shown)", () => {
    const only = { course: "", branch: "", institutionName: "", percentageCgpa: "", thesisTitle: THESIS } as DegreeDetail;
    expect(hasDegreeData(only)).toBe(true);
    expect(html(createElement(DegreeView, { label: "x", level: "DOCTORAL", degree: only }))).toContain(THESIS);
  });
});

describe("faculty full export (CSV)", () => {
  beforeEach(() => { h.csv = ""; });

  it("Ph.D. Details lists Name of the Department, Title of the Ph.D Thesis, Place - in that order", () => {
    const labels = group("phdDetailsGroup").subFieldLabels;
    const i = labels.indexOf("Name of the Department");
    expect(labels.slice(i, i + 3)).toEqual(["Name of the Department", "Title of the Ph.D Thesis", "Place"]);
    expect(group("postdoctoralFellowshipDetailsGroup").subFieldLabels).not.toContain("Title of the Ph.D Thesis");
  });

  it("every Ph.D. entry (first and additional) exports its own title in the right slot", () => {
    exportFacultyCsv([faculty(profile)], {}, ["phdDetailsGroup", "postdoctoralFellowshipDetailsGroup"]);
    const cell = cellOf("Ph.D. Details");
    expect(cell).toContain(`Name of the Department: Department of Computer Science | Title of the Ph.D Thesis: ${THESIS} | Place: Chennai`);
    expect(cell).toContain(`Name of the Department: Department of Physics | Title of the Ph.D Thesis: ${THESIS_2} | Place: Bengaluru`);
    expect(cellOf("Postdoctoral Fellowship Details")).not.toContain("Title of the Ph.D Thesis");
    expect(cellOf("Postdoctoral Fellowship Details")).toContain("Place: Singapore");
  });

  it("a title with commas and quotes survives CSV quoting intact", () => {
    const tricky = 'Graphs, "Trees" & Forests: a study';
    exportFacultyCsv([faculty({ phdDetails: { ...phd, thesisTitle: tricky } })], {}, ["phdDetailsGroup"]);
    expect(cellOf("Ph.D. Details")).toContain(`Title of the Ph.D Thesis: ${tricky} | Place: Chennai`);
  });

  it("an OLD record without a title exports it blank with every other value still in its own slot", () => {
    const old = { phdDetails: { ...phd, thesisTitle: undefined } };
    exportFacultyCsv([faculty(old)], {}, ["phdDetailsGroup"]);
    expect(cellOf("Ph.D. Details")).toContain("Title of the Ph.D Thesis:  | Place: Chennai | Hall Ticket Number:");
  });
});

describe("management (staff) export", () => {
  beforeEach(() => { h.csv = ""; });
  const user = (ap: unknown) => ({ uid: "u1", role: "HOD", name: "Dr X", academicProfile: ap }) as unknown as FMSUser;

  it("has the column right after the department, and fills it", () => {
    const keys = STAFF_COLUMNS.map((c) => c.key);
    expect(keys[keys.indexOf("phd_department") + 1]).toBe("phd_thesisTitle");
    exportStaffCsv([user(profile)]);
    expect(cellOf("PhD Title of the Ph.D Thesis")).toBe(THESIS);
    expect(cellOf("PhD Name of the Department")).toBe("Department of Computer Science");
    expect(cellOf("PhD Year of Award")).toBe("2012");
  });

  it("an old record exports blank, neighbours unaffected", () => {
    exportStaffCsv([user({ phdDetails: { institutionName: "X", yearOfAward: 2001 } })]);
    expect(cellOf("PhD Title of the Ph.D Thesis")).toBe("");
    expect(cellOf("PhD Institution Name")).toBe("X");
    expect(cellOf("PhD Year of Award")).toBe("2001");
  });
});

describe("database: the field is stored and read back untouched", () => {
  it("the read/write migration keeps it on the primary and every additional Ph.D.", () => {
    const out = normalizeAcademicProfile(profile) as typeof profile;
    expect(out.phdDetails.thesisTitle).toBe(THESIS);
    expect(out.additionalPhdDetails[0].thesisTitle).toBe(THESIS_2);
  });

  it("legacy-shaped records (old key names) are still migrated, and the title rides along", () => {
    const out = normalizeAcademicProfile({
      phdDetails: { degree: "", universityOrInstitute: "IIT", location: "Chennai", thesisTitle: THESIS, yearOfCompletion: 2012 },
    }) as unknown as { phdDetails: Record<string, unknown> };
    expect(out.phdDetails).toMatchObject({ institutionName: "IIT", place: "Chennai", thesisTitle: THESIS, yearOfAward: 2012 });
  });

  it("a record WITHOUT a title is not changed by migration (no key is invented)", () => {
    const old = { phdDetails: { institutionName: "IIT", yearOfAward: 2012 } };
    const out = normalizeAcademicProfile(old) as typeof old;
    expect(out).toEqual(old);
    expect("thesisTitle" in out.phdDetails).toBe(false);
  });

  it("saving a changed title writes the Ph.D. section to Firestore under academicProfile.phdDetails and nothing else", () => {
    const before = { phdDetails: { institutionName: "IIT" }, ugDetails: { institutionName: "U" } };
    const after = { ...before, phdDetails: { institutionName: "IIT", thesisTitle: THESIS } };
    const changes = diffAcademicProfile(before, after);
    expect(Object.keys(changes.set)).toEqual(["phdDetails"]);
    const updates = academicProfileFirestoreUpdates(before, changes, "DELETE");
    expect(updates["academicProfile.phdDetails"]).toEqual({ institutionName: "IIT", thesisTitle: THESIS });
    expect(Object.keys(updates)).not.toContain("academicProfile.ugDetails");
    expect((applyAcademicProfileChanges(before, changes) as typeof after).phdDetails.thesisTitle).toBe(THESIS);
  });

  it("clearing the title (empty text) is stored as a change, so it can be removed again", () => {
    const before = { phdDetails: { institutionName: "IIT", thesisTitle: THESIS } };
    const after = { phdDetails: { institutionName: "IIT", thesisTitle: "" } };
    expect(Object.keys(diffAcademicProfile(before, after).set)).toEqual(["phdDetails"]);
  });

  it("an additional Ph.D. title change is stored on additionalPhdDetails", () => {
    const before = { additionalPhdDetails: [{ institutionName: "IISc" }] };
    const after = { additionalPhdDetails: [{ institutionName: "IISc", thesisTitle: THESIS_2 }] };
    const changes = diffAcademicProfile(before, after);
    expect(academicProfileFirestoreUpdates(before, changes, "DELETE")["academicProfile.additionalPhdDetails"]).toEqual([{ institutionName: "IISc", thesisTitle: THESIS_2 }]);
  });
});

describe("PDF resume", () => {
  const resume = (ap: unknown) => getResumeHTML({ name: "Dr X", academicProfile: ap } as never);

  it("shows the thesis title for every Ph.D. entry, after the department", () => {
    const out = resume(profile);
    expect(out).toContain(`Thesis: ${THESIS}`);
    expect(out).toContain(`Thesis: ${THESIS_2}`);
    expect(out.indexOf("Department of Computer Science")).toBeLessThan(out.indexOf(`Thesis: ${THESIS}`));
  });

  it("an old record renders without a stray Thesis label", () => {
    expect(resume({ phdDetails: { institutionName: "IIT Madras", specialization: "ML", yearOfAward: 2012 } })).not.toContain("Thesis:");
  });

  it("does not show a title on non-Ph.D. degrees, and escapes user text", () => {
    expect(resume({ pgDetails: { institutionName: "NIT", course: "M.Tech", thesisTitle: "should not show" } })).not.toContain("should not show");
    const out = resume({ phdDetails: { institutionName: "IIT", specialization: "ML", thesisTitle: "<script>x</script>" } });
    expect(out).not.toContain("<script>x</script>");
  });
});

describe("public faculty profile API", () => {
  async function callRoute(ap: unknown) {
    const ts = { toDate: () => new Date("2015-06-01T00:00:00Z") };
    const facultyDoc = {
      data: () => ({ employeeId: "EMP1", legalName: "Dr X", designation: "PROFESSOR", department: "CSE", highestQualification: "Ph.D", joiningDate: ts, academicProfile: ap }),
      ref: { parent: { parent: { get: async () => ({ data: () => ({ name: "Vishnu College" }) }) } } },
    };
    h.db = {
      collectionGroup: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: false, size: 1, docs: [facultyDoc] }) }) }) }),
      collection: () => ({ get: async () => ({ docs: [{ data: () => ({ name: "Vishnu College" }) }] }) }),
    };
    const { GET } = await import("@/app/api/public/faculty-public/route");
    const res = await GET(new Request("http://localhost/api/public/faculty-public?employeeId=EMP1"));
    return (await res.json()) as { profile: { education: Record<string, Record<string, unknown>> } };
  }

  it("exposes the title on Ph.D. entries only", async () => {
    const { profile: p } = await callRoute({ ...profile, ugDetails: { institutionName: "U", thesisTitle: "should-not-leak-for-ug" } });
    expect(p.education.phdDetails.thesisTitle).toBe(THESIS);
    expect(p.education.additionalPhdDetails as unknown as { thesisTitle?: string }[]).toEqual([expect.objectContaining({ thesisTitle: THESIS_2 })]);
    expect(p.education.ugDetails).not.toHaveProperty("thesisTitle");
    expect(p.education.postdoctoralFellowshipDetails).not.toHaveProperty("thesisTitle");
  });
});
