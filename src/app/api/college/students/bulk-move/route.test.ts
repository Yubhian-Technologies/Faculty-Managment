import { describe, it, expect, vi, beforeEach } from "vitest";

// Drives the real bulk-move route against an in-memory Firestore: dry run vs
// commit, per-student skips, atomic write, HOD scope, shared first year, unassign.

type Doc = Record<string, unknown>;
const store: Record<string, Record<string, Doc>> = {};
const applied: { kind: "update" | "set"; path: string; data: Doc }[] = [];
let autoId = 0;

function makeQuery(path: string, filters: { f: string; v: unknown }[] = []): unknown {
  const q = {
    where: (f: string, _op: string, v: unknown) => makeQuery(path, [...filters, { f, v }]),
    get: async () => {
      const docs = Object.entries(store[path] ?? {})
        .filter(([, d]) => filters.every((x) => d[x.f] === x.v))
        .map(([id, d]) => ({ id, exists: true, ref: makeDoc(path, id), data: () => ({ ...d }) }));
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    doc: (id?: string) => makeDoc(path, id ?? `auto${++autoId}`),
  };
  return q;
}
function makeDoc(path: string, id: string): { id: string; path: string; get: () => Promise<unknown>; collection: (n: string) => unknown } {
  const self = {
    id,
    path: `${path}/${id}`,
    get: async () => ({ exists: !!store[path]?.[id], id, ref: self, data: () => ({ ...(store[path]?.[id] ?? {}) }) }),
    collection: (name: string) => makeQuery(`${path}/${id}/${name}`),
  };
  return self;
}
const fakeDb = {
  collection: (name: string) => ({ doc: (id: string) => ({ collection: (sub: string) => makeQuery(`${name}/${id}/${sub}`) }) }),
  getAll: async (...refs: { get: () => Promise<unknown> }[]) => Promise.all(refs.map((r) => r.get())),
  batch: () => {
    const ops: (() => void)[] = [];
    return {
      update: (ref: { path: string }, data: Doc) => ops.push(() => {
        applied.push({ kind: "update", path: ref.path, data });
        const [col, id] = [ref.path.slice(0, ref.path.lastIndexOf("/")), ref.path.slice(ref.path.lastIndexOf("/") + 1)];
        store[col][id] = { ...store[col][id], ...data };
      }),
      set: (ref: { path: string }, data: Doc) => ops.push(() => { applied.push({ kind: "set", path: ref.path, data }); }),
      commit: async () => { ops.forEach((o) => o()); },
    };
  },
};

const session = { current: { collegeId: "c1", uid: "u1", role: "PRINCIPAL" } };
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => session.current }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fakeDb }));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({
    ownDepartmentNames: ["CSE"], childDepartmentNames: [], managedDepartmentNames: [],
    departmentName: "CSE", ownDepartmentIds: [], childDepartmentIds: [], managedDepartmentIds: [], departmentId: null,
  }),
}));

const C = "colleges/c1";
function seed() {
  for (const k of Object.keys(store)) delete store[k];
  applied.length = 0;
  const yrs = (y: number[]) => ({ courseScopes: { cat1: { assignedYears: y } } });
  store[`${C}/departments`] = {
    bs: { name: "Basic Science", isActive: true, isFreshman: true, hasSubDepartments: false, secondaryDepartments: ["IT"], ...yrs([1]) },
    cse: { name: "CSE", isActive: true, ...yrs([2, 3, 4]) },
    it: { name: "IT", isActive: true, ...yrs([2, 3, 4]) },
  };
  store[`${C}/courses`] = { c1: { name: "B.Tech", catalogId: "cat1", departmentId: "cse" } };
  store[`${C}/sections`] = {
    secA: { name: "CSE-A", year: 2, department: "CSE", courseId: "c1", courseName: "B.Tech" },
    secB: { name: "CSE-B", year: 2, department: "CSE", courseId: "c1", courseName: "B.Tech" },
    secIT: { name: "IT-A", year: 2, department: "IT", courseId: "c1", courseName: "B.Tech" },
    secBS: { name: "BS-A", year: 1, department: "Basic Science", courseId: "c1", courseName: "B.Tech", secondaryDepartments: ["IT"] },
  };
  const st = (over: Doc): Doc => ({ department: "CSE", year: 2, section: "", courseId: "c1", status: "REGULAR", ...over });
  store[`${C}/students`] = {
    u1: st({ name: "Unassigned One", rollNumber: "R1" }),
    u2: st({ name: "In A", rollNumber: "R2", section: "CSE-A" }),
    u3: st({ name: "Wrong Year", rollNumber: "R3", year: 3 }),
    u4: st({ name: "Other Dept", rollNumber: "R4", department: "IT" }),
    u5: st({ name: "Already In B", rollNumber: "R5", section: "CSE-B" }),
    u7: st({ name: "Roll Clash", rollNumber: "r9" }),
    s9: st({ name: "Occupant", rollNumber: "R9", section: "CSE-B" }),
    f1: st({ name: "Fresher", rollNumber: "R10", department: "Basic Science", secondaryDepartment: "IT", year: 1 }),
  };
}

const call = async (body: unknown) => {
  const { POST } = await import("@/app/api/college/students/bulk-move/route");
  const res = await POST(new Request("http://x/api/college/students/bulk-move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() as Record<string, unknown> & { moves: { id: string; from: string; to: string }[]; skipped: { id: string; reason: string }[]; moved: number } };
};
const studentWrites = () => applied.filter((a) => a.kind === "update");
const historyWrites = () => applied.filter((a) => a.kind === "set");

beforeEach(() => { seed(); session.current = { collegeId: "c1", uid: "u1", role: "PRINCIPAL" }; });

describe("validation", () => {
  it("needs students and exactly one of target / unassign", async () => {
    expect((await call({ studentIds: [], targetSectionId: "secB" })).status).toBe(400);
    expect((await call({ studentIds: ["u1"] })).status).toBe(400);
    expect((await call({ studentIds: ["u1"], targetSectionId: "secB", unassign: true })).status).toBe(400);
  });
  it("caps one request at 200 students", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `x${i}`);
    expect((await call({ studentIds: ids, targetSectionId: "secB" })).status).toBe(400);
  });
  it("404s an unknown section", async () => {
    expect((await call({ studentIds: ["u1"], targetSectionId: "nope" })).status).toBe(404);
  });
});

describe("move / assign", () => {
  const ids = ["u1", "u2", "u3", "u4", "u5", "u7", "missing"];

  it("dry run reports who moves and who is skipped (with reasons) and writes nothing", async () => {
    const { status, json } = await call({ studentIds: ids, targetSectionId: "secB", dryRun: true });
    expect(status).toBe(200);
    expect(json.dryRun).toBe(true);
    expect(json.moved).toBe(0);
    expect(json.moves.map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(json.moves.find((m) => m.id === "u2")).toMatchObject({ from: "CSE-A", to: "CSE-B" });
    const reasons = Object.fromEntries(json.skipped.map((s) => [s.id, s.reason]));
    expect(reasons.u3).toContain("Year 3");
    expect(reasons.u4).toContain("doesn't belong to IT");
    expect(reasons.u5).toBe("Already in section CSE-B");
    expect(reasons.u7).toContain("already exists in section CSE-B");
    expect(reasons.missing).toBe("Student not found");
    expect(applied).toHaveLength(0);
  });

  it("commit writes only the students that passed - atomically, with a history entry each - and leaves the rest alone", async () => {
    const before = JSON.parse(JSON.stringify(store[`${C}/students`]));
    const { json } = await call({ studentIds: ids, targetSectionId: "secB" });
    expect(json.moved).toBe(2);
    expect(studentWrites().map((w) => w.path)).toEqual([`${C}/students/u1`, `${C}/students/u2`]);
    expect(studentWrites()[0].data).toMatchObject({ department: "CSE", section: "CSE-B", year: 2, courseId: "c1", course: "B.Tech", secondaryDepartment: null });
    expect(historyWrites()).toHaveLength(2);
    expect(historyWrites()[1].data).toMatchObject({ department: "CSE", section: "CSE-B", year: 2, previousSection: "CSE-A" });
    for (const id of ["u3", "u4", "u5", "u7", "s9", "f1"]) expect(store[`${C}/students`][id]).toEqual(before[id]);
  });

  it("two picked students with the same roll can't both land in one section", async () => {
    store[`${C}/students`].u1.rollNumber = "R77";
    store[`${C}/students`].u2.rollNumber = "r77";
    const { json } = await call({ studentIds: ["u1", "u2"], targetSectionId: "secB", dryRun: true });
    expect(json.moves.map((m) => m.id)).toEqual(["u1"]);
    expect(json.skipped[0].reason).toContain("already exists in section CSE-B");
  });

  it("a shared-first-year student placed in their branch's own section keeps the common department", async () => {
    store[`${C}/sections`].secIT1 = { name: "BSP-IT-A", year: 1, department: "IT", courseId: "c1", courseName: "B.Tech" };
    const { json } = await call({ studentIds: ["f1"], targetSectionId: "secIT1" });
    expect(json.moved).toBe(1);
    expect(studentWrites()[0].data).toMatchObject({ section: "BSP-IT-A", year: 1, courseId: "c1" });
    expect(studentWrites()[0].data).not.toHaveProperty("department");
    expect(studentWrites()[0].data).not.toHaveProperty("secondaryDepartment");
    expect(historyWrites()[0].data).toMatchObject({ department: "Basic Science", section: "BSP-IT-A" });
  });

  it("a legacy cross-listed section owned by the common department takes the student and records the branch", async () => {
    const { json } = await call({ studentIds: ["f1"], targetSectionId: "secBS" });
    expect(json.moved).toBe(1);
    expect(studentWrites()[0].data).toMatchObject({ department: "Basic Science", secondaryDepartment: "IT", section: "BS-A", year: 1 });
  });

  it("refuses a section that belongs to a different branch than the student's", async () => {
    store[`${C}/sections`].secCSE1 = { name: "BSC-CSE-A", year: 1, department: "CSE", courseId: "c1", courseName: "B.Tech" };
    const { json } = await call({ studentIds: ["f1"], targetSectionId: "secCSE1", dryRun: true });
    expect(json.moves).toHaveLength(0);
    expect(json.skipped[0].reason).toContain("doesn't belong to IT");
  });

  it("nothing is written when nobody qualifies", async () => {
    const { json } = await call({ studentIds: ["u3", "u4"], targetSectionId: "secB" });
    expect(json.moved).toBe(0);
    expect(applied).toHaveLength(0);
  });
});

describe("unassign", () => {
  it("returns placed students to Unassigned, skips those already unassigned, records history", async () => {
    const { json } = await call({ studentIds: ["u1", "u2", "s9"], unassign: true });
    expect(json.moves.map((m) => m.id)).toEqual(["u2", "s9"]);
    expect(json.skipped).toEqual([{ id: "u1", name: "Unassigned One", reason: "Already unassigned" }]);
    expect(studentWrites().every((w) => w.data.section === "")).toBe(true);
    expect(historyWrites().map((h) => h.data.previousSection)).toEqual(["CSE-A", "CSE-B"]);
  });
});

describe("HOD scope", () => {
  beforeEach(() => { session.current = { collegeId: "c1", uid: "hod1", role: "HOD" }; });

  it("only moves students inside the HOD's own department", async () => {
    const { json } = await call({ studentIds: ["u1", "u4"], targetSectionId: "secB" });
    expect(json.moves.map((m) => m.id)).toEqual(["u1"]);
    expect(json.skipped).toEqual([{ id: "u4", name: "Other Dept", reason: "Outside your department" }]);
  });

  it("refuses a target section outside the HOD's department, writing nothing", async () => {
    const { status } = await call({ studentIds: ["u1"], targetSectionId: "secIT" });
    expect(status).toBe(403);
    expect(applied).toHaveLength(0);
  });
});
