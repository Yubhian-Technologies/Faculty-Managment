import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// Drives the real route handlers (import, single add, roll edit) against an
// in-memory Firestore, to prove the roll-number rules end to end:
//   - OPTIONAL on every add / import row (the Office enrols students before roll numbers exist and sets them later)
//   - unique across the whole college AND across every other college, after
//     normalisation (case / spacing / punctuation variants are one roll)
//   - a legacy duplicate / roll-less student stays editable
// Only auth and the database are faked; every rule under test is the route's own.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: { collegeId: "c1", uid: "u1", role: "COLLEGE_OFFICE" },
}));
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db, getAdminAuth: async () => h.auth }));

const C = "colleges/c1";
function seed() {
  h.auth = new FakeAuth();
  h.db = new FakeFirestore({
    [`${C}/departments/d1`]: { name: "Computer Science and Engineering", code: "CSE", isActive: true, courseScopes: { cat1: { assignedYears: [1, 2, 3, 4] } } },
    [`${C}/courses/c1`]: { name: "Bachelor of Technology", code: "BTECH", departmentId: "d1", catalogId: "cat1", durationYears: 4 },
    // a student in a DIFFERENT department / year / course / section
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "24A91A0501", rollNumberUpper: "24A91A0501", department: "Information Technology", year: 3, section: "IT-A", courseId: "other" },
    [`${C}/students/s2`]: { name: "Legacy One", rollNumber: "DUP-1", department: "Civil", year: 2, section: "" },
    [`${C}/students/s3`]: { name: "Legacy Two", rollNumber: "DUP-1", department: "Mechanical", year: 2, section: "" },
    [`${C}/students/s4`]: { name: "No Roll", rollNumber: "", department: "Civil", year: 2, section: "" },
    // a student of ANOTHER college, registered globally
    "colleges/c9/students/z1": { name: "Other College Zed", rollNumber: "99Z99Z0001", rollNumberUpper: "99Z99Z0001" },
    "studentUsernames/99Z99Z0001": { rollKey: "99z99z0001", rollNumber: "99Z99Z0001", collegeId: "c9", studentDocId: "z1", name: "Other College Zed", active: true, createdAt: new Date() },
  });
}

// Student Mobile No is required (and unique), but these tests are about roll numbers - so a request that does not
// mention one gets its own unique number. A test that cares passes `mobileNo` explicitly (even "").
let mobileSeq = 0;
const nextMobile = () => `98000${String(++mobileSeq).padStart(5, "0")}`;
function withMobiles(body: unknown): unknown {
  const b = body as Record<string, unknown>;
  if (Array.isArray(b.records)) {
    return { ...b, records: b.records.map((r) => ("mobileNo" in (r as object) ? r : { ...(r as object), mobileNo: nextMobile() })) };
  }
  if ("name" in b && !("mobileNo" in b) && !("details" in b)) return { ...b, mobileNo: nextMobile() };
  return body;
}
const post = (url: string, body: unknown) =>
  new Request(`http://x${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withMobiles(body)) });
const patch = (body: unknown) =>
  new Request("http://x/api/college/students/id", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const importRow = (rollNumber: string, name: string, extra: Record<string, unknown> = {}) => ({
  rollNumber, name, department: "CSE", course: "BTECH", year: 2, section: "", ...extra,
});
const importedStudents = () => [...h.db.docs.entries()].filter(([p, d]) => /^colleges\/c1\/students\/[^/]+$/.test(p) && d.name && !["s1", "s2", "s3", "s4"].includes(p.split("/").pop() as string)).map(([, d]) => d);

beforeEach(() => {
  seed();
  h.session = { collegeId: "c1", uid: "u1", role: "COLLEGE_OFFICE" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bulk import - roll number rules", () => {
  it("accepts a row with no roll number - it is saved roll-less, with no roll key and no roll claim", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("", "No Roll Row"), importRow("   ", "Blank Roll Row")] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(2);
    expect(json.failed).toEqual([]);
    const saved = importedStudents();
    expect(saved.map((d) => d.rollNumber)).toEqual(["", ""]);
    expect(saved.every((d) => d.rollNumberUpper === undefined)).toBe(true);
  });

  it("rejects a roll already held by a student in ANY other department / year / section, in any case", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("24A91A0501", "Clash"), importRow("24a91a0501", "Clash lower-case")] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(0);
    expect(json.failed).toHaveLength(2);
    expect(json.failed[0].error).toContain("already assigned to Anil");
    expect(json.failed[1].error).toContain("already assigned to Anil");
  });

  it("rejects a row with no Student Mobile No (required), even when it has a roll", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0090", "No Mobile", { mobileNo: "" }), importRow("26A91A0091", "Spaces Mobile", { mobileNo: "   " })] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(0);
    expect(json.failed.map((f) => f.error)).toEqual(["Student Mobile No is required", "Student Mobile No is required"]);
    expect(importedStudents()).toHaveLength(0);
  });

  it("accepts new rolls, and rejects a repeat within the same file (even with different formatting)", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "First"), importRow("26A91A0002", "Second"), importRow("26-a91a0001", "Repeat")] }));
    const json = await res.json() as { created: number; failed: { row: number; error: string }[] };
    expect(json.created).toBe(2);
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].row).toBe(4);
    expect(json.failed[0].error).toContain("already assigned to First");
    expect(importedStudents().map((d) => d.rollNumber).sort()).toEqual(["26A91A0001", "26A91A0002"]);
  });

  it("claims each imported roll globally", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    await POST(post("/import", { records: [importRow("26A91A0001", "First")] }));
    expect(h.db.get("studentUsernames/26A91A0001")).toMatchObject({ collegeId: "c1", active: true, rollKey: "26a91a0001" });
  });

  it("rejects a roll that a student of ANOTHER college already holds, without naming them, and writes nothing for that row", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("99-z99z0001", "Cross College Clash"), importRow("26A91A0003", "Fine")] }));
    const json = await res.json() as { created: number; failed: { row: number; error: string }[] };
    expect(json.created).toBe(1);
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].row).toBe(2);
    expect(json.failed[0].error).toMatch(/another college/);
    expect(JSON.stringify(json)).not.toContain("Other College Zed");
    expect(importedStudents().map((d) => d.name)).toEqual(["Fine"]);
    expect(h.db.get("studentUsernames/99Z99Z0001")).toMatchObject({ collegeId: "c9", studentDocId: "z1" }); // untouched
  });

  it("two imports of the same new roll running at the same moment: exactly one student gets it", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const results = await Promise.all(
      ["A", "B", "C"].map((n) => POST(post("/import", { records: [importRow("77Q77Q0001", `Student ${n}`)] })).then((r) => r.json() as Promise<{ created: number }>))
    );
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1);
    expect(importedStudents()).toHaveLength(1);
  });

  it("a chunk that fails to save gives its roll claims back and reports the rows", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const realBatch = h.db.batch.bind(h.db);
    h.db.batch = () => { const b = realBatch(); b.commit = async () => { throw new Error("firestore unavailable"); }; return b; };
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "First")] }));
    // Whatever the response, no claim is left behind blocking the retry.
    expect([200, 201, 500]).toContain(res.status);
    expect(h.db.get("studentUsernames/26A91A0001")).toBeUndefined();
    h.db.batch = realBatch;
    const retry = await POST(post("/import", { records: [importRow("26A91A0001", "First")] }));
    expect((await retry.json() as { created: number }).created).toBe(1);
  });
});

describe("bulk import - login passwords (S1)", () => {
  it("a row with a Password column gets a login with exactly that password; the password is stored nowhere else and not echoed", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "First", { loginPassword: "Given-by-office-1" }), importRow("26A91A0002", "Second")] }));
    const text = await res.text();
    const json = JSON.parse(text) as { created: number; loginsCreated: number; loginFailed: unknown[] };
    expect(json).toMatchObject({ created: 2, loginsCreated: 1, loginFailed: [] });
    expect(text).not.toContain("Given-by-office-1");

    const users = [...h.auth.users.values()];
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: "26a91a0001@students.internal", password: "Given-by-office-1", customClaims: { role: "STUDENT", collegeId: "c1" } });
    expect(JSON.stringify([...h.db.docs.entries()])).not.toContain("Given-by-office-1");
    const first = importedStudents().find((d) => d.rollNumber === "26A91A0001")!;
    expect(first).toMatchObject({ uid: users[0].uid, loginEmail: "26a91a0001@students.internal" });
    expect(importedStudents().find((d) => d.rollNumber === "26A91A0002")).not.toHaveProperty("uid");
    expect(h.db.get("studentUsernames/26A91A0001")).toMatchObject({ uid: users[0].uid, loginEmail: "26a91a0001@students.internal" });
  });

  it("a weak password rejects ITS row only, before anything is written for it", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "Weak", { loginPassword: "abc" }), importRow("26A91A0002", "Good", { loginPassword: "Long-enough-1" })] }));
    const json = await res.json() as { created: number; failed: { row: number; error: string }[]; loginsCreated: number };
    expect(json.created).toBe(1);
    expect(json.loginsCreated).toBe(1);
    expect(json.failed).toEqual([{ row: 2, rollNumber: "26A91A0001", error: expect.stringMatching(/at least/) }]);
    expect(importedStudents().map((d) => d.name)).toEqual(["Good"]);
    expect(h.db.get("studentUsernames/26A91A0001")).toBeUndefined();
  });

  it("a login that cannot be created never undoes the imported student; it is reported per row", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    h.auth.failNext.createUser = new Error("auth down");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "First", { loginPassword: "Long-enough-1" })] }));
    const json = await res.json() as { created: number; loginsCreated: number; loginFailed: { row: number; rollNumber: string; error: string }[] };
    expect(json.created).toBe(1);
    expect(json.loginsCreated).toBe(0);
    expect(json.loginFailed).toHaveLength(1);
    expect(json.loginFailed[0]).toMatchObject({ row: 2, rollNumber: "26A91A0001" });
    expect(importedStudents()).toHaveLength(1);
    expect(h.auth.users.size).toBe(0);
  });

  it("a non-text password is rejected for the row", async () => {
    const { POST } = await import("@/app/api/college/students/import-excel/route");
    const res = await POST(post("/import", { records: [importRow("26A91A0001", "Odd", { loginPassword: 12345678 })] }));
    const json = await res.json() as { created: number; failed: { error: string }[] };
    expect(json.created).toBe(0);
    expect(json.failed[0].error).toMatch(/text/);
  });
});

describe("single add - roll number rules", () => {
  const body = { name: "New Student", year: 2, department: "Computer Science and Engineering", course: "Bachelor of Technology" };

  it("does not require a roll number - the student is saved roll-less and can be given one later", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    for (const rollNumber of [undefined, "", "   "]) {
      const res = await POST(post("/api/college/students", { ...body, rollNumber }));
      expect(res.status).toBe(201);
    }
    const saved = [...h.db.docs.entries()].filter(([p, d]) => /^colleges\/c1\/students\/[^/]+$/.test(p) && d.name === "New Student").map(([, d]) => d);
    expect(saved).toHaveLength(3);
    expect(saved.every((d) => d.rollNumber === "" && d.rollNumberUpper === undefined)).toBe(true);
  });

  it("requires a Student Mobile No", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    for (const mobileNo of ["", "   "]) {
      const res = await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0099", mobileNo }));
      expect(res.status).toBe(400);
      expect((await res.json() as { error: string }).error).toBe("Student Mobile No is required");
    }
    expect(h.db.writeLog).toHaveLength(0);
  });

  it("rejects a roll held by any other student, whatever their department or year", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    const res = await POST(post("/api/college/students", { ...body, rollNumber: "24A91A0501" }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("already assigned to Anil");
  });

  it("rejects a roll held by a student of ANOTHER college - in any formatting - without naming them", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    for (const roll of ["99Z99Z0001", "99z99z0001", "99-Z99Z0001", " 99 z99z0001 "]) {
      const res = await POST(post("/api/college/students", { ...body, rollNumber: roll }));
      expect(res.status).toBe(409);
      const err = (await res.json() as { error: string }).error;
      expect(err).toMatch(/another college/);
      expect(err).not.toContain("Other College Zed");
    }
    expect(importedStudents()).toHaveLength(0);
  });

  it("adds a new student, claiming the roll globally", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    const res = await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0777" }));
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    expect(h.db.get(`${C}/students/${id}`)).toMatchObject({ rollNumber: "26A91A0777", rollNumberUpper: "26A91A0777" });
    expect(h.db.get("studentUsernames/26A91A0777")).toMatchObject({ collegeId: "c1", studentDocId: id, active: true });
  });

  it("a failed save gives the claim back, so the retry is not blocked", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    const realBatch = h.db.batch.bind(h.db);
    h.db.batch = () => { const b = realBatch(); b.commit = async () => { throw new Error("firestore unavailable"); }; return b; };
    expect((await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0778" }))).status).toBe(500);
    expect(h.db.get("studentUsernames/26A91A0778")).toBeUndefined();
    h.db.batch = realBatch;
    expect((await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0778" }))).status).toBe(201);
  });

  it("with a login password: creates the login with that exact password (never stored or echoed)", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    const res = await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0779", loginPassword: "Typed-by-office-1" }));
    const text = await res.text();
    expect(res.status).toBe(201);
    expect(JSON.parse(text)).toMatchObject({ loginCreated: true });
    expect(text).not.toContain("Typed-by-office-1");
    const [user] = [...h.auth.users.values()];
    expect(user).toMatchObject({ email: "26a91a0779@students.internal", password: "Typed-by-office-1" });
    expect(JSON.stringify([...h.db.docs.entries()])).not.toContain("Typed-by-office-1");
  });

  it("a bad login password is a 400 and NOTHING is written", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    for (const bad of ["short", " Abcdef12", 12345678]) {
      const res = await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0780", loginPassword: bad }));
      expect(res.status).toBe(400);
    }
    expect(h.db.writeLog).toHaveLength(0);
    expect(h.auth.users.size).toBe(0);
  });

  it("if the login cannot be created the student is still added and the problem is reported", async () => {
    const { POST } = await import("@/app/api/college/students/route");
    h.auth.failNext.createUser = new Error("auth down");
    const res = await POST(post("/api/college/students", { ...body, rollNumber: "26A91A0781", loginPassword: "Typed-by-office-1" }));
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string; loginCreated: boolean; loginError: string };
    expect(json.loginCreated).toBe(false);
    expect(json.loginError).toBeTruthy();
    expect(h.db.get(`${C}/students/${json.id}`)).toBeDefined();
  });
});

describe("roll edit (HOD / Principal) - PATCH", () => {
  beforeEach(() => { h.session = { collegeId: "c1", uid: "u1", role: "PRINCIPAL" }; });
  const run = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/students/[id]/route");
    return PATCH(patch(body), params(id));
  };

  it("blocks changing a roll to one another student holds", async () => {
    const res = await run("s4", { rollNumber: "24A91A0501" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("already assigned to Anil");
    expect(h.db.writeLog).toHaveLength(0);
  });

  it("blocks changing a roll to one a student of ANOTHER college holds, in any formatting", async () => {
    for (const roll of ["99Z99Z0001", "99-z99z0001"]) {
      const res = await run("s4", { rollNumber: roll });
      expect(res.status).toBe(400);
      const err = (await res.json() as { error: string }).error;
      expect(err).toMatch(/another college/);
      expect(err).not.toContain("Other College Zed");
    }
    expect(h.db.get(`${C}/students/s4`)?.rollNumber).toBe("");
  });

  it("allows changing to a free roll, claiming it globally", async () => {
    const res = await run("s4", { rollNumber: "26A91A0999" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s4`)?.rollNumber).toBe("26A91A0999");
    expect(h.db.get("studentUsernames/26A91A0999")).toMatchObject({ collegeId: "c1", studentDocId: "s4", active: true });
  });

  it("refuses to remove an existing roll number", async () => {
    const res = await run("s1", { rollNumber: "" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("can't be removed");
    expect(h.db.writeLog).toHaveLength(0);
  });

  it("leaves legacy data alone: a student sharing a roll can still be edited without changing it", async () => {
    const res = await run("s2", { rollNumber: "DUP-1", status: "DETAINED" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)?.status).toBe("DETAINED");
  });

  it("leaves legacy data alone: a roll-less student can be saved while still roll-less", async () => {
    const res = await run("s4", { rollNumber: "", status: "DETAINED" });
    expect(res.status).toBe(200);
  });
});
