import { describe, it, expect, vi, beforeEach } from "vitest";

// Drives the real route handlers (import, single add, roll edit) against an
// in-memory Firestore, to prove the roll-number rules end to end:
//   - required on every add / import row
//   - unique across the whole college (any department, year, course, section)
//   - a legacy duplicate / roll-less student stays editable
// Only auth and the database are faked; every rule under test is the route's own.

type Doc = Record<string, unknown>;
const store: Record<string, Record<string, Doc>> = {};
const writes: { kind: string; path: string; data: Doc }[] = [];
let autoId = 0;

function makeQuery(path: string, filters: { f: string; v: unknown }[] = []): unknown {
  const docsOf = () =>
    Object.entries(store[path] ?? {})
      .filter(([, d]) => filters.every((x) => d[x.f] === x.v))
      .map(([id, d]) => ({ id, exists: true, data: () => ({ ...d }), get: (field: string) => d[field] }));
  const q = {
    where: (f: string, _op: string, v: unknown) => makeQuery(path, [...filters, { f, v }]),
    select: () => q,
    limit: () => q,
    get: async () => {
      const docs = docsOf();
      return { docs, empty: docs.length === 0, size: docs.length };
    },
    doc: (id?: string) => makeDoc(path, id ?? `auto${++autoId}`),
  };
  return q;
}

function makeDoc(path: string, id: string): unknown {
  return {
    id,
    get: async () => ({ exists: !!store[path]?.[id], id, data: () => ({ ...(store[path]?.[id] ?? {}) }) }),
    update: async (data: Doc) => { writes.push({ kind: "update", path: `${path}/${id}`, data }); store[path] = { ...store[path], [id]: { ...store[path]?.[id], ...data } }; },
    set: async (data: Doc) => { writes.push({ kind: "set", path: `${path}/${id}`, data }); },
    collection: (name: string) => makeQuery(`${path}/${id}/${name}`),
  };
}

const fakeDb = {
  collection: (name: string) => ({ doc: (id: string) => ({ collection: (sub: string) => makeQuery(`${name}/${id}/${sub}`), id }) }),
  batch: () => ({ set: () => undefined, update: () => undefined, commit: async () => undefined }),
};

const session = { current: { collegeId: "c1", uid: "u1", role: "COLLEGE_OFFICE" } };
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => session.current }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fakeDb }));

const createdDocs: Doc[] = [];
vi.mock("@/lib/firestore/chunkedBatch", () => ({
  ChunkedBatch: class {
    set(ref: { id: string; path?: string }, data: Doc) { if (!ref.path?.includes("departmentHistory")) createdDocs.push(data); }
    update() {}
    async commit() {}
  },
}));

const C = "colleges/c1";
function seed() {
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0;
  createdDocs.length = 0;
  store[`${C}/departments`] = {
    d1: { name: "Computer Science and Engineering", code: "CSE", isActive: true, courseScopes: { cat1: { assignedYears: [1, 2, 3, 4] } } },
  };
  store[`${C}/courses`] = { c1: { name: "Bachelor of Technology", code: "BTECH", departmentId: "d1", catalogId: "cat1", durationYears: 4 } };
  store[`${C}/sections`] = {};
  store[`${C}/students`] = {
    // a student in a DIFFERENT department / year / course / section
    s1: { name: "Anil", rollNumber: "24A91A0501", department: "Information Technology", year: 3, section: "IT-A", courseId: "other" },
    s2: { name: "Legacy One", rollNumber: "DUP-1", department: "Civil", year: 2, section: "" },
    s3: { name: "Legacy Two", rollNumber: "DUP-1", department: "Mechanical", year: 2, section: "" },
    s4: { name: "No Roll", rollNumber: "", department: "Civil", year: 2, section: "" },
  };
}

const post = (url: string, body: unknown) =>
  new Request(`http://x${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const patch = (body: unknown) =>
  new Request("http://x/api/college/students/id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const importRow = (rollNumber: string, name: string) => ({
  rollNumber, name, department: "CSE", course: "BTECH", year: 2, section: "",
});

beforeEach(() => { seed(); session.current = { collegeId: "c1", uid: "u1", role: "COLLEGE_OFFICE" }; });

describe("bulk import - roll number rules", () => {
  it("rejects a row with no roll number", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("", "No Roll Row"), importRow("   ", "Blank Roll Row")] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(0);
    expect(json.failed.map((f) => f.error)).toEqual(["Roll Number is required", "Roll Number is required"]);
  });

  it("rejects a roll already held by a student in ANY other department / year / section", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("24A91A0501", "Clash"), importRow("24a91a0501", "Clash lower-case")] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(0);
    expect(json.failed).toHaveLength(2);
    expect(json.failed[0].error).toContain("already assigned to Anil");
    expect(json.failed[1].error).toContain("already assigned to Anil");
  });

  it("accepts new rolls, and rejects a repeat within the same file", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "First"), importRow("26A91A0002", "Second"), importRow("26a91a0001", "Repeat")] }));
    const json = await res.json() as { created: number; failed: { row: number; error: string }[] };
    expect(json.created).toBe(2);
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].row).toBe(4);
    expect(json.failed[0].error).toContain("already assigned to First");
    // (department-history entries are written through the same batch - only student docs carry a name)
    expect(createdDocs.filter((d) => d.name).map((d) => d.rollNumber)).toEqual(["26A91A0001", "26A91A0002"]);
  });
});

describe("single add - roll number rules", () => {
  const body = { name: "New Student", year: 2, department: "Computer Science and Engineering", course: "Bachelor of Technology" };

  it("requires a roll number", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    for (const rollNumber of [undefined, "", "   "]) {
      const res = await POST(post("/api/college/students", { ...body, rollNumber }));
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe("Roll number is required");
    }
    expect(writes).toHaveLength(0);
  });

  it("rejects a roll held by any other student, whatever their department or year", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    const res = await POST(post("/api/college/students", { ...body, rollNumber: "24A91A0501" }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("already assigned to Anil");
  });
});

describe("roll edit (HOD / Principal) - PATCH", () => {
  beforeEach(() => { session.current = { collegeId: "c1", uid: "u1", role: "PRINCIPAL" }; });
  const run = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/students/[id]/route");
    return PATCH(patch(body), params(id));
  };

  it("blocks changing a roll to one another student holds", async () => {
    const res = await run("s4", { rollNumber: "24A91A0501" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("already assigned to Anil");
    expect(writes).toHaveLength(0);
  });

  it("allows changing to a free roll", async () => {
    const res = await run("s4", { rollNumber: "26A91A0999" });
    expect(res.status).toBe(200);
    expect(writes.at(-1)?.data.rollNumber).toBe("26A91A0999");
  });

  it("refuses to remove an existing roll number", async () => {
    const res = await run("s1", { rollNumber: "" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("can't be removed");
    expect(writes).toHaveLength(0);
  });

  it("leaves legacy data alone: a student sharing a roll can still be edited without changing it", async () => {
    const res = await run("s2", { rollNumber: "DUP-1", status: "DETAINED" });
    expect(res.status).toBe(200);
    expect(writes.at(-1)?.data.status).toBe("DETAINED");
  });

  it("leaves legacy data alone: a roll-less student can be saved while still roll-less", async () => {
    const res = await run("s4", { rollNumber: "", status: "DETAINED" });
    expect(res.status).toBe(200);
  });
});
