import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Real Firestore (the local emulator - nothing here can reach a live project), through the REAL
// PATCH /api/college/faculty/[id] handler: a faculty member who becomes RESIGNED/RETIRED is read-
// only and holds no seat. Skipped unless the emulator is running:
//
//   firebase emulators:exec --only firestore --project demo-ro "npx vitest run src/lib/faculty/vacateSeatsOnExit.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const authCalls = { n: 0 };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ro" }));
  return {
    getAdminDb: () => getFirestore(app()),
    // Read-only exit must NEVER touch Firebase Auth (no disabling, no claims, no token revoke).
    getAdminAuth: async () => { authCalls.n++; throw new Error("Auth must not be used"); },
  };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: "principal", email: "p@x.test", role: "PRINCIPAL", collegeId: "c1" }),
}));

const C = "c1";

describe.skipIf(!EMULATOR)("RESIGNED/RETIRED => seats vacated, account untouched (real Firestore, real route)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ro" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const patch = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
    const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: res.status, json: await res.json() as Record<string, unknown> & { seatVacate?: { vacated: string[]; skipped: { seat: string; reason: string }[]; failed: unknown[] } } };
  };
  const user = async (uid: string) => (await col("users").doc(uid).get()).data() as Record<string, unknown>;
  const seat = async (id: string) => (await col("roleSeats").doc(id).get()).data() as Record<string, unknown>;
  const fac = async (id: string) => (await col(id.startsWith("f") ? "facultyMembers" : "x").doc(id).get()).data() as Record<string, unknown>;

  async function clearAll() {
    for (const n of ["users", "facultyMembers", "roleSeats", "departments", "notifications", "auditLogs"]) {
      const snap = await col(n).get();
      for (const d of snap.docs) {
        if (n === "roleSeats") for (const h of (await d.ref.collection("history").get()).docs) await h.ref.delete();
        await d.ref.delete();
      }
    }
  }
  async function seed() {
    await clearAll();
    const t = new Date();
    const mkFaculty = (id: string, uid: string, name: string, status = "ACTIVE") =>
      col("facultyMembers").doc(id).set({ collegeId: C, userUid: uid, legalName: name, employeeId: `E-${id}`, department: "Mech", status, designation: "ASSISTANT_PROFESSOR", createdAt: t });
    const mkUser = (uid: string, role: string, extra: Record<string, unknown> = {}) =>
      col("users").doc(uid).set({ collegeId: C, name: uid, role, isActive: true, seatRoles: [], seatIds: [], ...extra });
    await col("users").doc("principal").set({ collegeId: C, name: "Principal", role: "PRINCIPAL", isActive: true });
    await col("users").doc("vp").set({ collegeId: C, name: "VP person", role: "PANEL_MEMBER", isActive: true, seatRoles: ["VICE_PRINCIPAL"] });
    // u1: multi-seat holder (2 HOD seats + Academics), primary role PANEL_MEMBER - the VIT shape
    await mkUser("u1", "PANEL_MEMBER", { seatRoles: ["HOD", "ACADEMICS"], seatIds: ["sHod1", "sHod2", "sAcad"], departments: ["Mech", "IT"], department: "Mech" });
    await mkFaculty("f1", "u1", "MULTI SEAT HOLDER");
    // u2: OLD ROLE-ACCOUNT (stored role is HOD) - must be skipped + flagged, never disabled / rewritten
    await mkUser("u2", "HOD", { seatRoles: ["HOD"], seatIds: ["sHodLegacy"], departments: ["Civil"], department: "Civil" });
    await mkFaculty("f2", "u2", "LEGACY HOD ACCOUNT");
    // u3: holds the Library seat (which can't be vacated)
    await mkUser("u3", "PANEL_MEMBER", { seatRoles: ["LIBRARY"], seatIds: ["sLib"] });
    await mkFaculty("f3", "u3", "LIBRARY HOLDER");
    // u4: no seats at all (the live VIT0631 shape)
    await mkUser("u4", "PANEL_MEMBER");
    await mkFaculty("f4", "u4", "NO SEAT PERSON");
    // u5: another person, used for the any-college case
    await mkUser("u5", "PANEL_MEMBER", { seatRoles: ["HOD"], seatIds: ["sHod5"], departments: ["EEE"] });
    await mkFaculty("f5", "u5", "ANY COLLEGE PERSON");

    const dept = (id: string, name: string, hodUid: string) => col("departments").doc(id).set({ collegeId: C, name, code: name, isActive: true, hodUid, hodName: hodUid, createdAt: t });
    await dept("d1", "Mech", "u1"); await dept("d2", "IT", "u1"); await dept("d3", "Civil", "u2"); await dept("d5", "EEE", "u5");
    const mkSeat = async (id: string, role: string, label: string, holder: string, extra: Record<string, unknown> = {}) => {
      const h = col("roleSeats").doc(id).collection("history").doc();
      await h.set({ seatId: id, seatLabel: label, role, uid: holder, name: holder, from: t, to: null, assignedBy: "x", assignedByName: "x" });
      await col("roleSeats").doc(id).set({ collegeId: C, role, label, holderUid: holder, holderName: holder, holderSince: t, openHistoryId: h.id, isActive: true, createdAt: t, updatedAt: t, ...extra });
    };
    await mkSeat("sHod1", "HOD", "Head of Department - Mech", "u1", { departmentId: "d1", departmentName: "Mech" });
    await mkSeat("sHod2", "HOD", "Head of Department - IT", "u1", { departmentId: "d2", departmentName: "IT" });
    await mkSeat("sAcad", "ACADEMICS", "Academics", "u1");
    await mkSeat("sHodLegacy", "HOD", "Head of Department - Civil", "u2", { departmentId: "d3", departmentName: "Civil" });
    await mkSeat("sLib", "LIBRARY", "Library", "u3");
    await mkSeat("sHod5", "HOD", "Head of Department - EEE", "u5", { departmentId: "d5", departmentName: "EEE" });
  }

  beforeAll(() => { process.env.SESSION_SECRET = "t"; });
  beforeEach(async () => { await seed(); authCalls.n = 0; vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterAll(() => { });

  it("RESIGNED multi-seat holder: every seat vacated, history closed, hodUid cleared, account untouched, Auth never called", async () => {
    const before = await user("u1");
    const r = await patch("f1", { status: "RESIGNED", resignedDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate!.vacated.sort()).toEqual(["Academics", "Head of Department - IT", "Head of Department - Mech"]);
    expect(r.json.seatVacate!.failed).toEqual([]);

    for (const id of ["sHod1", "sHod2", "sAcad"]) {
      const s = await seat(id);
      expect(s.holderUid, id).toBeNull();
      expect(s.isActive, `${id} stays an active seat for the next holder`).toBe(true);
    }
    for (const dId of ["d1", "d2"]) expect(((await col("departments").doc(dId).get()).data() as { hodUid: string }).hodUid).toBe("");
    const hist = await col("roleSeats").doc("sHod1").collection("history").get();
    expect(hist.docs.every((d) => d.data().to !== null)).toBe(true);                       // history kept, closed

    const after = await user("u1");
    expect(after.isActive).toBe(true);                                                     // NOT disabled
    expect(after.role).toBe("PANEL_MEMBER");                                               // role unchanged
    expect(after.seatRoles).toEqual([]);                                                   // no seat authority left
    expect(after.name).toBe(before.name);
    expect(authCalls.n).toBe(0);                                                           // Firebase Auth untouched
    expect((await fac("f1")).status).toBe("RESIGNED");
    expect((await fac("f1")).seatVacateStatus).toBeUndefined();                            // clean outcome => no flag
    // Principal alerted that seats are now vacant
    const notes = await col("notifications").get();
    expect(notes.docs.some((d) => d.data().toUid === "principal" && /vacant/i.test(String(d.data().message)))).toBe(true);
  });

  it("reinstating (RESIGNED -> ACTIVE) restores NO seat: it stays vacant until an admin assigns it again", async () => {
    await patch("f1", { status: "RESIGNED", resignedDate: "2026-10-01" });
    const r = await patch("f1", { status: "ACTIVE" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate).toBeUndefined();
    for (const id of ["sHod1", "sHod2", "sAcad"]) expect((await seat(id)).holderUid, id).toBeNull();
    expect((await user("u1")).seatRoles).toEqual([]);
    expect(((await col("departments").doc("d1").get()).data() as { hodUid: string }).hodUid).toBe("");
    expect((await fac("f1")).status).toBe("ACTIVE");
  });

  it("RESIGNED -> RETIRED later is harmless (nothing left to vacate)", async () => {
    await patch("f1", { status: "RESIGNED", resignedDate: "2026-10-01" });
    const r = await patch("f1", { status: "RETIRED", retiredDate: "2026-10-02" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate!.vacated).toEqual([]);
    expect((await fac("f1")).seatVacateStatus).toBeUndefined();
  });

  it("OLD ROLE-ACCOUNT holder (stored role = HOD): seat left alone, flagged for an admin; account never disabled or rewritten", async () => {
    const before = await user("u2");
    const r = await patch("f2", { status: "RESIGNED", resignedDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate!.vacated).toEqual([]);
    expect(r.json.seatVacate!.skipped[0].reason).toMatch(/old role-account/i);
    expect((await seat("sHodLegacy")).holderUid).toBe("u2");                                // not touched
    expect(await user("u2")).toEqual(before);                                              // role HOD / isActive true unchanged
    expect((await fac("f2")).seatVacateStatus).toBe("NEEDS_ATTENTION");
    expect(authCalls.n).toBe(0);
  });

  it("Library seat can't be vacated: reported, flagged, nothing else breaks", async () => {
    const r = await patch("f3", { status: "RETIRED", retiredDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate!.skipped[0].seat).toBe("Library");
    expect((await seat("sLib")).holderUid).toBe("u3");
    expect((await fac("f3")).seatVacateStatus).toBe("NEEDS_ATTENTION");
    expect((await user("u3")).isActive).toBe(true);
  });

  it("a resigned person with NO seat (the live VIT shape): status saved, nothing vacated, no alert, no flag", async () => {
    const r = await patch("f4", { status: "RESIGNED", resignedDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate!.vacated).toEqual([]);
    expect((await fac("f4")).seatVacateStatus).toBeUndefined();
    expect((await col("notifications").get()).size).toBe(0);
    expect(await user("u4")).toMatchObject({ isActive: true, role: "PANEL_MEMBER" });
  });

  it("works in ANY college: a stale env variable naming another college changes nothing - RESIGNED vacates the seat", async () => {
    process.env.READ_ONLY_FACULTY_COLLEGES = "some-other-college";
    const r = await patch("f5", { status: "RESIGNED", resignedDate: "2026-10-01" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate).toBeDefined();
    expect((await seat("sHod5")).holderUid).toBeNull();
    expect((await fac("f5")).status).toBe("RESIGNED");
  });

  it("a normal edit that does not change status never vacates anything", async () => {
    const r = await patch("f1", { specialization: "VLSI" });
    expect(r.status).toBe(200);
    expect(r.json.seatVacate).toBeUndefined();
    expect((await seat("sHod1")).holderUid).toBe("u1");
  });

  // ── R5: a failed or skipped vacate is retried by simply saving the exited person again ──
  it("a vacate that FAILED is flagged, and saving the record again (no status change) retries it and clears the flag", async () => {
    // Break one seat for real: its open-history pointer references a document that does not exist,
    // so closing the history fails inside assignSeat (a hard error, not a "can't vacate" refusal).
    await col("roleSeats").doc("sHod2").update({ openHistoryId: "no-such-history-doc" });

    const first = await patch("f1", { status: "RESIGNED", resignedDate: "2026-10-01" });
    expect(first.status).toBe(200);
    expect(first.json.seatVacate!.failed.length).toBe(1);
    expect(first.json.seatVacate!.vacated.sort()).toEqual(["Academics", "Head of Department - Mech"]);   // the others still went
    expect((await seat("sHod2")).holderUid).toBe("u1");                                                   // the broken one is untouched
    expect((await fac("f1")).seatVacateStatus).toBe("FAILED");

    // Repair the seat (an admin / support fix), then just save the faculty record again - same status.
    const goodHistory = col("roleSeats").doc("sHod2").collection("history").doc();
    await goodHistory.set({ seatId: "sHod2", seatLabel: "Head of Department - IT", role: "HOD", uid: "u1", name: "u1", from: new Date(), to: null, assignedBy: "x", assignedByName: "x" });
    await col("roleSeats").doc("sHod2").update({ openHistoryId: goodHistory.id });

    const retry = await patch("f1", { specialization: "VLSI" });                  // NOT a status change
    expect(retry.status).toBe(200);
    expect(retry.json.seatVacate!.vacated).toEqual(["Head of Department - IT"]);
    expect((await seat("sHod2")).holderUid).toBeNull();
    expect((await fac("f1")).seatVacateStatus).toBeUndefined();                    // flag cleared
    expect((await fac("f1")).seatVacateDetail).toBeUndefined();
    expect((await user("u1")).seatRoles).toEqual([]);
    expect((await user("u1")).isActive).toBe(true);
    expect(authCalls.n).toBe(0);
  });

  it("re-saving an exited person who holds nothing is a no-op: no report, no flag, no extra writes", async () => {
    await patch("f4", { status: "RESIGNED", resignedDate: "2026-10-01" });
    const before = JSON.stringify(await fac("f4"));
    const again = await patch("f4", { specialization: "X" });
    expect(again.status).toBe(200);
    expect(again.json.seatVacate).toBeUndefined();
    const after = await fac("f4");
    expect(after.seatVacateStatus).toBeUndefined();
    expect(after.specialization).toBe("X");
    expect(JSON.parse(before).status).toBe(after.status);
  });

  it("a SKIPPED seat (Library) stays flagged on re-save - reported again, never forced, nothing disabled", async () => {
    await patch("f3", { status: "RETIRED", retiredDate: "2026-10-01" });
    const again = await patch("f3", { specialization: "Y" });
    expect(again.json.seatVacate!.skipped[0].seat).toBe("Library");
    expect((await fac("f3")).seatVacateStatus).toBe("NEEDS_ATTENTION");
    expect((await seat("sLib")).holderUid).toBe("u3");
    expect(await user("u3")).toMatchObject({ isActive: true, role: "PANEL_MEMBER" });
  });

  it("an ACTIVE person's saves never touch seats, even if a stale flag exists", async () => {
    const r = await patch("f1", { specialization: "Z" });
    expect(r.json.seatVacate).toBeUndefined();
    expect((await seat("sHod1")).holderUid).toBe("u1");
  });
});
