import { beforeEach, describe, expect, it, vi } from "vitest";

// End-to-end check of Academics > Course Structure against an in-memory
// stand-in for the slice of the firebase-admin Firestore API the service
// uses: Regulation + Course + Department + rows (Year, Semester, subject
// data) in, master subjects + semester assignments out - then the same
// lookup Teaching Assignments does on those records.
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));

import {
  CourseStructureConflictError,
  CourseStructureImportService,
  CourseStructureRequestError,
  type CourseStructureRequest,
} from "./CourseStructureImportService";
import type { CourseStructureRawRow } from "../courseStructureValidation";
import { SubjectInstanceService } from "./SubjectInstanceService";

// ── Minimal Firestore fake ─────────────────────────────────────────────────
type Data = Record<string, unknown>;
type Filter = { field: string; op: "==" | "in"; value: unknown };

class FakeDb {
  store = new Map<string, Data>();
  // Runs inside runTransaction before the callback - simulates someone else
  // changing data between validation and commit.
  beforeTransaction?: (db: FakeDb) => void;

  collection(name: string) { return new CollRef(this, name); }
  async getAll(...refs: DocRef[]) { return refs.map((r) => r.snap()); }
  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    this.beforeTransaction?.(this);
    const tx = new FakeTx(this);
    const out = await fn(tx); // a throw here discards every staged write
    for (const w of tx.writes) {
      if (w.kind === "create" && this.store.has(w.ref.path)) throw new Error("ALREADY_EXISTS");
    }
    for (const w of tx.writes) {
      if (w.kind === "delete") this.store.delete(w.ref.path);
      else this.store.set(w.ref.path, structuredClone(w.data!));
    }
    return out;
  }
}

class DocRef {
  constructor(private db: FakeDb, readonly path: string) {}
  get id() { return this.path.split("/").pop()!; }
  collection(name: string) { return new CollRef(this.db, `${this.path}/${name}`); }
  snap() {
    const data = this.db.store.get(this.path);
    return { id: this.id, exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
  }
  async get() { return this.snap(); }
  async delete() { this.db.store.delete(this.path); }
}

class QueryRef {
  constructor(protected db: FakeDb, readonly path: string, readonly filters: Filter[] = []) {}
  where(field: string, op: "==" | "in", value: unknown) { return new QueryRef(this.db, this.path, [...this.filters, { field, op, value }]); }
  limit() { return this; }
  run() {
    const docs = [];
    for (const [p, data] of this.db.store) {
      if (!p.startsWith(`${this.path}/`) || p.slice(this.path.length + 1).includes("/")) continue;
      const ok = this.filters.every((f) => (f.op === "==" ? data[f.field] === f.value : (f.value as unknown[]).includes(data[f.field])));
      if (ok) docs.push(new DocRef(this.db, p).snap());
    }
    return { docs, empty: docs.length === 0, size: docs.length };
  }
  async get() { return this.run(); }
}

class CollRef extends QueryRef {
  doc(id: string) { return new DocRef(this.db, `${this.path}/${id}`); }
}

class FakeTx {
  writes: { kind: "create" | "set" | "delete"; ref: DocRef; data?: Data }[] = [];
  constructor(private db: FakeDb) {}
  async get(ref: DocRef | QueryRef) { return ref instanceof DocRef ? ref.snap() : ref.run(); }
  async getAll(...refs: DocRef[]) { return refs.map((r) => r.snap()); }
  create(ref: DocRef, data: Data) { this.writes.push({ kind: "create", ref, data }); }
  set(ref: DocRef, data: Data) { this.writes.push({ kind: "set", ref, data }); }
  delete(ref: DocRef) { this.writes.push({ kind: "delete", ref }); }
}

// ── College fixture ────────────────────────────────────────────────────────
// B.Tech (catalog "btech", regulations R20 + R23), 4 years, 2 semesters/year.
// CSE: own course, teaches Years 2-4 (Year 1 is Basic Science's).
// AI (parent) + AI-DS (sub-department, no own copy - runs on AI's course).
// Basic Science: grouping parent that runs no sections of its own.
const C = "colleges/col1";
let db: FakeDb;
let service: CourseStructureImportService;

function put(path: string, data: Data) { db.store.set(`${C}/${path}`, data); }
function timings(courseId: string) {
  [[1, 2], [3, 4], [5, 6], [7, 8]].forEach((sems, i) =>
    put(`courseYearTimings/${courseId}_year${i + 1}`, { courseId, year: i + 1, semesters: sems.map((semester) => ({ semester })) }));
}

beforeEach(() => {
  db = new FakeDb();
  service = new CourseStructureImportService(db as never);
  put("courseCatalog/btech", { name: "B.Tech", regulations: ["R20", "R23"], regulationBatches: {} });
  put("departments/cse", { name: "CSE", courseScopes: { btech: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } });
  put("departments/ai", { name: "AI", hasSubDepartments: true, courseScopes: { btech: { assignedYears: [2, 3, 4], secondaryDepartments: [] } } });
  put("departments/ai-ds", { name: "AI-DS", parentDepartmentId: "ai" });
  put("departments/bs", { name: "Basic Science", hasSubDepartments: true, parentRunsOwnSections: false, courseScopes: { btech: { assignedYears: [1], secondaryDepartments: [] } } });
  put("courses/c-cse", { name: "B.Tech", catalogId: "btech", departmentId: "cse", durationYears: 4, isActive: true });
  put("courses/c-ai", { name: "B.Tech", catalogId: "btech", departmentId: "ai", durationYears: 4, isActive: true });
  put("courses/c-bs", { name: "B.Tech", catalogId: "btech", departmentId: "bs", durationYears: 4, isActive: true });
  timings("c-cse");
  timings("c-ai");
  timings("c-bs");
});

const row = (over: CourseStructureRawRow = {}): CourseStructureRawRow => ({
  year: "2", semester: "3", category: "PCC", name: "Data Structures", code: "CS201",
  lectureHours: "3", tutorialHours: "0", practicalHours: "0", ...over,
});
function request(rows: CourseStructureRawRow[], over: Partial<CourseStructureRequest> = {}): CourseStructureRequest {
  return { collegeId: "col1", courseId: "c-cse", departmentId: "cse", regulation: "R23", records: rows.map((data, i) => ({ rowNumber: i + 2, data })), ...over };
}
const docs = (coll: string) => [...db.store].filter(([p]) => p.startsWith(`${C}/${coll}/`)).map(([p, d]) => ({ id: p.split("/").pop()!, ...d }) as Data & { id: string });

// Mirrors api/college/teaching-assignments POST's legitimacy lookup: the
// subject's instance under the section's course department, else the
// section's own department, for the section's year.
function teachingLookup(subjectId: string, section: { courseId: string; department: string; year: number }) {
  const course = db.store.get(`${C}/courses/${section.courseId}`) as { departmentId: string };
  const sectionDeptId = docs("departments").find((d) => d.name === section.department)?.id;
  for (const deptId of [course.departmentId, sectionDeptId]) {
    const hits = docs("subjectSemesterAssignments").filter((a) => a.subjectId === subjectId && a.departmentId === deptId && (a.year == null || a.year === section.year));
    if (hits.length > 0) return hits;
  }
  return [];
}

describe("Course Structure import - end to end", () => {
  it("creates subjects and links each to its regulation, course, department, year and semester", async () => {
    const res = await service.run(request([
      row(),
      row({ name: "DS Lab", code: "CS202", lectureHours: "0", practicalHours: "3" }),
      row({ year: "III", semester: "5", name: "Operating Systems", code: "CS301" }),
    ]), "commit");

    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ mastersCreated: 3, instancesWritten: 3 });
    expect(res.verification).toEqual({ checked: 3, problems: [] });

    const subjects = docs("subjects");
    expect(subjects.map((s) => [s.code, s.regulation, s.courseId, s.type])).toEqual(expect.arrayContaining([
      ["CS201", "R23", "c-cse", "THEORY"], ["CS202", "R23", "c-cse", "PRACTICAL"], ["CS301", "R23", "c-cse", "THEORY"],
    ]));
    const instances = docs("subjectSemesterAssignments");
    const byCode = Object.fromEntries(instances.map((a) => [a.subjectCode, a]));
    expect(byCode.CS201).toMatchObject({ regulation: "R23", courseId: "c-cse", departmentId: "cse", departmentName: "CSE", year: 2, semester: 3, isActive: true });
    expect(byCode.CS301).toMatchObject({ year: 3, semester: 5 });
    for (const a of instances) {
      expect(a.id).toBe(`${a.subjectId}_cse_${a.semester}`);
      expect(subjects.some((s) => s.id === a.subjectId)).toBe(true);
    }

    // Teaching Assignments finds CS201 for a CSE Year 2 section, not for Year 3.
    const cs201 = subjects.find((s) => s.code === "CS201")!.id;
    expect(teachingLookup(cs201, { courseId: "c-cse", department: "CSE", year: 2 })).toHaveLength(1);
    expect(teachingLookup(cs201, { courseId: "c-cse", department: "CSE", year: 3 })).toHaveLength(0);
  });

  it("writes nothing when any row is invalid", async () => {
    const before = db.store.size;
    const res = await service.run(request([row(), row({ year: "1", semester: "1", name: "Physics", code: "PH101" })]), "commit");
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ row: 3, field: "year" });
    expect(db.store.size).toBe(before);
  });

  it("validate mode is a dry run", async () => {
    const before = db.store.size;
    const res = await service.run(request([row()]), "validate");
    expect(res.ok).toBe(true);
    expect(res.plan).toEqual([expect.objectContaining({ row: 2, master: "create", instance: "create" })]);
    expect(db.store.size).toBe(before);
  });

  it("re-importing the same file changes nothing", async () => {
    await service.run(request([row(), row({ semester: "4", name: "DBMS", code: "CS204" })]), "commit");
    const snapshot = JSON.stringify([...db.store]);
    const again = await service.run(request([row(), row({ semester: "4", name: "DBMS", code: "CS204" })]), "commit");
    expect(again.ok).toBe(true);
    expect(again.counts).toMatchObject({ mastersCreated: 0, instancesWritten: 0, unchanged: 2 });
    expect(JSON.stringify([...db.store])).toBe(snapshot);
  });

  it("one subject in two semesters becomes one master with two assignments", async () => {
    const res = await service.run(request([row({ code: "YL1" }), row({ code: "YL1", semester: "4" })]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjects")).toHaveLength(1);
    expect(docs("subjectSemesterAssignments").map((a) => a.semester).sort()).toEqual([3, 4]);
  });

  it("links an identical subject another department already created instead of duplicating it", async () => {
    await service.run(request([row()], { courseId: "c-ai", departmentId: "ai" }), "commit");
    const res = await service.run(request([row()]), "commit");
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ mastersCreated: 0, mastersReused: 1, instancesWritten: 1 });
    expect(docs("subjects")).toHaveLength(1);
    expect(docs("subjectSemesterAssignments").map((a) => [a.departmentId, a.courseId]).sort()).toEqual([["ai", "c-ai"], ["cse", "c-cse"]]);
  });

  it("allows the same code for a different subject (separate master, no error)", async () => {
    await service.run(request([row()], { courseId: "c-ai", departmentId: "ai" }), "commit");
    const res = await service.run(request([row({ name: "Discrete Maths" })]), "commit");
    expect(res.ok).toBe(true);
    expect(res.counts).toMatchObject({ mastersCreated: 1, mastersReused: 0 });
    expect(docs("subjects")).toHaveLength(2);
  });

  it("allows one code on two different subjects in the same file", async () => {
    const res = await service.run(request([row(), row({ name: "Discrete Maths" })]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjects")).toHaveLength(2);
  });

  it("keeps regulations apart: the same code under R20 is a separate subject", async () => {
    await service.run(request([row()], { regulation: "R20" }), "commit");
    const res = await service.run(request([row({ name: "Data Structures & Algorithms" })]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjects").map((s) => s.regulation).sort()).toEqual(["R20", "R23"]);
    expect(res.warnings.some((w) => /already has subjects under R20/.test(w.message))).toBe(true);
  });

  it("scope lists the subjects assigned under each year and semester", async () => {
    await service.run(request([row(), row({ year: "3", semester: "5", name: "Operating Systems", code: "CS301" })]), "commit");
    const scope = await service.getScope("col1", "c-cse", "cse", "R23");
    expect(scope.existing.map((e) => [e.year, e.semester, e.subjects.map((x) => x.code)])).toEqual([[2, 3, ["CS201"]], [3, 5, ["CS301"]]]);
    expect(scope.existing[0].subjects[0]).toMatchObject({ name: "Data Structures", regulation: "R23", lectureHours: 3, credits: 3 });
  });

  it("carries over and removes an old-format assignment of a reused subject", async () => {
    await service.run(request([row()], { courseId: "c-ai", departmentId: "ai" }), "commit");
    const [master] = docs("subjects");
    put(`subjectSemesterAssignments/${master.id}_cse`, { subjectId: master.id, departmentId: "cse", courseId: "c-cse", semester: 3, createdAt: "2024-01-01" });
    const res = await service.run(request([row()]), "commit");
    expect(res.plan[0]).toMatchObject({ master: "reuse", instance: "reactivate" });
    expect(db.store.has(`${C}/subjectSemesterAssignments/${master.id}_cse`)).toBe(false);
    expect(db.store.get(`${C}/subjectSemesterAssignments/${master.id}_cse_3`)).toMatchObject({ createdAt: "2024-01-01", year: 2 });
  });

  it("accepts only categories the standard set or the college's own definitions cover", async () => {
    const before = db.store.size;
    const bad = await service.run(request([row({ category: "SEC" })]), "commit");
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toMatchObject({ kind: "unknown-category", value: "SEC" });
    expect(db.store.size).toBe(before);

    put("subjectCategories/SEC", { code: "SEC", fullForm: "Skill Enhancement Course" });
    const res = await service.run(request([row({ category: "Skill Enhancement Course" })]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjects")[0]).toMatchObject({ category: "SEC" });
    expect(docs("subjectSemesterAssignments")[0]).toMatchObject({ category: "SEC" });
  });

  it("files a year's semesters 1 and 2 under its configured semesters", async () => {
    const res = await service.run(request([
      row({ year: "3", semester: "1", name: "Computer Networks", code: "CS301" }),
      row({ year: "3", semester: "2", name: "Compiler Design", code: "CS302" }),
    ]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjectSemesterAssignments").map((a) => [a.subjectCode, a.year, a.semester]).sort()).toEqual([["CS301", 3, 5], ["CS302", 3, 6]]);
    expect(res.warnings[0].message).toMatch(/Semester 1 is read as Semester 5/);
  });

  it("sub-department on its parent's course: assignment is the sub-department's, and Teaching Assignments finds it", async () => {
    const res = await service.run(request([row()], { courseId: "c-ai", departmentId: "ai-ds" }), "commit");
    expect(res.ok).toBe(true);
    const [a] = docs("subjectSemesterAssignments");
    expect(a).toMatchObject({ courseId: "c-ai", departmentId: "ai-ds", departmentName: "AI-DS", year: 2, semester: 3 });
    // AI-DS section runs on AI's course doc (course.departmentId = "ai").
    expect(teachingLookup(a.subjectId as string, { courseId: "c-ai", department: "AI-DS", year: 2 })).toHaveLength(1);
  });

  it("sub-department inherits its parent's assigned years", async () => {
    const res = await service.run(request([row({ year: "1", semester: "1" })], { courseId: "c-ai", departmentId: "ai-ds" }), "validate");
    expect(res.errors[0].message).toMatch(/isn't assigned Year 1/);
  });

  it("rejects mismatched context before touching rows", async () => {
    await expect(service.run(request([row()], { courseId: "c-ai" }), "validate")).rejects.toThrow(CourseStructureRequestError);
    await expect(service.run(request([row()], { regulation: "R99" }), "validate")).rejects.toThrow(/isn't assigned to B.Tech/);
    await expect(service.run(request([row()], { courseId: "c-bs", departmentId: "bs" }), "validate")).rejects.toThrow(/doesn't run sections/);
  });

  it("aborts with nothing saved if timings change between check and commit", async () => {
    db.beforeTransaction = (d) => d.store.set(`${C}/courseYearTimings/c-cse_year2`, { courseId: "c-cse", year: 2, semesters: [{ semester: 4 }] });
    const before = db.store.size;
    await expect(service.run(request([row()]), "commit")).rejects.toThrow(CourseStructureConflictError);
    expect(db.store.size).toBe(before);
  });

  it("aborts with nothing saved if another import creates the same subject mid-commit", async () => {
    // Learn the deterministic id the competing import would write.
    const pristine = new Map(db.store);
    await service.run(request([row()], { courseId: "c-ai", departmentId: "ai" }), "commit");
    const [twin] = docs("subjects");
    db.store = pristine;
    db.beforeTransaction = (d) => d.store.set(`${C}/subjects/${twin.id}`, { ...twin });
    const before = db.store.size;
    await expect(service.run(request([row()]), "commit")).rejects.toThrow(/created by someone else/);
    expect(db.store.size).toBe(before + 1); // only the competitor's subject
    expect(docs("subjectSemesterAssignments")).toHaveLength(0);
  });
});

// ── After the import: teaching assignment -> timetable slot -> attendance ──
// Teaching assignments, timetable slots and attendance sessions all carry
// the imported master's id as `subjectId`; removing the semester assignment
// underneath a live teaching assignment must be refused.
describe("Course Structure import - downstream links", () => {
  async function importOne(over: Partial<CourseStructureRequest> = {}) {
    await service.run(request([row()], over), "commit");
    const [a] = docs("subjectSemesterAssignments");
    return a as Data & { id: string; subjectId: string; departmentId: string; semester: number };
  }
  // The shape teaching-assignments/route.ts POST writes for a section.
  function teachingAssignment(subjectId: string, over: Data = {}) {
    put("teachingAssignments/ta1", {
      subjectId, sectionId: "sec1", courseId: "c-cse", departmentId: "cse", department: "CSE",
      year: 2, timetableSemester: 3, facultyId: "f1", ...over,
    });
  }

  it("the same subject id carries through teaching assignment, timetable slot and attendance", async () => {
    const inst = await importOne();
    teachingAssignment(inst.subjectId);
    // timetable-slots POST copies subjectId/courseId/year/sectionId from the assignment;
    // student-attendance POST copies subjectId from the assignment.
    const ta = db.store.get(`${C}/teachingAssignments/ta1`)!;
    const master = db.store.get(`${C}/subjects/${inst.subjectId}`)!;
    expect(ta.subjectId).toBe(inst.subjectId);
    expect(master).toMatchObject({ regulation: "R23", courseId: "c-cse", type: "THEORY", hoursPerWeek: 3 });
    expect(teachingLookup(inst.subjectId, { courseId: "c-cse", department: "CSE", year: 2 })[0]).toMatchObject({ semester: ta.timetableSemester });
  });

  it("refuses to remove a semester assignment a live teaching assignment uses", async () => {
    const inst = await importOne();
    teachingAssignment(inst.subjectId);
    const svc = new SubjectInstanceService(db as never);
    await expect(svc.unassignSubjectInstance("col1", inst.subjectId, "cse", 3)).rejects.toThrow(/active faculty teaching assignments/);
    expect(docs("subjectSemesterAssignments")).toHaveLength(1);
  });

  it("refuses it for a sub-department whose section runs on the parent's course", async () => {
    const inst = await importOne({ courseId: "c-ai", departmentId: "ai-ds" });
    teachingAssignment(inst.subjectId, { courseId: "c-ai", departmentId: "ai", department: "AI-DS" });
    const svc = new SubjectInstanceService(db as never);
    await expect(svc.unassignSubjectInstance("col1", inst.subjectId, "ai-ds", 3)).rejects.toThrow(/active faculty/);
  });

  it("allows removal when the only teaching assignment is past or for another semester", async () => {
    const inst = await importOne();
    teachingAssignment(inst.subjectId, { timetableSemester: 4 });
    put("teachingAssignments/ta2", { subjectId: inst.subjectId, sectionId: "sec1", courseId: "c-cse", department: "CSE", year: 2, timetableSemester: 3, isPast: true });
    const svc = new SubjectInstanceService(db as never);
    await svc.unassignSubjectInstance("col1", inst.subjectId, "cse", 3);
    expect(docs("subjectSemesterAssignments")).toHaveLength(0);
  });
});
