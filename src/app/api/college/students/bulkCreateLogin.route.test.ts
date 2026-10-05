import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

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

import { POST } from "./bulk-create-login/route";

const C = "colleges/c1";
const PW = "Common-initial-1";
const post = (body: unknown) => POST(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({
    [`${C}/students/s1`]: { name: "A", rollNumber: "R1", status: "REGULAR" },
    [`${C}/students/s2`]: { name: "B", rollNumber: "R2", status: "REGULAR" },
    [`${C}/students/noroll`]: { name: "C", status: "REGULAR" },
  });
});

describe("POST /students/bulk-create-login (S1/S3)", () => {
  it("one password for all: every login gets exactly it, nothing is generated, nothing is echoed or stored", async () => {
    const res = await post({ studentIds: ["s1", "s2", "noroll", "ghost", "s1"], password: PW });
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.created.map((c: { id: string }) => c.id).sort()).toEqual(["s1", "s2"]);
    expect(body.skipped.map((s: { id: string }) => s.id).sort()).toEqual(["ghost", "noroll"]);
    expect(text).not.toContain(PW);
    expect([...h.auth.users.values()].map((u) => u.password)).toEqual([PW, PW]);
    expect([...h.auth.users.values()].map((u) => u.email).sort()).toEqual(["r1@students.internal", "r2@students.internal"]);
    expect(JSON.stringify([...h.db.docs.entries()])).not.toContain(PW);
  });

  it("a different password per student with `logins`", async () => {
    const body = await (await post({ logins: [{ id: "s1", password: "Password-for-A1" }, { id: "s2", password: "Password-for-B2" }] })).json();
    expect(body.created).toHaveLength(2);
    const byEmail = Object.fromEntries([...h.auth.users.values()].map((u) => [u.email, u.password]));
    expect(byEmail).toEqual({ "r1@students.internal": "Password-for-A1", "r2@students.internal": "Password-for-B2" });
  });

  it("with `logins`, a weak password skips ITS student only, with the reason", async () => {
    const body = await (await post({ logins: [{ id: "s1", password: "x" }, { id: "s2", password: "Password-for-B2" }] })).json();
    expect(body.created.map((c: { id: string }) => c.id)).toEqual(["s2"]);
    expect(body.skipped).toEqual([{ id: "s1", reason: expect.stringMatching(/at least/) }]);
    expect(h.auth.users.size).toBe(1);
  });

  it("a student who already has a login is reported, not re-created or changed", async () => {
    await post({ studentIds: ["s1"], password: PW });
    const again = await (await post({ studentIds: ["s1"], password: "Another-password-2" })).json();
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([{ id: "s1", reason: "Already has a login" }]);
    expect(h.auth.users.size).toBe(1);
    expect([...h.auth.users.values()][0].password).toBe(PW);
  });

  it("a roll held by a student of another college is skipped with a generic reason", async () => {
    h.db.docs.set("colleges/c2/students/z1", { name: "Zed", rollNumber: "R1", status: "REGULAR" });
    h.db.docs.set("studentUsernames/R1", { collegeId: "c2", studentDocId: "z1", name: "Zed", active: true, createdAt: new Date() });
    const body = await (await post({ studentIds: ["s1", "s2"], password: PW })).json();
    expect(body.created.map((c: { id: string }) => c.id)).toEqual(["s2"]);
    expect(body.skipped[0].id).toBe("s1");
    expect(body.skipped[0].reason).toMatch(/another college/);
    expect(JSON.stringify(body)).not.toContain("Zed");
  });

  it("an unexpected failure is reported generically - raw internals are not echoed to the client", async () => {
    h.auth.failNext.createUser = new Error("INTERNAL: projects/secret-project/accounts failed");
    const body = await (await post({ studentIds: ["s1"], password: PW })).json();
    expect(body.skipped).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/secret-project/);
    expect(h.db.get(`${C}/students/s1`)?.uid).toBeUndefined();
  });

  it("validates input and role: no ids, no/weak common password, too many, malformed JSON", async () => {
    expect((await post({ studentIds: [], password: PW })).status).toBe(400);
    expect((await post({ studentIds: ["s1"] })).status).toBe(400);
    expect((await post({ studentIds: ["s1"], password: "short" })).status).toBe(400);
    expect((await post({ logins: [] })).status).toBe(400);
    expect((await post({ studentIds: Array.from({ length: 401 }, (_, i) => `x${i}`), password: PW })).status).toBe(400);
    expect((await POST(new Request("http://localhost/x", { method: "POST", body: "{bad" }))).status).toBe(400);
    expect(h.auth.users.size).toBe(0);
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await post({ studentIds: ["s1"], password: PW })).status).toBe(401);
  });
});
