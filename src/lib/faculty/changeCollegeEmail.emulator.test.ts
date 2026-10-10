import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// College Office changes a faculty member's COLLEGE EMAIL, through the REAL routes on a real Firestore (the local
// emulator) with a fake Firebase Auth: every copy changes together, nothing else moves, the person is signed out
// everywhere, only an in-app notification is written, and the other paths that used to change it half-way now refuse.
// Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-ce "npx vitest run src/lib/faculty/changeCollegeEmail.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
process.env.SESSION_SECRET = "test-secret";

const who = { uid: "office1", role: "COLLEGE_OFFICE" as string };
const sendMail = vi.fn();
const verifyPasswordSpy = vi.fn(async () => "ok" as const);
let tokenClaims: Record<string, unknown> = {};

// ── fake Firebase Auth ──────────────────────────────────────────────────────────────────────────────────────────────
type AuthUser = { uid: string; email: string };
const authUsers = new Map<string, AuthUser>();
const authCalls = { revoke: [] as string[], update: [] as { uid: string; email?: string }[] };
const fakeAuth = {
  getUser: async (uid: string) => { const u = authUsers.get(uid); if (!u) throw Object.assign(new Error("nf"), { code: "auth/user-not-found" }); return u; },
  getUserByEmail: async (email: string) => { const u = [...authUsers.values()].find((x) => x.email.toLowerCase() === email.toLowerCase()); if (!u) throw Object.assign(new Error("nf"), { code: "auth/user-not-found" }); return u; },
  updateUser: async (uid: string, p: { email?: string }) => {
    authCalls.update.push({ uid, email: p.email });
    if (p.email && [...authUsers.values()].some((x) => x.uid !== uid && x.email.toLowerCase() === p.email!.toLowerCase())) throw Object.assign(new Error("dup"), { code: "auth/email-already-exists" });
    const u = authUsers.get(uid); if (u && p.email) u.email = p.email; return u;
  },
  revokeRefreshTokens: async (uid: string) => { authCalls.revoke.push(uid); },
};

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ce" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => fakeAuth };
});
vi.mock("@/lib/auth/verifySession", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/verifySession")>()),
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  requireSuperAdmin: async () => ({ uid: "sa", role: "SUPER_ADMIN", collegeId: "" }),
  verifySession: async () => (cookie ? { uid: cookie.uid, email: "x", role: "PANEL_MEMBER", realRole: "PANEL_MEMBER", roles: ["PANEL_MEMBER"], collegeId: "c1", locationId: "", exp: Date.now() / 1000 + 3600, ...(cookie.iat !== undefined ? { iat: cookie.iat } : {}) } : null),
  isDepartmentOffice: () => false,
}));
vi.mock("@/lib/auth/verifyFirebaseToken", () => ({ verifyFirebaseToken: async () => tokenClaims }));
vi.mock("@/lib/firebase/authRest", () => ({ verifyPassword: (...a: unknown[]) => (verifyPasswordSpy as (...x: unknown[]) => unknown)(...a) }));
vi.mock("@/lib/email/mailer", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

let cookie: { uid: string; iat?: number } | null = null;
const C = "c1";

describe.skipIf(!EMULATOR)("College Office: change a faculty member's college email (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ce" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const fac = async (id = "f1") => (await col("facultyMembers").doc(id).get()).data() as Record<string, unknown>;
  const usr = async (uid = "u1") => (await col("users").doc(uid).get()).data() as Record<string, unknown>;
  const sys = async (uid = "u1") => (await db().collection("systemUsers").doc(uid).get()).data() as Record<string, unknown>;
  const snapshot = async () => {
    const out: Record<string, unknown> = {};
    for (const n of ["facultyMembers", "users", "supportingStaff"]) for (const d of (await col(n).get()).docs) out[`${n}/${d.id}`] = d.data();
    for (const d of (await db().collection("systemUsers").get()).docs) out[`systemUsers/${d.id}`] = d.data();
    return JSON.stringify(out, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
  };

  const change = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/[id]/college-email/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const check = async (id: string, email?: string) => {
    const { GET } = await import("@/app/api/college/faculty/[id]/college-email/check/route");
    const res = await GET(new Request(`http://x/check${email ? `?email=${encodeURIComponent(email)}` : ""}`), { params: Promise.resolve({ id }) });
    return { status: res.status, json: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  beforeEach(async () => {
    for (const n of ["facultyMembers", "users", "supportingStaff", "auditLogs", "notifications"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    for (const d of (await db().collection("systemUsers").get()).docs) await d.ref.delete();
    who.uid = "office1"; who.role = "COLLEGE_OFFICE"; cookie = null; tokenClaims = {};
    authUsers.clear(); authCalls.revoke = []; authCalls.update = []; sendMail.mockClear(); verifyPasswordSpy.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mk = async (fid: string, uid: string, emp: string, email: string, extra: Record<string, unknown> = {}) => {
      authUsers.set(uid, { uid, email });
      await col("facultyMembers").doc(fid).set({ collegeId: C, userUid: uid, employeeId: emp, legalName: `NAME ${emp}`, collegeEmail: email, email: `${emp.toLowerCase()}@personal.test`, department: "CSE", designation: "ASSISTANT_PROFESSOR", status: "ACTIVE", mobileNo: "9000000001", ...extra });
      await col("users").doc(uid).set({ uid, collegeId: C, role: "PANEL_MEMBER", name: `NAME ${emp}`, email, isActive: true, seatRoles: [] });
      await db().collection("systemUsers").doc(uid).set({ uid, collegeId: C, role: "PANEL_MEMBER", email, name: `NAME ${emp}` });
    };
    await mk("f1", "u1", "E001", "asha@college.test");
    await col("users").doc("u1").update({ collegeEmail: "asha@college.test" });
    await mk("f2", "u2", "E002", "ravi@college.test");
    // a faculty member whose record and login already disagree (like VTH001 / VTH004 in the test college)
    await mk("f3", "u3", "E003", "record-email@college.test");
    authUsers.get("u3")!.email = "login-email@college.test";
    await col("users").doc("u3").update({ email: "login-email@college.test" });
    // a faculty member with a record but no login
    await col("facultyMembers").doc("f4").set({ collegeId: C, employeeId: "E004", legalName: "NO LOGIN", collegeEmail: "nologin@college.test", department: "CSE", status: "ACTIVE" });
    await col("supportingStaff").doc("s1").set({ collegeId: C, employeeId: "S001", legalName: "STAFF", collegeEmail: "staff@college.test", userUid: "su1" });
    authUsers.set("other", { uid: "other", email: "someone@else.test" });
  });

  describe("the change", () => {
    it("updates every copy together, keeps the old address, and moves nothing else", async () => {
      const beforeFac = await fac(); const beforeUsr = await usr();
      const r = await change("f1", { employeeId: "E001", newEmail: "  Asha.New@College.Test " });
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ changed: true, oldEmail: "asha@college.test", newEmail: "asha.new@college.test", signedOut: true });

      expect(authUsers.get("u1")!.email).toBe("asha.new@college.test");
      const f = await fac();
      expect(f).toMatchObject({ collegeEmail: "asha.new@college.test", employeeId: "E001", userUid: "u1", email: "e001@personal.test" });
      expect(f.emailChangePending).toBeUndefined();
      expect((f.collegeEmailHistory as { email: string; changedBy: string }[])).toMatchObject([{ email: "asha@college.test", changedBy: "office1" }]);
      const u = await usr();
      expect(u).toMatchObject({ email: "asha.new@college.test", collegeEmail: "asha.new@college.test", role: "PANEL_MEMBER", isActive: true });
      expect((await sys()).email).toBe("asha.new@college.test");
      // nothing else on the record or the login moved
      for (const k of Object.keys(beforeFac)) if (!["collegeEmail", "updatedAt"].includes(k)) expect(f[k], k).toEqual(beforeFac[k]);
      for (const k of Object.keys(beforeUsr)) if (!["email", "collegeEmail", "updatedAt"].includes(k)) expect(u[k], k).toEqual(beforeUsr[k]);
      // the other faculty are untouched
      expect(await fac("f2")).toMatchObject({ collegeEmail: "ravi@college.test" });
      expect(authUsers.get("u2")!.email).toBe("ravi@college.test");
    });

    it("users.collegeEmail is only written where that field already exists", async () => {
      await change("f2", { employeeId: "E002", newEmail: "ravi.new@college.test" });
      const u = await usr("u2");
      expect(u.email).toBe("ravi.new@college.test");
      expect("collegeEmail" in u).toBe(false);
    });

    it("signs the person out everywhere: refresh tokens revoked and a sign-out stamp written", async () => {
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      expect(authCalls.revoke).toEqual(["u1"]);
      const stamp = (await usr()).sessionsValidAfter as number;
      expect(stamp).toBeGreaterThan(Date.now() / 1000);
      expect((await usr("u2")).sessionsValidAfter).toBeUndefined();
    });

    it("writes an audit entry and ONLY an in-app notification (no mail is sent)", async () => {
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      const logs = (await col("auditLogs").get()).docs.map((d) => d.data());
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: "FACULTY_COLLEGE_EMAIL_CHANGED", performedBy: "office1", targetId: "f1" });
      expect(logs[0].details).toMatchObject({ employeeId: "E001", from: "asha@college.test", to: "asha.new@college.test" });
      const notes = (await col("notifications").get()).docs.map((d) => d.data());
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ toUid: "u1", type: "COLLEGE_EMAIL_CHANGED" });
      expect(String(notes[0].message)).toContain("asha.new@college.test");
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("the same address is a no-op that signs nobody out", async () => {
      const before = await snapshot();
      const r = await change("f1", { employeeId: "E001", newEmail: "ASHA@college.test" });
      expect(r.status).toBe(200);
      expect(r.json.changed).toBe(false);
      expect(await snapshot()).toBe(before);
      expect(authCalls.revoke).toEqual([]);
    });

    it("a faculty member with no login only has their record changed", async () => {
      const r = await change("f4", { employeeId: "E004", newEmail: "nologin.new@college.test" });
      expect(r.status).toBe(200);
      expect(r.json.signedOut).toBe(false);
      expect(await fac("f4")).toMatchObject({ collegeEmail: "nologin.new@college.test" });
      expect(authCalls.update).toEqual([]);
      expect(authCalls.revoke).toEqual([]);
    });
  });

  describe("refusals change nothing", () => {
    it("only the College Office can do it", async () => {
      for (const role of ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL"]) {
        who.role = role;
        expect((await change("f1", { employeeId: "E001", newEmail: "x@college.test" })).status, role).toBe(401);
        expect((await check("f1")).status, role).toBe(401);
      }
      expect((await fac()).collegeEmail).toBe("asha@college.test");
    });

    it("the Employee ID must match the record (409), the email must be valid (400), the body complete (400)", async () => {
      const before = await snapshot();
      expect((await change("f1", { employeeId: "E999", newEmail: "x@college.test" })).json.code).toBe("EMPLOYEE_ID_MISMATCH");
      expect((await change("f1", { employeeId: "E001", newEmail: "not-an-email" })).status).toBe(400);
      expect((await change("f1", { newEmail: "x@college.test" })).status).toBe(400);
      expect((await change("missing", { employeeId: "E001", newEmail: "x@college.test" })).status).toBe(404);
      expect(await snapshot()).toBe(before);
      expect(authCalls.update).toEqual([]);
    });

    it("an address already used - by another login, faculty, staff or account, in any case - is refused", async () => {
      const before = await snapshot();
      for (const taken of ["someone@else.test", "RAVI@college.test", "staff@college.test", "nologin@college.test"]) {
        const r = await change("f1", { employeeId: "E001", newEmail: taken });
        expect(r.status, taken).toBe(409);
        expect(r.json.code).toBe("EMAIL_TAKEN");
      }
      expect(await snapshot()).toBe(before);
      expect(authCalls.update).toEqual([]);
    });

    it("an out-of-sync account (record and login emails differ) is refused and left exactly as it was", async () => {
      const before = await snapshot();
      const r = await change("f3", { employeeId: "E003", newEmail: "fixed@college.test" });
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ code: "EMAIL_OUT_OF_SYNC", recordEmail: "record-email@college.test", loginEmail: "login-email@college.test" });
      expect(await snapshot()).toBe(before);
      expect(authCalls.update).toEqual([]);
      expect(authCalls.revoke).toEqual([]);
      const c = await check("f3");
      expect(c.json).toMatchObject({ inSync: false, loginEmail: "login-email@college.test", recordEmail: "record-email@college.test" });
    });

    it("the live check reports availability without writing anything", async () => {
      const before = await snapshot();
      expect((await check("f1", "free@college.test")).json).toMatchObject({ available: true, inSync: true, loginEmail: "asha@college.test" });
      expect((await check("f1", "ravi@college.test")).json.available).toBe(false);
      expect((await check("f1", "bad")).json.available).toBe(false);
      expect((await check("f1", "asha@college.test")).json.reason).toMatch(/already their college email/);
      expect(await snapshot()).toBe(before);
    });
  });

  describe("failures are put right", () => {
    it("if the Firestore write fails the login goes back to the old email and the marker is cleared", async () => {
      const { changeFacultyCollegeEmail } = await import("@/lib/faculty/changeCollegeEmail");
      const real = db();
      const failing = {
        collection: real.collection.bind(real),
        batch: () => { const b = real.batch(); return new Proxy(b, { get: (t, p) => (p === "commit" ? async () => { throw new Error("boom"); } : (t as any)[p].bind(t)) }); }, // eslint-disable-line @typescript-eslint/no-explicit-any
      } as unknown as FirebaseFirestore.Firestore;
      const before = await snapshot();
      await expect(changeFacultyCollegeEmail(failing, fakeAuth as never, { collegeId: C, facultyId: "f1", expectedEmployeeId: "E001", newEmail: "asha.new@college.test", actor: { uid: "office1" } })).rejects.toThrow("boom");
      expect(authUsers.get("u1")!.email).toBe("asha@college.test");
      expect(await snapshot()).toBe(before);
      expect(authCalls.revoke).toEqual([]);
    });

    it("an interrupted change (login already renamed, marker left behind) is finished by sending the same email again", async () => {
      authUsers.get("u1")!.email = "asha.new@college.test"; // step 2 happened, step 3 never did
      await col("facultyMembers").doc("f1").update({ emailChangePending: { from: "asha@college.test", to: "asha.new@college.test", at: new Date(), by: "office1" } });
      const r = await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      expect(r.status).toBe(200);
      const f = await fac();
      expect(f.collegeEmail).toBe("asha.new@college.test");
      expect(f.emailChangePending).toBeUndefined();
      expect((f.collegeEmailHistory as { email: string }[]).map((h) => h.email)).toEqual(["asha@college.test"]);
      expect((await usr()).email).toBe("asha.new@college.test");
      expect(authCalls.update).toEqual([]); // the login was already on the new address
    });
  });

  describe("signed out everywhere", () => {
    it("every session issued before the change is refused; one issued after is fine; other people are unaffected", async () => {
      const { resolveHeldRoles } = await import("@/lib/auth/liveRoles");
      const session = (uid: string, iat?: number) => ({ uid, role: "PANEL_MEMBER", collegeId: C, roles: ["PANEL_MEMBER"], ...(iat !== undefined ? { iat } : {}) });
      const issuedBefore = Math.floor(Date.now() / 1000) - 600;
      expect(await resolveHeldRoles(session("u1", issuedBefore))).toEqual(["PANEL_MEMBER"]);
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      expect(await resolveHeldRoles(session("u1", issuedBefore))).toEqual([]);
      expect(await resolveHeldRoles(session("u1"))).toEqual([]); // an older cookie with no iat
      expect(await resolveHeldRoles(session("u1", Math.floor(Date.now() / 1000) + 5))).toEqual(["PANEL_MEMBER"]);
      expect(await resolveHeldRoles(session("u2", issuedBefore))).toEqual(["PANEL_MEMBER"]);
      expect(await resolveHeldRoles(session("u2"))).toEqual(["PANEL_MEMBER"]);
    });

    it("/api/auth/session refuses an old Firebase token (SESSION_REVOKED, no cookie) and accepts one issued after", async () => {
      const issuedBefore = Math.floor(Date.now() / 1000) - 600;
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      const { POST } = await import("@/app/api/auth/session/route");
      tokenClaims = { uid: "u1", email: "asha.new@college.test", role: "PANEL_MEMBER", collegeId: C, exp: Math.floor(Date.now() / 1000) + 3000, iat: issuedBefore };
      const old = await POST(new Request("http://localhost/api/auth/session", { method: "POST", body: JSON.stringify({ token: "t" }) }));
      expect(old.status).toBe(401);
      expect(((await old.json()) as { code: string }).code).toBe("SESSION_REVOKED");
      expect(old.headers.get("set-cookie") ?? "").not.toMatch(/fms-session=v1\./);

      tokenClaims = { ...tokenClaims, iat: Math.floor(Date.now() / 1000) + 5 };
      const fresh = await POST(new Request("http://localhost/api/auth/session", { method: "POST", body: JSON.stringify({ token: "t" }) }));
      expect(fresh.status).toBe(200);
      expect(fresh.headers.get("set-cookie") ?? "").toMatch(/fms-session=v1\./);
    });

    it("a normal sign-in for anyone else still works and the cookie carries the token's iat", async () => {
      const { POST } = await import("@/app/api/auth/session/route");
      const { readSession } = await import("@/lib/auth/sessionToken");
      tokenClaims = { uid: "u2", email: "ravi@college.test", role: "PANEL_MEMBER", collegeId: C, exp: Math.floor(Date.now() / 1000) + 3000, iat: 1234567890 };
      const res = await POST(new Request("http://localhost/api/auth/session", { method: "POST", body: JSON.stringify({ token: "t" }) }));
      expect(res.status).toBe(200);
      const raw = /fms-session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
      expect(await readSession<{ iat?: number }>(raw)).toMatchObject({ iat: 1234567890 });
    });

    it("the session-check probe says SESSION_REVOKED for a signed-out device and ok for everyone else", async () => {
      const { GET } = await import("@/app/api/auth/session-check/route");
      const now = Math.floor(Date.now() / 1000);
      cookie = { uid: "u1", iat: now - 600 };
      expect(((await (await GET()).json()) as { ok: boolean }).ok).toBe(true);
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      const res = await GET();
      expect(res.status).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe("SESSION_REVOKED");
      cookie = { uid: "u2", iat: now - 600 };
      expect((await GET()).status).toBe(200);
      cookie = null;
      const none = await GET();
      expect(none.status).toBe(401);
      expect(((await none.json()) as { code: string }).code).toBe("NO_SESSION");
    });
  });

  describe("Employee ID stays the primary key", () => {
    it("Employee-ID sign-in resolves to the NEW email after the change", async () => {
      await change("f1", { employeeId: "E001", newEmail: "asha.new@college.test" });
      const { POST } = await import("@/app/api/auth/employee-login/route");
      const createCustomToken = vi.fn(async () => "custom");
      (fakeAuth as Record<string, unknown>).createCustomToken = createCustomToken;
      const res = await POST(new Request("http://x/login", { method: "POST", body: JSON.stringify({ employeeId: "E001", password: "existing-password" }) }));
      expect(res.status).toBe(200);
      expect(verifyPasswordSpy).toHaveBeenCalledWith("asha.new@college.test", "existing-password");
      expect(createCustomToken).toHaveBeenCalledWith("u1");
    });
  });

  describe("the other paths that used to change the login email half-way now refuse", () => {
    it("HOD / Principal faculty edit: a different collegeEmail is refused, the unchanged one the edit page re-sends is ignored", async () => {
      who.role = "PRINCIPAL";
      const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
      const patch = (b: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(b) }), { params: Promise.resolve({ id: "f1" }) });
      const refused = await patch({ collegeEmail: "sneaky@college.test", specialization: "AI" });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { code: string }).code).toBe("COLLEGE_EMAIL_MANAGED_BY_OFFICE");
      expect((await fac()).collegeEmail).toBe("asha@college.test");
      expect((await fac()).specialization).toBeUndefined();
      expect((await patch({ collegeEmail: "ASHA@college.test", specialization: "AI" })).status).toBe(200);
      expect(await fac()).toMatchObject({ collegeEmail: "asha@college.test", specialization: "AI" });
    });

    it("Staff edit (college/users/[uid]) of a faculty login: a different email is refused, an unchanged one is fine", async () => {
      who.role = "PRINCIPAL";
      const { PATCH } = await import("@/app/api/college/users/[uid]/route");
      const patch = (b: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(b) }), { params: Promise.resolve({ uid: "u1" }) });
      expect((await patch({ collegeEmail: "sneaky@college.test" })).status).toBe(409);
      expect((await patch({ email: "sneaky@college.test" })).status).toBe(409);
      expect(authCalls.update).toEqual([]);
      expect((await usr()).email).toBe("asha@college.test");
      expect((await patch({ email: "asha@college.test", collegeEmail: "asha@college.test", name: "NAME E001" })).status).toBe(200);
    });

    it("Super Admin user edit and a faculty member's own users/me save refuse an email change too", async () => {
      const admin = await import("@/app/api/admin/users/[uid]/route");
      const res = await admin.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ collegeId: C, collegeEmail: "sneaky@college.test" }) }), { params: Promise.resolve({ uid: "u1" }) });
      expect(res.status).toBe(409);
      expect((await usr()).collegeEmail).toBe("asha@college.test");

      who.uid = "u1"; who.role = "HOD"; // a faculty member holding the HOD seat reaches users/me as HOD
      const me = await import("@/app/api/college/users/me/route");
      const own = await me.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ email: "sneaky@college.test" }) }));
      expect(own.status).toBe(409);
      expect((await usr()).email).toBe("asha@college.test");
    });
  });
});
