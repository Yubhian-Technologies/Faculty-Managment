import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { applyPlans, planPhdHonorific, revertLog, setFacultyHonorific } from "../../../scripts/apply-phd-honorific.mjs";

// Real-database proof of the Ph.D -> "Dr." migration and of the save routes' default, against a REAL Firestore (the local
// emulator - nothing here can reach a live project). Skipped unless the emulator is running:
//
//   firebase emulators:exec --only firestore --project demo-phd "npx vitest run src/lib/faculty/phdHonorific.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;

const h = vi.hoisted(() => ({ session: { uid: "hod-1", email: "h@x.test", role: "HOD", collegeId: "c1" } as Record<string, string> }));
vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-phd" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("auth not available in this test"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));
vi.mock("@/lib/departments/scope", async (orig) => ({
  ...(await orig<typeof import("@/lib/departments/scope")>()),
  getHodDepartmentScope: async () => ({ unrestricted: true, names: [] }),
  canHodManageFacultyDepartment: () => true,
}));

describe.skipIf(!EMULATOR)("Ph.D -> Dr. in a real Firestore", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-phd" }));
  const col = (c: string, name: string) => db().collection("colleges").doc(c).collection(name);
  const fac = (c: string, id: string) => col(c, "facultyMembers").doc(id);
  const data = async (c: string, id: string) => (await fac(c, id).get()).data() as Record<string, unknown>;
  const all = async (c: string) => Object.fromEntries((await col(c, "facultyMembers").get()).docs.map((d) => [d.id, d.data()]));
  const without = (o: Record<string, unknown>, ...k: string[]) => Object.fromEntries(Object.entries(o).filter(([key]) => !k.includes(key)));

  const base = (over: Record<string, unknown>) => ({
    employeeId: "E", legalName: "A KUMAR", department: "CSE", designation: "Professor", status: "ACTIVE", mobileNo: "9876543210",
    aadharNo: "111122223333", panNo: "ABCDE1234F", gender: "Male", fatherName: "R KUMAR", highestQualification: "Ph.D",
    academicProfile: { monthlySalary: 50000, ugDetails: { course: "B.Tech/BE", degreeType: "B.Tech" } }, ...over,
  });

  beforeAll(async () => {
    for (const [c, names] of [["c1", ["Mr.", "Mrs.", "Dr."]], ["c2", ["Mr", "Mrs"]], ["c3", ["Mr", "Dr"]]] as const) {
      await db().collection("colleges").doc(c).set({ name: c });
      for (const [i, n] of names.entries()) await col(c, "honorifics").doc(`h${i}`).set({ name: n, isActive: true });
      await col(c, "honorifics").doc("old").set({ name: "Late", isActive: false });
    }
    // c1: the cases
    await fac("c1", "missing").set(base({ employeeId: "E1", userUid: "u-missing" }));                              // Ph.D, no honorific key
    await fac("c1", "blank").set(base({ employeeId: "E2", honorific: "", legalName: "B DEVI", userUid: "u-blank" })); // Ph.D, ""
    await fac("c1", "alreadyDr").set(base({ employeeId: "E3", honorific: "Dr." }));
    await fac("c1", "alreadyDrNoDot").set(base({ employeeId: "E4", honorific: "Dr" }));
    await fac("c1", "mr").set(base({ employeeId: "E5", honorific: "Mr." }));                                       // Ph.D but chose Mr.
    await fac("c1", "mtech").set(base({ employeeId: "E6", highestQualification: "M.Tech" }));                      // not Ph.D
    await fac("c1", "phdVariant").set(base({ employeeId: "E7", highestQualification: "PhD", legalName: "C RAO" }));
    await fac("c1", "noName").set(base({ employeeId: "E8", legalName: "" }));
    // c2 has no Dr in its list, c3 spells it "Dr"
    await fac("c2", "x").set(base({ employeeId: "G1" }));
    await fac("c3", "y").set(base({ employeeId: "H1", legalName: "D SHARMA" }));
    // logins and the copies of the name the app keeps
    for (const [uid, name] of [["u-missing", "A KUMAR"], ["u-blank", "B DEVI"]]) {
      await col("c1", "users").doc(uid).set({ name, email: `${uid}@x.in`, role: "PANEL_MEMBER" });
      await db().collection("systemUsers").doc(uid).set({ name, email: `${uid}@x.in`, role: "PANEL_MEMBER" });
    }
    await col("c1", "teachingAssignments").doc("ta1").set({ facultyId: "missing", facultyName: "A KUMAR", subjectName: "Maths" });
    await col("c1", "teachingAssignments").doc("ta2").set({ facultyId: "alreadyDr", facultyName: "Dr.A KUMAR", subjectName: "Physics" });
    await col("c1", "timetableSlots").doc("ts1").set({ facultyId: "missing", facultyName: "A KUMAR", day: "MON", periodNumber: 1 });
    await col("c1", "sections").doc("s1").set({ facultyInchargeUid: "u-missing", facultyInchargeName: "A KUMAR", name: "A" });
    await col("c1", "sections").doc("s2").set({ facultyInchargeUid: "blank", facultyInchargeName: "B DEVI", name: "B" }); // older records hold the faculty doc id
  });

  it("the plan names exactly who will change, who is left alone and why - and writes nothing", async () => {
    const before = await all("c1");
    const p1 = await planPhdHonorific(db(), "c1");
    expect(p1.dr).toBe("Dr.");
    expect(p1.phd).toBe(7); // missing, blank, alreadyDr, alreadyDrNoDot, mr, phdVariant, noName
    expect(p1.willSet.map((r: { id: string }) => r.id).sort()).toEqual(["blank", "missing", "phdVariant"]);
    expect(p1.alreadyHave).toBe(2);
    expect(p1.conflicts.map((r: { id: string }) => r.id)).toEqual(["mr"]);
    expect(p1.skippedNoName.map((r: { id: string }) => r.id)).toEqual(["noName"]);
    expect((await planPhdHonorific(db(), "c2")).dr).toBeNull();
    expect((await planPhdHonorific(db(), "c2")).willSet).toEqual([]);
    expect((await planPhdHonorific(db(), "c3")).willSet[0].target).toBe("Dr"); // the college's own spelling
    expect(await all("c1")).toEqual(before); // dry run: nothing written
  });

  it("applying fills only the blank honorifics, changes nothing else, and carries the name where the app copies it", async () => {
    const before = await all("c1");
    const plans = [await planPhdHonorific(db(), "c1"), await planPhdHonorific(db(), "c2")];
    let logged: { changes: unknown[] } | null = null;
    const results = await applyPlans(db(), plans, (log: { changes: unknown[] }) => { logged = log; });
    expect(logged!.changes).toHaveLength(3); // the revert log exists before the first write
    expect(results.every((r: { result: { ok: boolean } }) => r.result.ok)).toBe(true);

    const after = await all("c1");
    for (const id of ["missing", "blank", "phdVariant"]) {
      expect(after[id].honorific, id).toBe("Dr.");
      expect(without(after[id], "honorific"), id).toEqual(without(before[id], "honorific")); // every other value identical, updatedAt included
    }
    for (const id of ["alreadyDr", "alreadyDrNoDot", "mr", "mtech", "noName"]) expect(after[id], id).toEqual(before[id]);
    expect((await data("c2", "x")).honorific).toBeUndefined(); // no Dr in that college's list: untouched

    expect((await col("c1", "users").doc("u-missing").get()).data()).toMatchObject({ name: "Dr.A KUMAR", email: "u-missing@x.in", role: "PANEL_MEMBER" });
    expect((await db().collection("systemUsers").doc("u-blank").get()).data()).toMatchObject({ name: "Dr.B DEVI", role: "PANEL_MEMBER" });
    expect((await col("c1", "teachingAssignments").doc("ta1").get()).data()).toMatchObject({ facultyName: "Dr.A KUMAR", subjectName: "Maths" });
    expect((await col("c1", "teachingAssignments").doc("ta2").get()).data()?.facultyName).toBe("Dr.A KUMAR"); // someone else's copy: untouched
    expect((await col("c1", "timetableSlots").doc("ts1").get()).data()).toMatchObject({ facultyName: "Dr.A KUMAR", day: "MON" });
    expect((await col("c1", "sections").doc("s1").get()).data()).toMatchObject({ facultyInchargeName: "Dr.A KUMAR", name: "A" });
    expect((await col("c1", "sections").doc("s2").get()).data()).toMatchObject({ facultyInchargeName: "Dr.B DEVI" }); // matched by the faculty doc id too
  });

  it("running it again finds nothing left to do", async () => {
    const p = await planPhdHonorific(db(), "c1");
    expect(p.willSet).toEqual([]);
    expect(p.alreadyHave).toBe(5);
    expect(p.conflicts).toHaveLength(1);
  });

  it("the revert log puts every change back, including a record that had no honorific key at all", async () => {
    // a fresh college so the earlier test's state does not matter
    await db().collection("colleges").doc("c4").set({ name: "c4" });
    await col("c4", "honorifics").doc("h").set({ name: "Dr.", isActive: true });
    await fac("c4", "a").set(base({ employeeId: "R1", userUid: "u-r1" }));
    await fac("c4", "b").set(base({ employeeId: "R2", honorific: "", legalName: "E NAIDU" }));
    await col("c4", "users").doc("u-r1").set({ name: "A KUMAR" });
    await col("c4", "teachingAssignments").doc("t").set({ facultyId: "a", facultyName: "A KUMAR" });
    const before = await all("c4");

    let log: { changes: unknown[] } | null = null;
    await applyPlans(db(), [await planPhdHonorific(db(), "c4")], (l: { changes: unknown[] }) => { log = l; });
    expect((await data("c4", "a")).honorific).toBe("Dr.");
    const results = await revertLog(db(), JSON.parse(JSON.stringify(log)));
    expect(results.every((r: { result: { ok: boolean } }) => r.result.ok)).toBe(true);

    expect(await all("c4")).toEqual(before); // "a" has no honorific key again, "b" holds "" again
    expect("honorific" in (await data("c4", "a"))).toBe(false);
    expect((await col("c4", "users").doc("u-r1").get()).data()?.name).toBe("A KUMAR");
    expect((await col("c4", "teachingAssignments").doc("t").get()).data()?.facultyName).toBe("A KUMAR");
  });

  it("a missing record is reported, not created", async () => {
    const r = await setFacultyHonorific(db(), "c1", "does-not-exist", "Dr.");
    expect(r.ok).toBe(false);
    expect((await fac("c1", "does-not-exist").get()).exists).toBe(false);
  });

  it("does not create a login document that is not there", async () => {
    await fac("c1", "nologin").set(base({ employeeId: "E9", userUid: "u-gone" }));
    const r = await setFacultyHonorific(db(), "c1", "nologin", "Dr.");
    expect(r).toMatchObject({ ok: true, login: false, systemLogin: false });
    expect((await col("c1", "users").doc("u-gone").get()).exists).toBe(false);
    expect((await db().collection("systemUsers").doc("u-gone").get()).exists).toBe(false);
  });

  describe("the save routes apply the same default to new data", () => {
    const patchId = async (id: string, body: unknown) => {
      const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
      const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
      return { status: res.status, json: await res.json() };
    };

    beforeAll(async () => {
      for (const id of ["r1", "r2", "r3", "r4", "r5"]) await fac("c1", id).set(base({ employeeId: id, highestQualification: "M.Tech", userUid: `u-${id}` }));
      for (const id of ["r1", "r2", "r3", "r4", "r5"]) await col("c1", "users").doc(`u-${id}`).set({ name: "A KUMAR" });
      await col("c1", "teachingAssignments").doc("tr1").set({ facultyId: "r1", facultyName: "A KUMAR" });
    });

    it("setting the qualification to Ph.D with no honorific given fills Dr. and carries the name", async () => {
      expect((await patchId("r1", { highestQualification: "Ph.D" })).status).toBe(200);
      expect((await data("c1", "r1")).honorific).toBe("Dr.");
      expect((await col("c1", "users").doc("u-r1").get()).data()?.name).toBe("Dr.A KUMAR");
      expect((await col("c1", "teachingAssignments").doc("tr1").get()).data()?.facultyName).toBe("Dr.A KUMAR");
    });

    it("never replaces an honorific the caller sends, and a deliberate blank stays blank", async () => {
      expect((await patchId("r2", { highestQualification: "Ph.D", honorific: "Mr." })).status).toBe(200);
      expect((await data("c1", "r2")).honorific).toBe("Mr.");
      expect((await patchId("r3", { highestQualification: "Ph.D", honorific: "" })).status).toBe(200);
      expect((await data("c1", "r3")).honorific).toBe("");
    });

    it("does not touch a stored honorific, and does nothing for another qualification", async () => {
      await fac("c1", "r4").update({ honorific: "Prof." });
      expect((await patchId("r4", { highestQualification: "Ph.D" })).status).toBe(200);
      expect((await data("c1", "r4")).honorific).toBe("Prof.");
      expect((await patchId("r5", { highestQualification: "MBA" })).status).toBe(200);
      expect((await data("c1", "r5")).honorific).toBeUndefined();
    });

    it("a save that does not set the qualification leaves the honorific alone", async () => {
      await fac("c1", "r5").update({ highestQualification: "Ph.D" });
      expect((await patchId("r5", { specialization: "AI" })).status).toBe(200);
      expect((await data("c1", "r5")).honorific).toBeUndefined();
    });

    it("a faculty member saving their own profile gets the same default", async () => {
      await fac("c1", "me1").set(base({ employeeId: "M1", highestQualification: "M.Tech", userUid: "u-me1" }));
      await col("c1", "users").doc("u-me1").set({ name: "A KUMAR", role: "PANEL_MEMBER" });
      h.session = { uid: "u-me1", email: "m@x.test", role: "PANEL_MEMBER", collegeId: "c1" };
      const { PATCH } = await import("@/app/api/college/faculty/me/route");
      const res = await PATCH(new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ highestQualification: "Ph.D" }) }));
      h.session = { uid: "hod-1", email: "h@x.test", role: "HOD", collegeId: "c1" };
      expect(res.status).toBe(200);
      expect((await data("c1", "me1")).honorific).toBe("Dr.");
      expect((await col("c1", "users").doc("u-me1").get()).data()?.name).toBe("Dr.A KUMAR");
    });

    it("a college with no Dr in its list is left as it is", async () => {
      h.session = { uid: "hod-2", email: "h@x.test", role: "HOD", collegeId: "c2" };
      await fac("c2", "z").set(base({ employeeId: "Z1", highestQualification: "M.Tech" }));
      expect((await patchId("z", { highestQualification: "Ph.D" })).status).toBe(200);
      expect((await data("c2", "z")).honorific).toBeUndefined();
      h.session = { uid: "hod-1", email: "h@x.test", role: "HOD", collegeId: "c1" };
    });
  });
});
