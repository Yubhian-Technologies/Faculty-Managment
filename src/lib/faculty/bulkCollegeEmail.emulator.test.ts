import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Bulk "Change College Email" through the REAL route on a real Firestore (the local emulator) with a fake Firebase Auth.
// Every row must behave exactly like the single Change College Email button - and a refused row must change nothing and
// never stop the rows after it. Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-bce "npx vitest run src/lib/faculty/bulkCollegeEmail.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "office1", role: "COLLEGE_OFFICE" as string };
const sendMail = vi.fn();

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
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-bce" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => fakeAuth };
});
vi.mock("@/lib/auth/verifySession", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/verifySession")>()),
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
}));
vi.mock("@/lib/email/mailer", () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }));

const C = "c1";
type Row = { fileRow?: number; employeeId?: unknown; newEmail?: unknown };

describe.skipIf(!EMULATOR)("bulk change of faculty college emails (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-bce" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const fac = async (id: string) => (await col("facultyMembers").doc(id).get()).data() as Record<string, unknown>;
  const usr = async (uid: string) => (await col("users").doc(uid).get()).data() as Record<string, unknown>;
  const docState = async (fid: string, uid?: string) => JSON.stringify({ f: await fac(fid), u: uid ? await usr(uid) : null, a: uid ? authUsers.get(uid) : null },
    (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));

  type Res = { fileRow: number; employeeId: string; status: string; code?: string; message: string; oldEmail?: string; newEmail?: string };
  const run = async (records: Row[]) => {
    const { POST } = await import("@/app/api/college/faculty/college-email-import/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ records }) }));
    return { status: res.status, json: (await res.json()) as { results: Res[]; updated: number; unchanged: number; failed: number; error?: string } };
  };
  const byRow = (r: { results: Res[] }, row: number) => r.results.find((x) => x.fileRow === row)!;

  beforeEach(async () => {
    for (const n of ["facultyMembers", "users", "supportingStaff", "auditLogs", "notifications"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    for (const d of (await db().collection("systemUsers").get()).docs) await d.ref.delete();
    who.uid = "office1"; who.role = "COLLEGE_OFFICE";
    authUsers.clear(); authCalls.revoke = []; authCalls.update = []; sendMail.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mk = async (fid: string, uid: string, emp: string, email: string) => {
      authUsers.set(uid, { uid, email });
      await col("facultyMembers").doc(fid).set({ collegeId: C, userUid: uid, employeeId: emp, legalName: `NAME ${emp}`, collegeEmail: email, email: `${emp.toLowerCase()}@personal.test`, department: "CSE", designation: "ASSISTANT_PROFESSOR", status: "ACTIVE", mobileNo: "9000000001" });
      await col("users").doc(uid).set({ uid, collegeId: C, role: "PANEL_MEMBER", name: `NAME ${emp}`, email, isActive: true, seatRoles: [] });
      await db().collection("systemUsers").doc(uid).set({ uid, collegeId: C, role: "PANEL_MEMBER", email, name: `NAME ${emp}` });
    };
    await mk("f1", "u1", "E001", "asha@college.test");
    await mk("f2", "u2", "E002", "ravi@college.test");
    await mk("f3", "u3", "E003", "record@college.test");        // record and login disagree (like VTH001)
    authUsers.get("u3")!.email = "login@college.test";
    await col("users").doc("u3").update({ email: "login@college.test" });
    await mk("f5", "u5", "E005", "mani@college.test");
    await col("facultyMembers").doc("f4").set({ collegeId: C, employeeId: "E004", legalName: "NO LOGIN", collegeEmail: "nologin@college.test", department: "CSE", status: "ACTIVE" });
    await col("supportingStaff").doc("s1").set({ collegeId: C, employeeId: "S001", legalName: "STAFF", collegeEmail: "staff@college.test" });
    authUsers.set("other", { uid: "other", email: "someone@else.test" });
  });

  it("updates every copy for each good row, signs them out, and writes the audit trail", async () => {
    const r = await run([{ employeeId: "E001", newEmail: "asha.new@college.test" }, { employeeId: "E002", newEmail: "ravi.new@college.test" }]);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ updated: 2, unchanged: 0, failed: 0 });
    for (const [fid, uid, email, old] of [["f1", "u1", "asha.new@college.test", "asha@college.test"], ["f2", "u2", "ravi.new@college.test", "ravi@college.test"]]) {
      expect(await fac(fid)).toMatchObject({ collegeEmail: email });
      expect((await fac(fid)).collegeEmailHistory).toMatchObject([{ email: old }]);
      expect(await usr(uid)).toMatchObject({ email });
      expect((await db().collection("systemUsers").doc(uid).get()).data()!.email).toBe(email);
      expect(authUsers.get(uid)!.email).toBe(email);
      expect(typeof (await usr(uid)).sessionsValidAfter).toBe("number");
    }
    expect(authCalls.revoke.sort()).toEqual(["u1", "u2"]);
    const logs = (await col("auditLogs").get()).docs.map((d) => d.data().action as string).sort();
    expect(logs).toEqual(["FACULTY_COLLEGE_EMAIL_BULK_IMPORT", "FACULTY_COLLEGE_EMAIL_CHANGED", "FACULTY_COLLEGE_EMAIL_CHANGED"]);
    expect((await col("notifications").get()).size).toBe(2);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("the SAME email is reported as already same and nothing is changed (any case / spacing)", async () => {
    const before = await docState("f1", "u1");
    const r = await run([{ employeeId: "E001", newEmail: "  ASHA@College.Test " }]);
    expect(r.json).toMatchObject({ updated: 0, unchanged: 1, failed: 0 });
    expect(byRow(r.json, 2)).toMatchObject({ status: "UNCHANGED", message: "Already the same college email - no update was made" });
    expect(await docState("f1", "u1")).toBe(before);
    expect(authCalls.update).toEqual([]);
    expect(authCalls.revoke).toEqual([]);
    expect((await col("notifications").get()).size).toBe(0);
  });

  it("an email that already exists anywhere is refused for that row only", async () => {
    const before1 = await docState("f1", "u1");
    const r = await run([
      { employeeId: "E001", newEmail: "ravi@college.test" },      // another faculty member's
      { employeeId: "E001", newEmail: "x@y.test" },                // (a repeat of E001 - skipped)
      { employeeId: "E005", newEmail: "someone@else.test" },       // another login in Auth
      { employeeId: "E002", newEmail: "staff@college.test" },      // a staff member's
      { employeeId: "E004", newEmail: "MANI@college.test" },       // another faculty member's, other case
      { employeeId: "E002", newEmail: "ravi.fine@college.test" },  // (E002 repeated - skipped, first row wins)
    ]);
    expect(r.json).toMatchObject({ updated: 0, failed: 6 });
    expect(byRow(r.json, 2)).toMatchObject({ status: "FAILED", code: "EMAIL_TAKEN" });
    expect(byRow(r.json, 3)).toMatchObject({ code: "DUPLICATE_ROW" });
    expect(byRow(r.json, 4)).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(byRow(r.json, 5)).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(byRow(r.json, 6)).toMatchObject({ code: "EMAIL_TAKEN" });
    expect(byRow(r.json, 7)).toMatchObject({ code: "DUPLICATE_ROW" });
    expect(await docState("f1", "u1")).toBe(before1);
    expect(authCalls.update).toEqual([]);
  });

  it("a mixed file: good rows update, bad rows are explained, and no row stops the others", async () => {
    const outOfSyncBefore = await docState("f3", "u3");
    const r = await run([
      { fileRow: 2, employeeId: "E001", newEmail: "asha.new@college.test" },   // updated
      { fileRow: 3, employeeId: "E999", newEmail: "ghost@college.test" },      // no such faculty
      { fileRow: 4, employeeId: "", newEmail: "blank@college.test" },          // no employee id
      { fileRow: 5, employeeId: "E002", newEmail: "" },                        // no email
      { fileRow: 6, employeeId: "E002", newEmail: "not-an-email" },            // invalid
      { fileRow: 7, employeeId: "E003", newEmail: "fixed@college.test" },      // out of sync -> manual review
      { fileRow: 8, employeeId: "E004", newEmail: "nologin.new@college.test" },// no login yet
      { fileRow: 9, employeeId: "e005", newEmail: "mani.new@college.test" },   // Employee ID in other case
      { fileRow: 10, employeeId: "E002", newEmail: "asha.new@college.test" },  // same new email as row 2 -> skipped
      { fileRow: 11, employeeId: "E002", newEmail: "ravi@college.test" },      // already same
    ]);
    expect(r.json).toMatchObject({ updated: 3, unchanged: 1, failed: 6 });
    expect(r.json.results.map((x) => x.fileRow)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(byRow(r.json, 2).status).toBe("UPDATED");
    expect(byRow(r.json, 3)).toMatchObject({ code: "NOT_FOUND" });
    expect(byRow(r.json, 4)).toMatchObject({ code: "MISSING_EMPLOYEE_ID" });
    expect(byRow(r.json, 5)).toMatchObject({ code: "MISSING_EMAIL" });
    expect(byRow(r.json, 6)).toMatchObject({ code: "INVALID_EMAIL" });
    expect(byRow(r.json, 7)).toMatchObject({ code: "EMAIL_OUT_OF_SYNC" });
    expect(byRow(r.json, 8)).toMatchObject({ status: "UPDATED", message: expect.stringContaining("no login yet") });
    expect(byRow(r.json, 9)).toMatchObject({ status: "UPDATED", employeeId: "E005" });
    expect(byRow(r.json, 10)).toMatchObject({ code: "DUPLICATE_EMAIL_IN_FILE" });
    expect(byRow(r.json, 11).status).toBe("UNCHANGED");

    expect(await docState("f3", "u3")).toBe(outOfSyncBefore);          // the mismatched account is exactly as it was
    expect((await fac("f2")).collegeEmail).toBe("ravi@college.test");  // E002 untouched
    expect((await fac("f4")).collegeEmail).toBe("nologin.new@college.test");
    expect(authUsers.get("u5")!.email).toBe("mani.new@college.test");
    expect(authCalls.revoke.sort()).toEqual(["u1", "u5"]);             // only people with a login who actually changed
  });

  it("uploading the same file again is safe: everything already applied is reported as already same", async () => {
    const file = [{ employeeId: "E001", newEmail: "asha.new@college.test" }, { employeeId: "E002", newEmail: "ravi.new@college.test" }];
    await run(file);
    const stable = await docState("f1", "u1");
    const again = await run(file);
    expect(again.json).toMatchObject({ updated: 0, unchanged: 2, failed: 0 });
    expect(await docState("f1", "u1")).toBe(stable);
    expect((await fac("f1")).collegeEmailHistory).toHaveLength(1);
  });

  it("an email that is currently someone else's can't be taken in the same upload; once they are moved it works", async () => {
    const r = await run([{ employeeId: "E001", newEmail: "ravi@college.test" }, { employeeId: "E002", newEmail: "ravi.new@college.test" }]);
    expect(byRow(r.json, 2)).toMatchObject({ status: "FAILED", code: "EMAIL_TAKEN" });
    expect(byRow(r.json, 3).status).toBe("UPDATED");
    const second = await run([{ employeeId: "E001", newEmail: "ravi@college.test" }]);
    expect(second.json).toMatchObject({ updated: 1, failed: 0 });
    expect(authUsers.get("u1")!.email).toBe("ravi@college.test");
  });

  it("nothing but the email moved on the updated people", async () => {
    const before = await fac("f1"); const userBefore = await usr("u1");
    await run([{ employeeId: "E001", newEmail: "asha.new@college.test" }]);
    const f = await fac("f1"); const u = await usr("u1");
    for (const k of Object.keys(before)) if (!["collegeEmail", "updatedAt"].includes(k)) expect(f[k], k).toEqual(before[k]);
    for (const k of Object.keys(userBefore)) if (!["email", "updatedAt"].includes(k)) expect(u[k], k).toEqual(userBefore[k]);
  });

  it("only the College Office can use it, and the request is validated", async () => {
    for (const role of ["PANEL_MEMBER", "HOD", "PRINCIPAL", "VICE_PRINCIPAL"]) {
      who.role = role;
      expect((await run([{ employeeId: "E001", newEmail: "x@college.test" }])).status, role).toBe(401);
    }
    who.role = "COLLEGE_OFFICE";
    expect((await run([])).status).toBe(400);
    expect((await run(Array.from({ length: 51 }, (_, i) => ({ employeeId: `E${i}`, newEmail: `a${i}@college.test` })))).status).toBe(400);
    expect((await fac("f1")).collegeEmail).toBe("asha@college.test");
  });
});
