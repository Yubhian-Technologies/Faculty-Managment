import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Main / Test college category through the REAL routes on a real Firestore (the local emulator): the cross-college list a
// college user is offered only holds colleges of their own category, the public faculty page labels postings the same
// way, and only a Super Admin can change a category - without touching anything else on the college. Skipped unless the
// emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-cc "npx vitest run src/app/api/college/collegesDirectory.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "u1", role: "PANEL_MEMBER", collegeId: "main1", locationId: "loc1" };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-cc" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({}) };
});
vi.mock("@/lib/auth/verifySession", () => {
  const session = () => ({ uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: who.collegeId, locationId: who.locationId });
  return {
    requireCollegeMember: async (...roles: string[]) => {
      if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
      return session();
    },
    verifySession: async () => session(),
    requireSuperAdmin: async () => { if (who.role !== "SUPER_ADMIN") throw new Error("UNAUTHORIZED"); return session(); },
  };
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- loose JSON of a route response in a test

describe.skipIf(!EMULATOR)("college category - Main / Test (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-cc" }));
  const college = async (id: string) => (await db().collection("colleges").doc(id).get()).data() as Json;

  const directory = async () => {
    const { GET } = await import("@/app/api/college/colleges-directory/route");
    const res = await GET();
    return { status: res.status, json: (await res.json()) as Json };
  };
  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/admin/colleges/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import("@/app/api/admin/colleges/route");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const publicProfile = async (employeeId: string) => {
    const { GET } = await import("@/app/api/public/faculty-public/route");
    const res = await GET(new Request(`http://x?employeeId=${employeeId}`));
    return { status: res.status, json: (await res.json()) as Json };
  };
  const names = (r: { json: Json }) => (r.json.colleges as { id: string; name: string }[]).map((c) => c.name);

  beforeEach(async () => {
    for (const d of (await db().collection("colleges").get()).docs) {
      for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
      await d.ref.delete();
    }
    who.uid = "u1"; who.role = "PANEL_MEMBER"; who.collegeId = "main1"; who.locationId = "loc1";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = (id: string, name: string, extra: Record<string, unknown> = {}) =>
      db().collection("colleges").doc(id).set({ name, isActive: true, locationId: "loc1", address: "somewhere", contactEmail: "c@x.test", ...extra });
    await c("main1", "Alpha Main");
    await c("main2", "Beta Main", { collegeCategory: "MAIN" });
    await c("legacy", "Gamma Legacy"); // no category field at all
    await c("test1", "Delta Test", { collegeCategory: "TEST" });
    await c("test2", "Epsilon Test", { collegeCategory: "TEST" });
    await c("off", "Zeta Off", { isActive: false, collegeCategory: "MAIN" });
  });

  describe("cross-college list (colleges-directory)", () => {
    it("a Main college sees Main colleges only - a college with no category counts as Main", async () => {
      const r = await directory();
      expect(r.status).toBe(200);
      expect(names(r)).toEqual(["Alpha Main", "Beta Main", "Gamma Legacy"]);
    });
    it("a Test college sees Test colleges only", async () => {
      who.collegeId = "test1";
      expect(names(await directory())).toEqual(["Delta Test", "Epsilon Test"]);
    });
    it("a college with no category behaves exactly like Main", async () => {
      who.collegeId = "legacy";
      expect(names(await directory())).toEqual(["Alpha Main", "Beta Main", "Gamma Legacy"]);
    });
    it("an INACTIVE own college still resolves its own category (a Test one never falls back to Main)", async () => {
      await db().collection("colleges").doc("test2").update({ isActive: false });
      who.collegeId = "test2";
      expect(names(await directory())).toEqual(["Delta Test"]);
    });
    it("the response shape is unchanged: only id and name", async () => {
      const r = await directory();
      for (const c of r.json.colleges) expect(Object.keys(c).sort()).toEqual(["id", "name"]);
    });
    it("a flipped college moves to the other list and nothing is lost", async () => {
      await db().collection("colleges").doc("test1").update({ collegeCategory: "MAIN" });
      expect(names(await directory())).toContain("Delta Test");
      who.collegeId = "test2";
      expect(names(await directory())).toEqual(["Epsilon Test"]);
    });
  });

  describe("changing the category (PATCH /api/admin/colleges)", () => {
    it("only Super Admin; every other field on the college is untouched; the change is audited", async () => {
      who.role = "SUPER_ADMIN";
      const before = await college("main2");
      const r = await patch({ collegeId: "main2", collegeCategory: "TEST" });
      expect(r.status).toBe(200);
      const after = await college("main2");
      expect(after.collegeCategory).toBe("TEST");
      expect({ ...after, collegeCategory: undefined, updatedAt: undefined }).toEqual({ ...before, collegeCategory: undefined, updatedAt: undefined });
      const audits = (await db().collection("colleges").doc("main2").collection("auditLogs").get()).docs.map((d) => d.data() as Json);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ action: "COLLEGE_CATEGORY_CHANGED", performedBy: "u1", details: { from: "MAIN", to: "TEST" } });
    });
    it("re-sending the current category (the edit form always does) writes no audit entry", async () => {
      who.role = "SUPER_ADMIN";
      expect((await patch({ collegeId: "test1", collegeCategory: "TEST", name: "Delta Test" })).status).toBe(200);
      expect((await db().collection("colleges").doc("test1").collection("auditLogs").get()).size).toBe(0);
    });
    it("a college with no category flips from Main (implied) and the audit says MAIN -> TEST", async () => {
      who.role = "SUPER_ADMIN";
      await patch({ collegeId: "legacy", collegeCategory: "TEST" });
      expect((await college("legacy")).collegeCategory).toBe("TEST");
      const audits = (await db().collection("colleges").doc("legacy").collection("auditLogs").get()).docs.map((d) => d.data() as Json);
      expect(audits[0].details).toEqual({ from: "MAIN", to: "TEST" });
    });
    it("Administration cannot change it (401) and nothing is written", async () => {
      who.role = "ADMINISTRATION";
      const before = await college("main2");
      expect((await patch({ collegeId: "main2", collegeCategory: "TEST" })).status).toBe(401);
      expect(await college("main2")).toEqual(before);
    });
    it("rejects an unknown value (400) and an unknown college (404)", async () => {
      who.role = "SUPER_ADMIN";
      expect((await patch({ collegeId: "main2", collegeCategory: "PROD" })).status).toBe(400);
      expect((await patch({ collegeId: "nope", collegeCategory: "TEST" })).status).toBe(404);
      expect((await college("main2")).collegeCategory).toBe("MAIN");
    });
    it("other edits without a category still work and never add or change one", async () => {
      who.role = "SUPER_ADMIN";
      await patch({ collegeId: "legacy", name: "Gamma Renamed" });
      const c = await college("legacy");
      expect(c.name).toBe("Gamma Renamed");
      expect(c).not.toHaveProperty("collegeCategory");
    });
  });

  describe("creating a college (POST /api/admin/colleges)", () => {
    it("stores the chosen category; omitted means Main", async () => {
      who.role = "SUPER_ADMIN";
      const t = await post({ name: "New Test College", locationId: "loc1", collegeCategory: "TEST" });
      expect(t.status).toBe(201);
      expect((await college(t.json.collegeId)).collegeCategory).toBe("TEST");
      const m = await post({ name: "New Main College", locationId: "loc1" });
      expect((await college(m.json.collegeId)).collegeCategory).toBe("MAIN");
      expect((await post({ name: "Bad One", locationId: "loc1", collegeCategory: "x" })).status).toBe(400);
    });
    it("Administration may create a college as Test or Main in its own location", async () => {
      who.role = "ADMINISTRATION";
      const r = await post({ name: "Admin Made Test", collegeCategory: "TEST" });
      expect(r.status).toBe(201);
      expect((await college(r.json.collegeId)).collegeCategory).toBe("TEST");
    });
  });

  describe("public faculty page labels (faculty-public)", () => {
    const addFaculty = (collegeId: string, employeeId: string) =>
      db().collection("colleges").doc(collegeId).collection("facultyMembers").doc(`f-${employeeId}`).set({
        collegeId, employeeId, legalName: "A Person", department: "CSE", designation: "ASSISTANT_PROFESSOR",
        academicProfile: { academicExperience: [{ institutionName: "Beta Main" }, { institutionName: "Delta Test" }, { institutionName: "Some Outside University" }] },
      });
    it("a Main college's faculty: only Main colleges count as INTERNAL", async () => {
      await addFaculty("main1", "EMPMAIN1");
      const r = await publicProfile("EMPMAIN1");
      expect(r.status).toBe(200);
      const exp = r.json.profile.academicExperience as { institutionName: string; isInternal: boolean }[];
      expect(Object.fromEntries(exp.map((e) => [e.institutionName, e.isInternal]))).toEqual({ "Beta Main": true, "Delta Test": false, "Some Outside University": false });
    });
    it("a Test college's faculty: only Test colleges count as INTERNAL", async () => {
      await addFaculty("test2", "EMPTEST1");
      const exp = (await publicProfile("EMPTEST1")).json.profile.academicExperience as { institutionName: string; isInternal: boolean }[];
      expect(Object.fromEntries(exp.map((e) => [e.institutionName, e.isInternal]))).toEqual({ "Beta Main": false, "Delta Test": true, "Some Outside University": false });
    });
  });
});
