import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// S1 (passwords chosen by the office, never generated), S3 (global roll identity),
// S5 (bulk archive), against in-memory fakes only.

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

import { POST as bulkDelete } from "./bulk-delete/route";
import { POST as createLogin } from "./[id]/create-login/route";
import { POST as resetPassword } from "./[id]/reset-login-password/route";

const C = "colleges/c1";
const PW = "Typed-by-office-1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const rawReq = (raw: string) => new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: raw });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({
    [`${C}/users/office1`]: { name: "Office" },
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "24PA1A0501", status: "REGULAR", department: "CSE", year: 1, section: "A" },
    [`${C}/students/s2`]: { name: "Bala", rollNumber: "24PA1A0502", status: "REGULAR", department: "CSE", year: 1, section: "A" },
    [`${C}/students/detained`]: { name: "Det", rollNumber: "24PA1A0599", status: "DETAINED" },
    [`${C}/students/noroll`]: { name: "No Roll", status: "REGULAR" },
  });
});

describe("POST /students/[id]/create-login", () => {
  it("creates the login with EXACTLY the typed password on the global roll identity; the password is stored nowhere else and never returned", async () => {
    const res = await createLogin(req({ password: PW }), params("s1"));
    const text = await res.text();
    expect(res.status).toBe(200);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ ok: true, alreadyExisted: false, loginEmail: "24pa1a0501@students.internal" });
    expect(text).not.toContain(PW);
    expect(body).not.toHaveProperty("password");

    expect(h.auth.users.get(body.uid)).toMatchObject({ email: body.loginEmail, password: PW, customClaims: { role: "STUDENT", collegeId: "c1" } });
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ uid: body.uid, loginEmail: body.loginEmail });
    expect(h.db.get(`${C}/students/s1`)).not.toHaveProperty("mustChangePassword");
    expect(h.db.get(`${C}/users/${body.uid}`)).toMatchObject({ role: "STUDENT" });
    expect(h.db.get("studentUsernames/24PA1A0501")).toMatchObject({ uid: body.uid, collegeId: "c1", active: true });
    expect(JSON.stringify([...h.db.docs.entries()])).not.toContain(PW);
  });

  it("no password, a weak one, or a bad body is a 400 and nothing is created", async () => {
    for (const body of [{}, { password: "" }, { password: "short" }, { password: " Abcdef12" }, { password: 12345678 }]) {
      expect((await createLogin(req(body), params("s1"))).status).toBe(400);
    }
    expect((await createLogin(rawReq("{not json"), params("s1"))).status).toBe(400);
    expect((await createLogin(new Request("http://localhost/x", { method: "POST" }), params("s1"))).status).toBe(400);
    expect(h.auth.users.size).toBe(0);
    expect(h.auth.calls).toHaveLength(0);
  });

  it("the same roll in ANOTHER college is refused (409) - roll numbers are globally unique - and the first account is untouched", async () => {
    const first = await (await createLogin(req({ password: PW }), params("s1"))).json();
    h.db.docs.set("colleges/c2/students/x1", { name: "Other College", rollNumber: "24-pa1a0501", status: "REGULAR" });
    h.session = { collegeId: "c2", uid: "office2", role: "COLLEGE_OFFICE" };
    const res = await createLogin(req({ password: "Another-password-2" }), params("x1"));
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("Anil");
    expect(h.auth.users.size).toBe(1);
    expect(h.auth.users.get(first.uid)).toMatchObject({ password: PW, customClaims: { role: "STUDENT", collegeId: "c1" } });
    expect(h.db.get("studentUsernames/24PA1A0501")).toMatchObject({ collegeId: "c1", uid: first.uid });
  });

  it("re-running is a no-op: no second Auth user, the password is not changed", async () => {
    await createLogin(req({ password: PW }), params("s1"));
    const again = await (await createLogin(req({ password: "Different-password-3" }), params("s1"))).json();
    expect(again).toMatchObject({ ok: true, alreadyExisted: true });
    expect(h.auth.users.size).toBe(1);
    expect([...h.auth.users.values()][0].password).toBe(PW);
  });

  it("a failed write rolls the new Auth user back and a retry succeeds", async () => {
    const realBatch = h.db.batch.bind(h.db);
    h.db.batch = () => ({ set() { return this; }, update() { return this; }, commit: async () => { throw new Error("commit failed"); } }) as never;
    expect((await createLogin(req({ password: PW }), params("s1"))).status).toBe(500);
    expect(h.auth.users.size).toBe(0);
    expect(h.db.get(`${C}/students/s1`)?.uid).toBeUndefined();

    h.db.batch = realBatch;
    expect((await createLogin(req({ password: PW }), params("s1"))).status).toBe(200);
    expect(h.auth.users.size).toBe(1);
  });

  it("refuses a student with no roll, a non-REGULAR student, and an unknown id", async () => {
    expect((await createLogin(req({ password: PW }), params("noroll"))).status).toBe(400);
    expect((await createLogin(req({ password: PW }), params("detained"))).status).toBe(400);
    expect((await createLogin(req({ password: PW }), params("nope"))).status).toBe(404);
    expect(h.auth.users.size).toBe(0);
  });

  it("only the College Office can issue logins", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await createLogin(req({ password: PW }), params("s1"))).status).toBe(401);
    expect(h.auth.users.size).toBe(0);
  });
});

describe("POST /students/[id]/reset-login-password", () => {
  it("sets the typed password in Firebase Auth only - the old one stops working, nothing is returned or stored", async () => {
    const created = await (await createLogin(req({ password: PW }), params("s1"))).json();
    const writes = h.db.writeLog.length;
    const res = await resetPassword(req({ password: "Reset-by-office-9" }), params("s1"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toContain("Reset-by-office-9");
    expect(h.auth.users.get(created.uid)?.password).toBe("Reset-by-office-9");
    expect(JSON.stringify([...h.db.docs.entries()])).not.toContain("Reset-by-office-9");
    // Only the audit entry is written - not a flag on the student.
    expect(h.db.writeLog.length - writes).toBe(1);
    expect(h.db.get(`${C}/students/s1`)).not.toHaveProperty("mustChangePassword");
  });

  it("a weak or missing password is a 400 and the existing password is kept", async () => {
    const created = await (await createLogin(req({ password: PW }), params("s1"))).json();
    for (const body of [{}, { password: "short" }, { password: "Abcdef12 " }]) {
      expect((await resetPassword(req(body), params("s1"))).status).toBe(400);
    }
    expect(h.auth.users.get(created.uid)?.password).toBe(PW);
  });

  it("400 for a student with no login, 404 for unknown, 401 for other roles", async () => {
    expect((await resetPassword(req({ password: PW }), params("s1"))).status).toBe(400);
    expect((await resetPassword(req({ password: PW }), params("nope"))).status).toBe(404);
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await resetPassword(req({ password: PW }), params("s1"))).status).toBe(401);
  });
});

describe("POST /students/bulk-delete (archive)", () => {
  it("archives the whole selection, reports blocked/skipped/failed separately, erases nothing", async () => {
    h.db.docs.set(`${C}/bookLoans/l1`, { studentId: "s2", status: "ACTIVE" });
    const res = await bulkDelete(req({ studentIds: ["s1", "s2", "ghost", "s1"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deletedCount: 1, archivedCount: 1, skipped: ["ghost"], failed: [] });
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0].id).toBe("s2");

    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
    expect(h.db.get(`${C}/archivedStudents/s1`)).toMatchObject({ archiveReason: "BULK_REMOVED_BY_USER" });
    expect(h.db.get(`${C}/students/s2`)).toBeDefined(); // blocked -> untouched
  });

  it("one student failing does not stop the others, and is reported for a retry", async () => {
    h.auth.users.set("u1", { uid: "u1", email: "a@students.internal", password: "p", disabled: false, customClaims: {} });
    h.db.docs.set(`${C}/students/s1`, { ...h.db.get(`${C}/students/s1`)!, uid: "u1", loginEmail: "a@students.internal" });
    h.auth.failNext.updateUser = new Error("auth hiccup");
    const res = await bulkDelete(req({ studentIds: ["s1", "s2"] }));
    const body = await res.json();
    expect(body.failed).toHaveLength(1);
    expect(body.archivedCount).toBe(1);
    // The failed one is still live and can simply be removed again.
    expect(h.db.get(`${C}/students/s1`)).toBeDefined();
    const retry = await (await bulkDelete(req({ studentIds: ["s1"] }))).json();
    expect(retry.archivedCount).toBe(1);
    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
  });

  it("validates input and role", async () => {
    expect((await bulkDelete(req({ studentIds: [] }))).status).toBe(400);
    expect((await bulkDelete(req({ studentIds: "s1" }))).status).toBe(400);
    expect((await bulkDelete(req({ studentIds: ["ghost"] }))).status).toBe(400);
    expect((await bulkDelete(req({ studentIds: Array.from({ length: 401 }, (_, i) => `x${i}`) }))).status).toBe(400);
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await bulkDelete(req({ studentIds: ["s1"] }))).status).toBe(401);
    expect(h.db.get(`${C}/students/s1`)).toBeDefined();
  });
});
