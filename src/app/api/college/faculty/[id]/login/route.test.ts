import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// F2: giving an existing faculty member a login is all-or-nothing. In-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session || (roles.length && !roles.includes(h.session.role))) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db, getAdminAuth: async () => h.auth }));
vi.mock("@/lib/firebase/authRest", () => ({
  createFirebaseUser: async (email: string, password: string, displayName: string) =>
    (await h.auth.createUser({ email, password, displayName })).uid,
}));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({}),
  canHodManageFacultyDepartment: (_s: unknown, dept: string) => dept === "CSE",
}));

import { POST } from "./route";

const C = "colleges/c1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(id));
const ok = { email: "rao@vit.edu", password: "longenough1" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
  h.db = new FakeFirestore({
    [`${C}/facultyMembers/f1`]: { legalName: "Dr Rao", department: "CSE", employeeId: "EMP0001" },
    [`${C}/facultyMembers/f2`]: { legalName: "Has Login", department: "CSE", userUid: "existing" },
    [`${C}/facultyMembers/f3`]: { legalName: "Other Dept", department: "ECE" },
  });
});

describe("POST /faculty/[id]/login (F2)", () => {
  it("creates the login, profile, role mapping and the link in one go", async () => {
    const res = await post("f1", ok);
    expect(res.status).toBe(201);
    const { uid } = await res.json();
    expect(h.auth.users.get(uid)).toMatchObject({ email: "rao@vit.edu", password: "longenough1" });
    expect(h.db.get(`${C}/users/${uid}`)).toMatchObject({ role: "PANEL_MEMBER", name: "Dr Rao", department: "CSE" });
    expect(h.db.get(`systemUsers/${uid}`)).toMatchObject({ role: "PANEL_MEMBER", collegeId: "c1" });
    expect(h.db.get(`${C}/facultyMembers/f1`)).toMatchObject({ userUid: uid });
  });

  it("a failed write removes the Auth user and leaves the faculty record unlinked - and the retry works", async () => {
    const realBatch = h.db.batch.bind(h.db);
    h.db.batch = () => ({ set() { return this; }, update() { return this; }, commit: async () => { throw new Error("commit failed"); } }) as never;
    expect((await post("f1", ok)).status).toBe(500);
    expect(h.auth.users.size).toBe(0);
    expect(h.db.get(`${C}/facultyMembers/f1`)?.userUid).toBeUndefined();

    h.db.batch = realBatch;
    expect((await post("f1", ok)).status).toBe(201);
    expect(h.auth.users.size).toBe(1);
  });

  it("an email that belongs to an in-use account is a 409 and that account is untouched", async () => {
    h.db.docs.set("systemUsers/owner", { role: "HOD" });
    h.auth.users.set("owner", { uid: "owner", email: "rao@vit.edu", password: "theirs", disabled: false, customClaims: {} });
    const res = await post("f1", ok);
    expect(res.status).toBe(409);
    expect(h.auth.users.get("owner")?.password).toBe("theirs");
    expect(h.db.get(`${C}/facultyMembers/f1`)?.userUid).toBeUndefined();
  });

  it("validates input, existing login, scope and role", async () => {
    expect((await post("f1", { email: "a@b.c", password: "short" })).status).toBe(400);
    expect((await post("f1", { password: "longenough1" })).status).toBe(400);
    expect((await post("nope", ok)).status).toBe(404);
    expect((await post("f2", ok)).status).toBe(409);
    expect((await post("f3", ok)).status).toBe(403);
    h.session = { collegeId: "c1", uid: "o1", role: "COLLEGE_OFFICE" };
    expect((await post("f1", ok)).status).toBe(401);
    expect(h.auth.users.size).toBe(0);
  });
});
