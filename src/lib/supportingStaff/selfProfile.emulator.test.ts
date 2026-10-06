import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// A Supporting Staff member's OWN profile (GET/PATCH /api/college/supporting-staff/me), through the REAL routes on a
// real Firestore (the local emulator): self-service edits land on the staff record first, then the login mirror;
// everything the managing role controls is never accepted. Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-ssp "npx vitest run src/lib/supportingStaff/selfProfile.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const authCalls = { n: 0 };
const who = { uid: "su1", role: "COLLEGE_STAFF" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ssp" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { authCalls.n++; throw new Error("Auth must not be used"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  isDepartmentOffice: () => false,
}));

const C = "c1";
const photo = (uid: string, n = 1) => `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(`profile-photos/${uid}_${n}.jpg`)}?alt=media`;

describe.skipIf(!EMULATOR)("supporting staff own profile (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ssp" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const get = async (c: string, id: string) => (await col(c).doc(id).get()).data() as Record<string, unknown>;
  const sys = async (id: string) => (await db().collection("systemUsers").doc(id).get()).data() as Record<string, unknown> | undefined;
  const call = async (method: "GET" | "PATCH", body?: unknown) => {
    const mod = await import("@/app/api/college/supporting-staff/me/route");
    const res = method === "GET" ? await mod.GET() : await mod.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  beforeEach(async () => {
    for (const n of ["users", "supportingStaff", "auditLogs"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    for (const d of (await db().collection("systemUsers").get()).docs) await d.ref.delete();
    authCalls.n = 0; who.uid = "su1"; who.role = "COLLEGE_STAFF";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("users").doc("su1").set({ collegeId: C, name: "STAFF ONE", role: "COLLEGE_STAFF", isActive: true, email: "s1@c.test" });
    await db().collection("systemUsers").doc("su1").set({ collegeId: C, name: "STAFF ONE", role: "COLLEGE_STAFF" });
    await col("supportingStaff").doc("st1").set({
      collegeId: C, userUid: "su1", employeeId: "SS001", legalName: "STAFF ONE", collegeEmail: "s1@c.test", mobileNo: "9000000001",
      highestQualification: "ITI", designation: "LAB_ASSISTANT", department: "Mech", staffCategory: "TECHNICAL",
      status: "ACTIVE", joiningDate: "2020-01-01", fatherName: "FATHER", pfNumber: "PF-OLD",
    });
    await col("supportingStaff").doc("st2").set({ collegeId: C, userUid: "su2", employeeId: "SS002", legalName: "STAFF TWO", mobileNo: "9000000002", highestQualification: "BA", status: "ACTIVE" });
    await col("users").doc("su4").set({ collegeId: C, name: "NT STAFF", role: "COLLEGE_STAFF", isActive: true });
    await col("supportingStaff").doc("st3").set({ collegeId: C, userUid: "su4", employeeId: "SS003", legalName: "NT STAFF", mobileNo: "9000000003", highestQualification: "BA", staffCategory: "NON_TECHNICAL", designation: "CLERK", status: "ACTIVE" });
    await col("users").doc("su3").set({ collegeId: C, name: "UNLINKED", role: "COLLEGE_STAFF", isActive: true });
  });

  it("GET returns the caller's own record (and only theirs)", async () => {
    const r = await call("GET");
    expect(r.status).toBe(200);
    expect(r.json.staff).toMatchObject({ id: "st1", employeeId: "SS001", legalName: "STAFF ONE" });
  });

  it("GET for a login with no linked record answers staff:null + UNLINKED (no error)", async () => {
    who.uid = "su3";
    const r = await call("GET");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ staff: null, linkStatus: "UNLINKED" });
  });

  it("a role other than COLLEGE_STAFF is refused (401)", async () => {
    who.role = "PANEL_MEMBER";
    expect((await call("GET")).status).toBe(401);
    expect((await call("PATCH", { mobileNo: "9111111111" })).status).toBe(401);
  });

  it("self-edit saves the editable fields on the record and mirrors the name to the login", async () => {
    const r = await call("PATCH", {
      legalName: "STAFF ONE NEW", apaarFacultyId: "123456789012", highestQualification: "Diploma", email: "p@x.test",
      mobileNo: "9111111111", additionalPhoneNumbers: [{ label: "Home", number: "9222222222" }, { number: "  " }],
    });
    expect(r.status).toBe(200);
    expect(await get("supportingStaff", "st1")).toMatchObject({
      legalName: "STAFF ONE NEW", apaarFacultyId: "123456789012", highestQualification: "Diploma", email: "p@x.test", mobileNo: "9111111111",
      additionalPhoneNumbers: [{ label: "Home", number: "9222222222" }],
    });
    expect((await get("users", "su1")).name).toBe("STAFF ONE NEW");
    expect((await sys("su1"))?.name).toBe("STAFF ONE NEW");
    expect(authCalls.n).toBe(0);
  });

  it("fields only the managing role may change are NEVER accepted from the staff member", async () => {
    const r = await call("PATCH", {
      employeeId: "HACK", collegeEmail: "hack@x.test", designation: "OTHER", department: "CSE", staffCategory: "NON_TECHNICAL",
      joiningDate: "1999-01-01", status: "RESIGNED", userUid: "su2", employmentType: "REGULAR", mobileNo: "9333333333",
    });
    expect(r.status).toBe(200);
    expect(await get("supportingStaff", "st1")).toMatchObject({
      employeeId: "SS001", collegeEmail: "s1@c.test", designation: "LAB_ASSISTANT", department: "Mech", staffCategory: "TECHNICAL",
      joiningDate: "2020-01-01", status: "ACTIVE", userUid: "su1", mobileNo: "9333333333",
    });
    expect((await get("users", "su1")).role).toBe("COLLEGE_STAFF");
  });

  it("a required field cannot be blanked out (400) and nothing changes", async () => {
    for (const body of [{ legalName: "  " }, { mobileNo: "" }, { highestQualification: " " }]) {
      expect((await call("PATCH", body)).status).toBe(400);
    }
    expect(await get("supportingStaff", "st1")).toMatchObject({ legalName: "STAFF ONE", mobileNo: "9000000001", highestQualification: "ITI" });
  });

  it("personal-details save keeps every field the admin screen also saves, and never writes ratification / differently-abled", async () => {
    const r = await call("PATCH", {
      fatherName: "NEW FATHER", motherTongue: "Telugu", languagesKnown: ["Telugu", "English"], height: "170", weightKg: 70,
      pfNumber: "PF-NEW", uanNumber: "UAN1", esiNumber: "ESI1", ratificationStatus: "RATIFIED", differentlyAbled: true,
    });
    expect(r.status).toBe(200);
    const d = await get("supportingStaff", "st1");
    expect(d).toMatchObject({ fatherName: "NEW FATHER", motherTongue: "Telugu", languagesKnown: ["Telugu", "English"], height: "170", weightKg: 70, pfNumber: "PF-NEW", uanNumber: "UAN1", esiNumber: "ESI1" });
    expect(d.ratificationStatus).toBeUndefined();
    expect(d.differentlyAbled).toBeUndefined();
  });

  it("a save that mentions only some fields leaves every other stored value untouched", async () => {
    expect((await call("PATCH", { mobileNo: "9444444444" })).status).toBe(200);
    expect(await get("supportingStaff", "st1")).toMatchObject({ legalName: "STAFF ONE", fatherName: "FATHER", pfNumber: "PF-OLD", employeeId: "SS001", highestQualification: "ITI" });
  });

  it("photo: the record is written first, then the login + systemUsers mirror", async () => {
    expect((await call("PATCH", { profilePhotoUrl: photo("su1") })).status).toBe(200);
    expect((await get("supportingStaff", "st1")).profilePhotoUrl).toBe(photo("su1"));
    expect((await get("users", "su1")).profilePhotoUrl).toBe(photo("su1"));
    expect((await sys("su1"))?.profilePhotoUrl).toBe(photo("su1"));
    // removal clears everywhere
    expect((await call("PATCH", { profilePhotoUrl: "" })).status).toBe(200);
    expect((await get("supportingStaff", "st1")).profilePhotoUrl).toBe("");
    expect((await get("users", "su1")).profilePhotoUrl).toBe("");
  });

  it("photo: foreign / non-storage URLs are rejected and nothing is written; re-sending the stored one passes", async () => {
    expect((await call("PATCH", { profilePhotoUrl: "https://evil.example.com/x.jpg" })).status).toBe(400);
    expect((await call("PATCH", { profilePhotoUrl: photo("someone-else") })).status).toBe(400);
    expect((await get("supportingStaff", "st1")).profilePhotoUrl).toBeUndefined();
    await call("PATCH", { profilePhotoUrl: photo("su1") });
    expect((await call("PATCH", { profilePhotoUrl: photo("su1"), mobileNo: "9555555555" })).status).toBe(200);
  });

  it("another staff member's record is never touched", async () => {
    await call("PATCH", { legalName: "CHANGED", mobileNo: "9666666666", profilePhotoUrl: photo("su1") });
    expect(await get("supportingStaff", "st2")).toMatchObject({ legalName: "STAFF TWO", mobileNo: "9000000002" });
    expect((await get("supportingStaff", "st2")).profilePhotoUrl).toBeUndefined();
  });

  it("PATCH for an unlinked login is 404 STAFF_RECORD_NOT_LINKED and creates nothing", async () => {
    who.uid = "su3";
    const r = await call("PATCH", { mobileNo: "9777777777" });
    expect(r.status).toBe(404);
    expect(r.json.code).toBe("STAFF_RECORD_NOT_LINKED");
    expect((await col("supportingStaff").get()).size).toBe(3);
  });

  it("photo changes made on the LOGIN side (users/me/photo) land on the staff record first too", async () => {
    const { PATCH } = await import("@/app/api/college/users/me/photo/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ photoUrl: photo("su1", 2) }) }));
    expect(res.status).toBe(200);
    expect((await get("supportingStaff", "st1")).profilePhotoUrl).toBe(photo("su1", 2));
    expect((await get("users", "su1")).profilePhotoUrl).toBe(photo("su1", 2));
    expect((await get("supportingStaff", "st2")).profilePhotoUrl).toBeUndefined();
  });

  it("admin edit (HOD/College Office PATCH [id]) now saves the personal fields it used to drop, and mirrors the name", async () => {
    who.uid = "office"; who.role = "COLLEGE_OFFICE";
    const { PATCH } = await import("@/app/api/college/supporting-staff/[id]/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ motherTongue: "Hindi", languagesKnown: ["Hindi"], height: "165", weightKg: 60, pfNumber: "PF9", uanNumber: "U9", esiNumber: "E9", legalName: "STAFF ONE RENAMED" }) }),
      { params: Promise.resolve({ id: "st3" }) },
    );
    expect(res.status).toBe(200);
    expect(await get("supportingStaff", "st3")).toMatchObject({ motherTongue: "Hindi", languagesKnown: ["Hindi"], height: "165", weightKg: 60, pfNumber: "PF9", uanNumber: "U9", esiNumber: "E9", employeeId: "SS003" });
    expect((await get("users", "su4")).name).toBe("STAFF ONE RENAMED");
  });
});
