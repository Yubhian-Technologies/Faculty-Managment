import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// F2 + F6 on the supporting-staff create route. In-memory fakes only.

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
  getHodDepartmentScope: async () => ({ ownDepartmentNames: ["CSE"] }),
  canHodManageFacultyDepartment: () => true,
}));
vi.mock("@/lib/designations/validate", () => ({
  resolveDesignation: async (_db: unknown, _c: string, _cat: string, designation: string) => ({ name: designation }),
}));

import { POST } from "./route";

const C = "colleges/c1";
const body = (over: Record<string, unknown> = {}) => ({
  employeeId: "S-100", collegeEmail: "clerk@vit.edu", password: "longenough1", mobileNo: "9999999999", legalName: "A Clerk",
  gender: "MALE", dateOfBirth: "1990-01-01", aadharNo: "123412341234", panNo: "ABCDE1234F",
  staffCategory: "NON_TECHNICAL", designation: "CLERK", highestQualification: "B.Com", joiningDate: "2024-06-01", ...over,
});
const post = (b: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({});
});

const staffDocs = () => [...h.db.docs.keys()].filter((k) => /^colleges\/c1\/supportingStaff\/[^/]+$/.test(k));

describe("POST /supporting-staff", () => {
  it("creates login, profile, role mapping and staff record together", async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    const { id, uid } = await res.json();
    expect(h.db.get(`${C}/supportingStaff/${id}`)).toMatchObject({ employeeId: "S-100", userUid: uid, legalName: "A Clerk" });
    expect(h.db.get(`${C}/users/${uid}`)).toMatchObject({ role: "COLLEGE_STAFF" });
    expect(h.db.get(`systemUsers/${uid}`)).toMatchObject({ role: "COLLEGE_STAFF", collegeId: "c1" });
  });

  it("a failed write removes the Auth user and creates no documents; the retry works (F2)", async () => {
    const realBatch = h.db.batch.bind(h.db);
    h.db.batch = () => ({ set() { return this; }, commit: async () => { throw new Error("commit failed"); } }) as never;
    expect((await post(body())).status).toBe(500);
    expect(h.auth.users.size).toBe(0);
    expect(staffDocs()).toHaveLength(0);

    h.db.batch = realBatch;
    expect((await post(body())).status).toBe(201);
    expect(h.auth.users.size).toBe(1);
  });

  it("an employee ID held by a faculty member in ANY college is refused before any login is created (F6)", async () => {
    h.db.docs.set("colleges/other/facultyMembers/f1", { employeeId: "S-100" });
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(h.auth.users.size).toBe(0);
    expect(staffDocs()).toHaveLength(0);
  });

  it("an employee ID held by another staff member of this college is refused, but another college's staff ID does not clash (F6)", async () => {
    h.db.docs.set(`${C}/supportingStaff/x`, { employeeId: "S-100" });
    expect((await post(body())).status).toBe(409);
    h.db.docs.delete(`${C}/supportingStaff/x`);
    h.db.docs.set("colleges/other/supportingStaff/y", { employeeId: "S-100" });
    expect((await post(body())).status).toBe(201);
  });

  it("an in-use email is a 409 that leaves the other account untouched", async () => {
    h.db.docs.set("systemUsers/owner", { role: "HOD" });
    h.auth.users.set("owner", { uid: "owner", email: "clerk@vit.edu", password: "theirs", disabled: false, customClaims: {} });
    expect((await post(body())).status).toBe(409);
    expect(h.auth.users.get("owner")?.password).toBe("theirs");
    expect(staffDocs()).toHaveLength(0);
  });

  it("required fields and role gates still apply", async () => {
    expect((await post(body({ employeeId: "" }))).status).toBe(400);
    expect((await post(body({ panNo: "" }))).status).toBe(400);
    h.session = { collegeId: "c1", uid: "x", role: "PANEL_MEMBER" };
    expect((await post(body())).status).toBe(401);
    expect(h.auth.users.size).toBe(0);
  });
});
