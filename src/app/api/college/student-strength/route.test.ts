import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrengthPayload } from "@/lib/students/strength/types";
import { buildReport, courseYearSummary, totalFor } from "@/lib/students/strength/query";

// Drives the real GET route + loader against an in-memory Firestore, and shows
// the statistics follow the student records: add / delete / transfer / promote /
// change section / change status, with no other step in between.

type Doc = Record<string, unknown>;
const store: Record<string, Record<string, Doc>> = {};

function snap(id: string, d: Doc) {
  return { id, exists: true, data: () => ({ ...d }), get: (f: string) => d[f] };
}
function makeCollection(path: string, projection?: string[]): unknown {
  const rows = () => Object.entries(store[path] ?? {});
  const project = (d: Doc) => (projection ? Object.fromEntries(projection.filter((k) => k in d).map((k) => [k, d[k]])) : d);
  const self = {
    select: (...fields: string[]) => makeCollection(path, fields),
    get: async () => {
      const docs = rows().map(([id, d]) => snap(id, project(d)));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    stream: () =>
      (async function* () {
        for (const [id, d] of rows()) yield snap(id, project(d));
      })(),
    count: () => ({ get: async () => ({ data: () => ({ count: rows().length }) }) }),
    doc: (id: string) => ({
      id,
      get: async () => ({ exists: !!store[path]?.[id], data: () => ({ ...(store[path]?.[id] ?? {}) }) }),
      collection: (name: string) => makeCollection(`${path}/${id}/${name}`),
    }),
  };
  return self;
}
const fakeDb = { collection: (name: string) => makeCollection(name) };

const session = { current: { collegeId: "c1", uid: "u1", role: "PRINCIPAL" } as { collegeId: string; uid: string; role: string } };
let denied = false;
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => {
    if (denied) throw new Error("UNAUTHORIZED");
    return session.current;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fakeDb }));
vi.mock("@/lib/college/collegeAcademicYear", () => ({ resolveCollegeAcademicYear: async () => "2026-27" }));
const scopeOf = (own: string[], managed: string[] = [], child: string[] = []) => ({
  ownDepartmentNames: own, childDepartmentNames: child, managedDepartmentNames: managed,
  departmentName: own[0] ?? "", ownDepartmentIds: [], childDepartmentIds: [], managedDepartmentIds: [], departmentId: null,
});
const hodScope = { current: scopeOf(["CSE"]) };
vi.mock("@/lib/departments/scope", () => ({ getHodDepartmentScope: async () => hodScope.current }));

import { GET } from "./route";

const C = "colleges/c1";
function seed() {
  for (const k of Object.keys(store)) delete store[k];
  store.colleges = { c1: { name: "Test College" } };
  store[`${C}/departments`] = {
    cse: { name: "CSE", code: "CSE", isActive: true },
    it: { name: "IT", code: "IT", isActive: true },
  };
  store[`${C}/courses`] = {
    c1: { name: "B.Tech", departmentId: "cse", durationYears: 4, isActive: true },
    c2: { name: "B.Tech", departmentId: "it", durationYears: 4, isActive: true },
  };
  store[`${C}/sections`] = {
    s1: { name: "A", year: 2, department: "IT", courseId: "c2" },
    s2: { name: "B", year: 2, department: "IT", courseId: "c2" },
  };
  const st = (o: Doc): Doc => ({ course: "B.Tech", status: "REGULAR", ...o });
  store[`${C}/students`] = {
    a1: st({ name: "Ravi Kumar", rollNumber: "1", department: "IT", year: 2, section: "A", courseId: "c2" }),
    a2: st({ name: "Ravi Kumar", rollNumber: "2", department: "IT", year: 2, section: "A", courseId: "c2" }), // same name
    b1: st({ name: "Sita", rollNumber: "3", department: "IT", year: 2, section: "B", courseId: "c2" }),
    c1: st({ name: "Gopi", rollNumber: "4", department: "CSE", year: 3, section: "A", courseId: "c1" }),
    c2: st({ name: "Hema", rollNumber: "5", department: "CSE", year: 3, section: "", courseId: "c1" }),
    g1: st({ name: "Old Boy", rollNumber: "6", department: "CSE", year: 4, section: "A", courseId: "c1", status: "GRADUATED" }),
  };
}

async function fetchPayload(): Promise<StrengthPayload> {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as StrengthPayload;
}
const enrolled = (p: StrengthPayload, extra: object = {}) => totalFor(p.cells, { status: "ENROLLED", ...extra });

beforeEach(() => {
  denied = false;
  session.current = { collegeId: "c1", uid: "u1", role: "PRINCIPAL" };
  hodScope.current = scopeOf(["CSE"]);
  seed();
});

describe("GET /api/college/student-strength", () => {
  it("returns the college's cube, verified against a database COUNT", async () => {
    const p = await fetchPayload();
    expect(p.collegeName).toBe("Test College");
    expect(p.session).toBe("2026-27");
    expect(p.scope).toBe("college");
    expect(p.integrity).toEqual({ databaseCount: 6, scannedRecords: 6 });
    expect(p.cells.reduce((n, c) => n + c.count, 0)).toBe(6);
    expect(enrolled(p)).toBe(5); // the graduate is not strength
    expect(totalFor(p.cells, { status: "GRADUATED" })).toBe(1);
  });

  it("answers the office's questions exactly, duplicate names included", async () => {
    const p = await fetchPayload();
    expect(enrolled(p, { branch: "it" })).toBe(3); // How many students are in IT?
    expect(enrolled(p, { branch: "it", year: 2 })).toBe(3); // ...in II Year?
    expect(enrolled(p, { branch: "it", year: 2, section: "a" })).toBe(2); // two Ravi Kumars = 2
    expect(enrolled(p, { branch: "it", year: 2, section: "b" })).toBe(1);
    expect(enrolled(p, { branch: "cse", section: "" })).toBe(1); // CSE, no section yet
    expect(enrolled(p, { branch: "mech" })).toBe(0); // empty combination
  });

  it("generates the spreadsheet: department x year, with totals that reconcile", async () => {
    const p = await fetchPayload();
    const r = buildReport(p.cells, p.meta, { status: "ENROLLED" });
    expect(r.total).toBe(5);
    const m = r.matrices[0];
    expect(m.rows.find((x) => x.code === "IT")!.byYear).toMatchObject({ 2: 3, 3: 0 });
    expect(m.rows.find((x) => x.code === "CSE")!.byYear).toMatchObject({ 3: 2, 4: 0 });
    expect(m.byYear).toMatchObject({ 1: 0, 2: 3, 3: 2, 4: 0 });
  });

  it("updates on every kind of student change, with nothing else to maintain", async () => {
    const students = store[`${C}/students`];

    // new admission
    students.n1 = { name: "New", rollNumber: "7", department: "IT", year: 2, section: "B", course: "B.Tech", courseId: "c2", status: "REGULAR" };
    let p = await fetchPayload();
    expect(enrolled(p, { branch: "it", year: 2, section: "b" })).toBe(2);
    expect(enrolled(p)).toBe(6);

    // section change
    students.a1.section = "B";
    p = await fetchPayload();
    expect(enrolled(p, { branch: "it", section: "a" })).toBe(1);
    expect(enrolled(p, { branch: "it", section: "b" })).toBe(3);

    // department transfer
    students.a2.department = "CSE";
    p = await fetchPayload();
    expect(enrolled(p, { branch: "it" })).toBe(3);
    expect(enrolled(p, { branch: "cse" })).toBe(3);

    // year promotion
    students.b1.year = 3;
    p = await fetchPayload();
    expect(enrolled(p, { branch: "it", year: 3 })).toBe(1);

    // status change: detained still counts, discontinued does not
    students.c1.status = "DETAINED";
    p = await fetchPayload();
    expect(enrolled(p)).toBe(6);
    expect(totalFor(p.cells, { status: "DETAINED" })).toBe(1);
    students.c1.status = "DISCONTINUED";
    p = await fetchPayload();
    expect(enrolled(p)).toBe(5);

    // deletion
    delete students.n1;
    p = await fetchPayload();
    expect(enrolled(p)).toBe(4);
    expect(p.integrity).toEqual({ databaseCount: 6, scannedRecords: 6 }); // 6 seeded + 1 added - 1 deleted
  });

  it("flags a duplicated roll number without merging the two students", async () => {
    store[`${C}/students`].a2.rollNumber = "1";
    const p = await fetchPayload();
    expect(p.health.duplicateRolls).toHaveLength(1);
    expect(p.health.duplicateRolls[0].count).toBe(2);
    expect(enrolled(p)).toBe(5);
  });

  it("an HOD gets only their own department, and no other department leaks through the metadata", async () => {
    session.current = { collegeId: "c1", uid: "h1", role: "HOD" };
    const p = await fetchPayload();
    expect(p.scope).toBe("department");
    expect(p.integrity).toBeNull();
    expect(enrolled(p)).toBe(2); // CSE year 3, both sections
    expect(enrolled(p, { branch: "it" })).toBe(0);
    expect(p.meta.branches.map((b) => b.label)).toEqual(["CSE"]);
    expect(p.meta.sections).toEqual([]); // the IT sections are not theirs
    expect(p.meta.programs.flatMap((x) => x.branchKeys)).not.toContain("it");
  });

  it("rejects callers the guard rejects", async () => {
    denied = true;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

// ─── HOD scoping: another department's students and sections must never leak ──

describe("HOD scope isolation", () => {
  // Two HODs share branch DS: the Basic Science sub-HOD runs its shared FIRST
  // year (managedDepartments + assignedYears [1]); DS's own HOD owns years 2-4.
  function seedSharedYear() {
    for (const k of Object.keys(store)) delete store[k];
    store.colleges = { c1: { name: "Test College" } };
    store[`${C}/departments`] = {
      bs: { name: "Basic Science", code: "BS", isActive: true, managedDepartments: ["DS"], assignedYears: [1] },
      ds: { name: "DS", code: "DS", isActive: true, assignedYears: [2, 3, 4] },
      it: { name: "IT", code: "IT", isActive: true, assignedYears: [1, 2, 3, 4] },
    };
    store[`${C}/courses`] = {
      cbs: { name: "B.Tech", departmentId: "bs", durationYears: 4, isActive: true },
      cds: { name: "B.Tech", departmentId: "ds", durationYears: 4, isActive: true },
      cit: { name: "B.Tech", departmentId: "it", durationYears: 4, isActive: true },
    };
    store[`${C}/sections`] = {
      dsY1: { name: "BS-DS-A", year: 1, department: "DS", courseId: "cds" }, // first-year section of DS (sub-HOD's)
      dsY2: { name: "SECRET-DS-B", year: 2, department: "DS", courseId: "cds" }, // DS's own HOD's
      itY2: { name: "SECRET-IT-A", year: 2, department: "IT", courseId: "cit" },
    };
    const st = (o: Doc): Doc => ({ course: "B.Tech", status: "REGULAR", section: "", ...o });
    store[`${C}/students`] = {
      f1: st({ name: "Fresher DS", rollNumber: "1", department: "Basic Science", secondaryDepartment: "DS", year: 1, section: "BS-DS-A" }),
      f2: st({ name: "Fresher IT", rollNumber: "2", department: "Basic Science", secondaryDepartment: "IT", year: 1, section: "BS-IT-A" }),
      d2: st({ name: "Second-year DS", rollNumber: "3", department: "DS", year: 2, section: "SECRET-DS-B" }),
      i2: st({ name: "Second-year IT", rollNumber: "4", department: "IT", year: 2, section: "SECRET-IT-A" }),
    };
  }
  const asHod = () => { session.current = { collegeId: "c1", uid: "h1", role: "HOD" }; };
  const everyString = (v: unknown): string => JSON.stringify(v);

  it("the sub-HOD of the shared first year sees the first years - and nothing of DS's or IT's later years", async () => {
    seedSharedYear();
    hodScope.current = scopeOf(["Basic Science"], ["DS"]);
    asHod();
    const p = await fetchPayload();
    expect(enrolled(p)).toBe(2); // both freshers (DS and IT are their branches for year 1)
    expect(enrolled(p, { year: 2 })).toBe(0);
    const json = everyString(p);
    expect(json).not.toContain("SECRET-DS-B");
    expect(json).not.toContain("SECRET-IT-A");
    expect(json).not.toContain("Second-year");
    expect(p.meta.sections.map((s) => s.label)).toEqual(["BS-DS-A"]);
  });

  it("DS's own HOD sees years 2-4 only, not the first years another HOD runs", async () => {
    seedSharedYear();
    hodScope.current = scopeOf(["DS"]);
    asHod();
    const p = await fetchPayload();
    // the DS fresher is pre-registered to DS (view-only for them) plus DS's own second year
    expect(enrolled(p, { branch: "ds", year: 2 })).toBe(1);
    expect(enrolled(p, { branch: "it" })).toBe(0);
    const json = everyString(p);
    expect(json).not.toContain("SECRET-IT-A");
    expect(json).not.toContain("Fresher IT");
    expect(p.meta.branches.map((b) => b.label)).toEqual(["DS"]);
    expect(p.meta.sections.map((s) => s.label)).toEqual(["SECRET-DS-B"]);
  });

  it("an IT-only HOD gets no trace of DS", async () => {
    seedSharedYear();
    hodScope.current = scopeOf(["IT"]);
    asHod();
    const p = await fetchPayload();
    const json = everyString(p);
    expect(json).not.toContain("SECRET-DS-B");
    expect(json).not.toContain("BS-DS-A");
    expect(p.meta.branches.map((b) => b.label)).toEqual(["IT"]);
    expect(enrolled(p, { branch: "ds" })).toBe(0);
  });

  it("an HOD with no department sees no students, sections, branches or programs", async () => {
    seedSharedYear();
    hodScope.current = scopeOf([]);
    asHod();
    const p = await fetchPayload();
    expect(p.cells).toEqual([]);
    expect(p.meta.sections).toEqual([]);
    expect(p.meta.branches).toEqual([]);
    expect(p.meta.programs).toEqual([]);
    expect(p.health.totalRecords).toBe(0);
  });

  // The answer card lists each course with its years; for an HOD that list must
  // be built from their own students only.
  const courseYears = (p: StrengthPayload) =>
    courseYearSummary(buildReport(p.cells, p.meta, { status: "ENROLLED" }, { includeEmptyDepartments: true }), p.meta);

  it("the answer card's course/year list for the shared-first-year sub-HOD counts only their first years", async () => {
    seedSharedYear();
    hodScope.current = scopeOf(["Basic Science"], ["DS"]);
    asHod();
    const cy = courseYears(await fetchPayload());
    expect(cy.map((c) => [c.label, c.count])).toEqual([["B.Tech", 2]]);
    expect(cy[0].years.filter((y) => y.count > 0).map((y) => [y.label, y.count])).toEqual([["I Year", 2]]);
  });

  it("the answer card's course/year list for DS's own HOD counts only DS's later years", async () => {
    seedSharedYear();
    hodScope.current = scopeOf(["DS"]);
    asHod();
    const cy = courseYears(await fetchPayload());
    const total = cy.reduce((n, c) => n + c.count, 0);
    expect(total).toBe(2); // the pre-registered fresher + their own second-year student - never IT's students
    for (const c of cy) expect(c.years.reduce((n, y) => n + y.count, 0)).toBe(c.count);
    expect(JSON.stringify(cy)).not.toMatch(/IT|Second-year IT/);
  });

  it("an HOD with no department gets no courses in the answer card", async () => {
    seedSharedYear();
    hodScope.current = scopeOf([]);
    asHod();
    expect(courseYears(await fetchPayload()).filter((c) => c.count > 0)).toEqual([]);
  });

  it("the same data through a Principal is unrestricted (control)", async () => {
    seedSharedYear();
    const p = await fetchPayload();
    expect(enrolled(p)).toBe(4);
    expect(everyString(p)).toContain("SECRET-IT-A");
  });
});
