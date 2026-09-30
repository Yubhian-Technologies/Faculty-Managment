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
}

class QueryRef {
  constructor(protected db: FakeDb, readonly path: string, readonly filters: Filter[] = []) {}
  where(field: string, op: "==" | "in", value: unknown) { return new QueryRef(this.db, this.path, [...this.filters, { field, op, value }]); }
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

  it("rejects a code that already exists for this regulation as a different subject", async () => {
    await service.run(request([row()], { courseId: "c-ai", departmentId: "ai" }), "commit");
    const res = await service.run(request([row({ name: "Discrete Maths" })]), "commit");
    expect(res.ok).toBe(false);
    expect(res.errors[0].message).toMatch(/already exists for R23/);
  });

  it("keeps regulations apart: the same code under R20 is a separate subject", async () => {
    await service.run(request([row()], { regulation: "R20" }), "commit");
    const res = await service.run(request([row({ name: "Data Structures & Algorithms" })]), "commit");
    expect(res.ok).toBe(true);
    expect(docs("subjects").map((s) => s.regulation).sort()).toEqual(["R20", "R23"]);
    expect(res.warnings.some((w) => /already has subjects under R20/.test(w.message))).toBe(true);
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
