import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// R6 on a real Firestore (the local emulator): a RESIGNED/RETIRED faculty member can't be GIVEN a new seat,
// and nothing that already exists (seats, holders, history, the exited person's own record) is changed by
// that refusal. Real assignSeat + the real Department Office route. Skipped unless the emulator runs:
//   firebase emulators:exec --only firestore --project demo-sb "npx vitest run src/lib/roles/seatEligibility.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const authCalls = { n: 0 };
const who = { uid: "hod", role: "HOD" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-sb" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { authCalls.n++; throw new Error("Auth must not be used"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: who.uid, email: "h@x.test", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" }),
  isDepartmentOffice: () => false,
}));

const C = "c1";
const ACTOR = { uid: "principal", name: "Principal" };

describe.skipIf(!EMULATOR)("no new seat for a RESIGNED/RETIRED person (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-sb" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const dump = async () => {
    const out: Record<string, unknown> = {};
    for (const n of ["users", "facultyMembers", "roleSeats", "departments"]) for (const d of (await col(n).get()).docs) {
      out[`${n}/${d.id}`] = d.data();
      if (n === "roleSeats") for (const h of (await d.ref.collection("history").get()).docs) out[`${n}/${d.id}/history/${h.id}`] = h.data();
    }
    return JSON.stringify(out, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
  };

  async function seed() {
    for (const n of ["users", "facultyMembers", "roleSeats", "departments", "notifications", "auditLogs"]) {
      for (const d of (await col(n).get()).docs) { if (n === "roleSeats") for (const h of (await d.ref.collection("history").get()).docs) await h.ref.delete(); await d.ref.delete(); }
    }
    const t = new Date("2026-01-01T00:00:00Z");
    const user = (uid: string, role: string, extra: Record<string, unknown> = {}) => col("users").doc(uid).set({ collegeId: C, name: uid.toUpperCase(), role, isActive: true, seatRoles: [], seatIds: [], department: "Mech", ...extra });
    const fac = (id: string, uid: string, status: string) => col("facultyMembers").doc(id).set({ collegeId: C, userUid: uid, legalName: uid.toUpperCase(), employeeId: `E-${id}`, status, department: "Mech", createdAt: t });
    const seat = async (id: string, role: string, label: string, holder: string | null, extra: Record<string, unknown> = {}) => {
      const h = col("roleSeats").doc(id).collection("history").doc();
      if (holder) await h.set({ seatId: id, seatLabel: label, role, uid: holder, name: holder, from: t, to: null, assignedBy: "x", assignedByName: "x" });
      await col("roleSeats").doc(id).set({ collegeId: C, role, label, holderUid: holder, holderName: holder ?? "", ...(holder ? { holderSince: t, openHistoryId: h.id } : {}), isActive: true, createdAt: t, updatedAt: t, ...extra });
    };
    await user("principal", "PRINCIPAL");
    await user("hod", "HOD", { departments: ["Mech"] });
    // exited person who STILL holds 4 seats (resigned while the feature was off) - the VIT 4-seat shape
    await user("exited", "PANEL_MEMBER", { seatRoles: ["HOD", "VICE_PRINCIPAL", "ACADEMICS"], seatIds: ["s1", "s2", "s3", "s4"], departments: ["IT", "CSBS"] });
    await fac("fx", "exited", "RESIGNED");
    await seat("s1", "HOD", "Head of Department - IT", "exited", { departmentId: "dIT", departmentName: "IT" });
    await seat("s2", "HOD", "Head of Department - CSBS", "exited", { departmentId: "dCS", departmentName: "CSBS" });
    await seat("s3", "VICE_PRINCIPAL", "Vice Principal", "exited");
    await seat("s4", "ACADEMICS", "Academics", "exited");
    await col("departments").doc("dIT").set({ collegeId: C, name: "IT", code: "IT", isActive: true, hodUid: "exited", hodName: "EXITED", createdAt: t });
    await col("departments").doc("dCS").set({ collegeId: C, name: "CSBS", code: "CS", isActive: true, hodUid: "exited", hodName: "EXITED", createdAt: t });
    await col("departments").doc("dMech").set({ collegeId: C, name: "Mech", code: "ME", isActive: true, hodUid: "hod", hodName: "HOD", createdAt: t });
    // empty seats to appoint into
    await seat("sEmptyHod", "HOD", "Head of Department - EEE", null, { departmentId: "dEEE", departmentName: "EEE" });
    await col("departments").doc("dEEE").set({ collegeId: C, name: "EEE", code: "EE", isActive: true, createdAt: t });
    await seat("sEmptyAcad", "ACADEMICS", "Academics (2)", null);
    // an active candidate, a candidate with no faculty record, an exited candidate who holds nothing
    await user("active", "PANEL_MEMBER"); await fac("fa", "active", "ACTIVE");
    await user("nofaculty", "PANEL_MEMBER");
    await user("exited2", "PANEL_MEMBER"); await fac("fx2", "exited2", "RETIRED");
  }

  beforeEach(async () => { await seed(); authCalls.n = 0; delete process.env.READ_ONLY_FACULTY_COLLEGES; who.uid = "hod"; who.role = "HOD"; vi.spyOn(console, "error").mockImplementation(() => {}); });

  const assign = async (seatId: string, uid: string | null) => {
    const { assignSeat } = await import("@/lib/roles/seats");
    try { await assignSeat(db(), C, seatId, { uid }, ACTOR); return { ok: true as const }; }
    catch (e) { return { ok: false as const, status: (e as { status?: number }).status, message: (e as Error).message }; }
  };

  it("switch ON: appointing a RESIGNED/RETIRED person is refused (409) and NOTHING existing changes", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    const before = await dump();
    const r1 = await assign("sEmptyHod", "exited");          // the 4-seat holder asking for a 5th
    const r2 = await assign("sEmptyAcad", "exited2");        // a retired person who holds nothing
    expect(r1).toMatchObject({ ok: false, status: 409 });
    expect(r1.ok === false && r1.message).toMatch(/resigned or retired and has read-only access/);
    expect(r2).toMatchObject({ ok: false, status: 409 });
    expect(await dump()).toBe(before);                        // every seat, holder, history entry, department pointer, user and faculty doc identical
    expect(authCalls.n).toBe(0);
  });

  it("switch ON: existing holders are never removed or edited by the check - the exited 4-seat holder keeps all 4", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    await assign("sEmptyHod", "exited");
    for (const id of ["s1", "s2", "s3", "s4"]) expect(((await col("roleSeats").doc(id).get()).data() as { holderUid: string }).holderUid, id).toBe("exited");
    expect(((await col("users").doc("exited").get()).data() as { seatRoles: string[] }).seatRoles).toEqual(["HOD", "VICE_PRINCIPAL", "ACADEMICS"]);
  });

  it("switch ON: vacating an exited holder's seat still works (the check only guards NEW appointments)", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    expect((await assign("s1", null)).ok).toBe(true);
    expect(((await col("roleSeats").doc("s1").get()).data() as { holderUid: string | null }).holderUid).toBeNull();
    expect(((await col("departments").doc("dIT").get()).data() as { hodUid: string }).hodUid).toBe("");
  });

  it("switch ON: ACTIVE people and a login with no faculty record can still be appointed", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    expect((await assign("sEmptyHod", "active")).ok).toBe(true);
    expect((await assign("sEmptyAcad", "nofaculty")).ok).toBe(true);
    expect(((await col("roleSeats").doc("sEmptyHod").get()).data() as { holderUid: string }).holderUid).toBe("active");
  });

  it("switch OFF (default / other colleges): the old behaviour is untouched - even a RESIGNED person can be appointed", async () => {
    expect((await assign("sEmptyHod", "exited")).ok).toBe(true);
    expect(((await col("roleSeats").doc("sEmptyHod").get()).data() as { holderUid: string }).holderUid).toBe("exited");
  });

  it("Department Office POST: an exited faculty member is refused (409) and no account is changed; an ACTIVE one is appointed", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    const { POST } = await import("@/app/api/college/department-office/route");
    const post = (uid: string) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ uid }) }));
    const before = await dump();
    const refused = await post("exited2");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/read-only access/);
    expect(await dump()).toBe(before);

    const ok = await post("active");
    expect(ok.status).toBe(200);
    expect(((await col("users").doc("active").get()).data() as { seatRoles: string[] }).seatRoles).toEqual(["DEPARTMENT_OFFICE"]);
  });

  it("Department Office POST with the switch OFF behaves as before (an exited person can be appointed)", async () => {
    const { POST } = await import("@/app/api/college/department-office/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ uid: "exited2" }) }));
    expect(res.status).toBe(200);
  });

  it("exiting a Department Office head removes the post (and only the post): the account is not disabled or rewritten", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = C;
    await col("users").doc("active").update({ seatRoles: ["DEPARTMENT_OFFICE"] });
    const { vacateSeatsOnExit } = await import("@/lib/faculty/vacateSeatsOnExit");
    const r = await vacateSeatsOnExit(db(), C, "active", { name: "ACTIVE", status: "RESIGNED" }, ACTOR);
    expect(r.vacated).toEqual(["Department Office head"]);
    const u = (await col("users").doc("active").get()).data() as Record<string, unknown>;
    expect(u.seatRoles).toEqual([]);
    expect(u).toMatchObject({ isActive: true, role: "PANEL_MEMBER", name: "ACTIVE" });
    expect(authCalls.n).toBe(0);
    // a standalone old DEPARTMENT_OFFICE login is skipped and flagged, never deactivated
    await col("users").doc("nofaculty").update({ role: "DEPARTMENT_OFFICE", seatRoles: ["DEPARTMENT_OFFICE"] });
    const r2 = await vacateSeatsOnExit(db(), C, "nofaculty", { name: "NOFAC", status: "RESIGNED" }, ACTOR);
    expect(r2.skipped[0].seat).toBe("Department Office head");
    expect(((await col("users").doc("nofaculty").get()).data() as { isActive: boolean; role: string }).isActive).toBe(true);
  });
});
