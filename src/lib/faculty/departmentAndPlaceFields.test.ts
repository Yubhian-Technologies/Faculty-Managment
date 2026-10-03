import { beforeEach, describe, expect, it, vi } from "vitest";

// "Name of the Department" on Ph.D. entries (before Place) and "Place of the
// University/College" on Academic / Industry / Research experience entries -
// stored in academicProfile (departmentName / place), shown in the forms and views,
// and carried by the exports, the PDF resume and the public profile.

const h = vi.hoisted(() => ({ csv: "", db: null as unknown }));
vi.mock("@/lib/utils/csv", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/csv")>();
  return { ...actual, downloadCSV: (text: string) => { h.csv = text; } };
});
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

import { EXPORT_FIELDS, type ExportGroupField } from "@/lib/faculty/csvColumns";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { exportStaffCsv } from "@/lib/faculty/exportStaffCsv";
import { STAFF_COLUMNS } from "@/lib/faculty/staffCsvColumns";
import {
  academicProfileFirestoreUpdates, applyAcademicProfileChanges, diffAcademicProfile,
} from "@/lib/faculty/academicProfileChanges";
import { normalizeAcademicProfile } from "@/lib/faculty/academicProfileCompat";
import { getResumeHTML } from "@/lib/pdf/resumeTemplate";
import type { FacultyMember, FMSUser } from "@/types";

const group = (key: string) => EXPORT_FIELDS.find((f) => f.key === key) as ExportGroupField;
const phd = { course: "", branch: "", institutionName: "IIT Madras", departmentName: "Department of Computer Science", place: "Chennai", percentageCgpa: "", specialization: "ML", status: "AWARDED", yearOfAward: 2012 };
const profile = {
  phdDetails: phd,
  additionalPhdDetails: [{ ...phd, institutionName: "IISc", departmentName: "Department of Physics", place: "Bengaluru" }],
  postdoctoralFellowshipDetails: { course: "", branch: "", institutionName: "NUS", place: "Singapore", percentageCgpa: "", yearOfAward: 2014 },
  academicExperience: [{ institutionName: "BITS Pilani", place: "Hyderabad", designation: "Asst Prof", fromDate: "2014-01-01", toDate: "2018-01-01" }],
  industryExperience: [{ institutionName: "TCS", place: "Chennai", designation: "Engineer", fromDate: "2010-01-01", toDate: "2012-01-01" }],
  researchExperience: [{ institutionName: "ISRO", place: "Bengaluru", designation: "Scientist", fromDate: "2012-02-01", toDate: "2013-12-01" }],
};
const faculty = (ap: unknown) => ({ id: "f1", employeeId: "EMP1", legalName: "Dr X", academicProfile: ap }) as unknown as FacultyMember;

// Parses the one-row CSV and returns the cell under `header`.
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

describe("export column definitions", () => {
  it("Ph.D. Details has Name of the Department directly BEFORE Place; Postdoctoral does not have it", () => {
    const labels = group("phdDetailsGroup").subFieldLabels;
    const i = labels.indexOf("Name of the Department");
    expect(i).toBeGreaterThan(-1);
    expect(labels[i + 1]).toBe("Place");
    expect(group("postdoctoralFellowshipDetailsGroup").subFieldLabels).not.toContain("Name of the Department");
    // The two lists otherwise match, entry for entry.
    expect(labels.filter((l) => l !== "Name of the Department")).toEqual(group("postdoctoralFellowshipDetailsGroup").subFieldLabels);
  });

  it("all three experience groups carry Place of the University/College right after Institution Name", () => {
    for (const key of ["academicExperienceGroup", "industryExperienceGroup", "researchExperienceGroup"]) {
      const labels = group(key).subFieldLabels;
      expect(labels[labels.indexOf("Institution Name") + 1]).toBe("Place of the University/College");
    }
  });
});

describe("faculty full export (CSV) carries the new values in the right slot", () => {
  beforeEach(() => { h.csv = ""; });
  const run = () => exportFacultyCsv([faculty(profile)], {}, ["phdDetailsGroup", "postdoctoralFellowshipDetailsGroup", "academicExperienceGroup", "industryExperienceGroup", "researchExperienceGroup"]);

  it("Ph.D. entries (first and additional) export their department just before Place", () => {
    run();
    const cell = cellOf("Ph.D. Details");
    expect(cell).toContain("Year of Award: 2012 | Name of the Department: Department of Computer Science | Place: Chennai");
    expect(cell).toContain("Name of the Department: Department of Physics | Place: Bengaluru");
  });

  it("Postdoctoral keeps its own layout (no department column), Place still exported", () => {
    run();
    const cell = cellOf("Postdoctoral Fellowship Details");
    expect(cell).not.toContain("Name of the Department");
    expect(cell).toContain("Place: Singapore");
  });

  it("Academic, Industry and Research experience each export their place", () => {
    run();
    expect(cellOf("Academic Experience")).toContain("Institution Name: BITS Pilani | Place of the University/College: Hyderabad | Designation: Asst Prof");
    expect(cellOf("Industry Experience")).toContain("Institution Name: TCS | Place of the University/College: Chennai | Designation: Engineer");
    expect(cellOf("Research Experience")).toContain("Institution Name: ISRO | Place of the University/College: Bengaluru | Designation: Scientist");
  });

  it("an OLD record without either field exports blank for them, with every other value still in its own slot", () => {
    const old = {
      phdDetails: { course: "", branch: "", institutionName: "IIT Madras", place: "Chennai", percentageCgpa: "", specialization: "ML", status: "AWARDED", yearOfAward: 2012 },
      academicExperience: [{ institutionName: "BITS", designation: "Lecturer", fromDate: "2014-01-01", toDate: "2016-01-01", rolesResponsibilities: "Taught" }],
    };
    exportFacultyCsv([faculty(old)], {}, ["phdDetailsGroup", "academicExperienceGroup"]);
    expect(cellOf("Ph.D. Details")).toContain("Name of the Department:  | Place: Chennai");
    const exp = cellOf("Academic Experience");
    expect(exp).toContain("Place of the University/College:  | Designation: Lecturer | From Date: 2014-01-01");
    expect(exp).toContain("Academic Roles/Responsibilities: Taught");
  });
});

describe("management (staff) export", () => {
  beforeEach(() => { h.csv = ""; });
  const user = (ap: unknown) => ({ uid: "u1", role: "HOD", name: "Dr X", academicProfile: ap }) as unknown as FMSUser;

  it("has the columns, and fills PhD department and each academic experience place", () => {
    const keys = STAFF_COLUMNS.map((c) => c.key);
    expect(keys).toContain("phd_department");
    for (const n of [1, 2, 3]) expect(keys).toContain(`academicExperience${n}_place`);
    exportStaffCsv([user({ ...profile, academicExperience: [...profile.academicExperience, { institutionName: "JNTU", place: "Kakinada", designation: "Lecturer", fromDate: "2010-01-01", toDate: "2012-01-01" }] })]);
    expect(cellOf("PhD Name of the Department")).toBe("Department of Computer Science");
    expect(cellOf("Academic Experience 1 - Place of the University/College")).toBe("Hyderabad");
    expect(cellOf("Academic Experience 2 - Place of the University/College")).toBe("Kakinada");
    expect(cellOf("Academic Experience 3 - Place of the University/College")).toBe("");
  });

  it("an old record exports blank cells for them", () => {
    exportStaffCsv([user({ phdDetails: { course: "", branch: "", institutionName: "X", percentageCgpa: "" }, academicExperience: [{ institutionName: "Y" }] })]);
    expect(cellOf("PhD Name of the Department")).toBe("");
    expect(cellOf("Academic Experience 1 - Place of the University/College")).toBe("");
    expect(cellOf("Academic Experience 1 - Institution Name")).toBe("Y");
  });
});

describe("database: the fields are stored and read back untouched", () => {
  it("normalizeAcademicProfile (the read/write migration) keeps both fields, in all three experience lists and every Ph.D. slot", () => {
    const out = normalizeAcademicProfile(profile) as typeof profile;
    expect(out.phdDetails.departmentName).toBe("Department of Computer Science");
    expect(out.additionalPhdDetails[0].departmentName).toBe("Department of Physics");
    expect(out.academicExperience[0].place).toBe("Hyderabad");
    expect(out.industryExperience[0].place).toBe("Chennai");
    expect(out.researchExperience[0].place).toBe("Bengaluru");
  });

  it("legacy-shaped records (old key names) are still migrated, and the new fields ride along", () => {
    const out = normalizeAcademicProfile({
      phdDetails: { degree: "", universityOrInstitute: "IIT", location: "Chennai", departmentName: "CSE", yearOfCompletion: 2012 },
      previousInstitutions: [{ institutionName: "A", place: "Pune" }],
    }) as unknown as { phdDetails: Record<string, unknown>; academicExperience: Record<string, unknown>[] };
    expect(out.phdDetails).toMatchObject({ institutionName: "IIT", place: "Chennai", departmentName: "CSE", yearOfAward: 2012 });
    expect(out.academicExperience[0]).toMatchObject({ institutionName: "A", place: "Pune" });
  });

  it("a record WITHOUT them is not changed by migration (no keys are invented, nothing is lost)", () => {
    const old = { phdDetails: { institutionName: "IIT", yearOfAward: 2012 }, academicExperience: [{ institutionName: "A" }] };
    const out = normalizeAcademicProfile(old) as typeof old;
    expect(out).toEqual(old);
    expect("departmentName" in out.phdDetails).toBe(false);
    expect("place" in out.academicExperience[0]).toBe(false);
  });

  it("saving a changed Place / department writes that whole section to Firestore and nothing else", () => {
    const before = { phdDetails: { institutionName: "IIT" }, academicExperience: [{ institutionName: "A" }], ugDetails: { institutionName: "U" } };
    const after = { ...before, phdDetails: { institutionName: "IIT", departmentName: "CSE" }, academicExperience: [{ institutionName: "A", place: "Pune" }] };
    const changes = diffAcademicProfile(before, after);
    expect(Object.keys(changes.set).sort()).toEqual(["academicExperience", "phdDetails"]);
    const updates = academicProfileFirestoreUpdates(before, changes, "DELETE");
    expect(updates["academicProfile.phdDetails"]).toEqual({ institutionName: "IIT", departmentName: "CSE" });
    expect(updates["academicProfile.academicExperience"]).toEqual([{ institutionName: "A", place: "Pune" }]);
    expect(Object.keys(updates)).not.toContain("academicProfile.ugDetails");
    expect((applyAcademicProfileChanges(before, changes) as typeof after).phdDetails.departmentName).toBe("CSE");
  });

  it("clearing the field (empty text) is stored as a change, so a department/place can be removed again", () => {
    const before = { academicExperience: [{ institutionName: "A", place: "Pune" }] };
    const after = { academicExperience: [{ institutionName: "A", place: "" }] };
    expect(Object.keys(diffAcademicProfile(before, after).set)).toEqual(["academicExperience"]);
  });
});

describe("PDF resume", () => {
  const html = (ap: unknown) => getResumeHTML({ name: "Dr X", academicProfile: ap } as never);

  it("shows the Ph.D. department beside the degree and the place beside each previous institution", () => {
    const out = html(profile);
    expect(out).toContain("Department of Computer Science");
    expect(out).toContain("BITS Pilani, Hyderabad");
  });

  it("an old record renders as before (no stray separators)", () => {
    const out = html({ phdDetails: { institutionName: "IIT Madras", specialization: "ML", yearOfAward: 2012 }, academicExperience: [{ institutionName: "BITS Pilani", designation: "Lecturer" }] });
    expect(out).toContain("IIT Madras");
    expect(out).toContain("BITS Pilani");
    expect(out).not.toContain("BITS Pilani,");
    expect(out).not.toContain(" · </");
  });

  it("escapes user text", () => {
    const out = html({ academicExperience: [{ institutionName: "A", place: "<script>x</script>" }] });
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
    return (await res.json()) as { profile: { education: Record<string, Record<string, unknown> & { departmentName?: string }>; academicExperience: { place?: string }[] } };
  }

  it("exposes the Ph.D. department and each previous institution's place - and still nothing outside the allowlist", async () => {
    const { profile: p } = await callRoute({ ...profile, ugDetails: { institutionName: "U", departmentName: "should-not-leak-for-ug", hallTicketNumber: "SECRET-1" } });
    expect(p.education.phdDetails.departmentName).toBe("Department of Computer Science");
    expect(p.education.additionalPhdDetails as unknown as { departmentName?: string }[]).toEqual([expect.objectContaining({ departmentName: "Department of Physics" })]);
    expect(p.academicExperience[0].place).toBe("Hyderabad");
    // Non-doctoral degrees never carry a department; private fields still do not leave the server.
    expect(p.education.ugDetails).not.toHaveProperty("departmentName");
    expect(JSON.stringify(p)).not.toContain("SECRET-1");
  });

  it("an old record (no fields) still serves cleanly", async () => {
    const { profile: p } = await callRoute({ phdDetails: { institutionName: "IIT", yearOfAward: 2012 }, academicExperience: [{ institutionName: "A", designation: "Lecturer" }] });
    expect(p.education.phdDetails.institutionName).toBe("IIT");
    expect(p.academicExperience[0].place).toBeUndefined();
  });
});
