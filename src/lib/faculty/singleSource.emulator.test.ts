import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// R1 / R4 on a real Firestore (the local emulator), through the REAL routes. In a switched-on college a
// faculty-linked person's profile is edited on the Faculty record; the login-side routes refuse (409) rather
// than copy it onto the login, and a refusal changes NOTHING. Every other college/case is unchanged.
//   firebase emulators:exec --config <cfg> --only firestore --project demo-ss "npx vitest run src/lib/faculty/singleSource.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const authCalls = { n: 0 };
const who = { uid: "hod", role: "HOD" as string, roles: ["HOD", "PANEL_MEMBER"] as string[] };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ss" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { authCalls.n++; return { getUser: async () => null, updateUser: async () => ({}) }; } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: who.roles, collegeId: "c1" }),
  isDepartmentOffice: () => false,
}));

const C = "c1";
const AP = { educationalQualifications: [{ course: "B.Tech" }], researchAreasInterests: "AI" };

describe.skipIf(!EMULATOR)("faculty single source: login-side writes (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ss" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const get = async (c: string, id: string) => (await col(c).doc(id).get()).data() as Record<string, unknown>;
  const dump = async () => {
    const out: Record<string, unknown> = {};
    for (const n of ["users", "facultyMembers", "roleSeats", "departments"]) for (const d of (await col(n).get()).docs) out[`${n}/${d.id}`] = d.data();
    for (const d of (await db().collection("systemUsers").get()).docs) out[`systemUsers/${d.id}`] = d.data();
    return JSON.stringify(out, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
  };
  const call = async (mod: "me" | "uid", body: unknown, uid = "hod") => {
    if (mod === "me") {
      const { PATCH } = await import("@/app/api/college/users/me/route");
      return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    }
    const { PATCH } = await import("@/app/api/college/users/[uid]/route");
    return PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ uid }) });
  };

  beforeEach(async () => {
    for (const n of ["users", "facultyMembers", "roleSeats", "departments", "auditLogs"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    for (const d of (await db().collection("systemUsers").get()).docs) await d.ref.delete();
    authCalls.n = 0; delete process.env.FACULTY_SINGLE_SOURCE_COLLEGES;
    who.uid = "hod"; who.role = "HOD"; who.roles = ["HOD", "PANEL_MEMBER"];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = new Date("2026-01-01T00:00:00Z");
    // HOD who is also faculty, holds 2 seats; profile on the FACULTY record, nothing on the login
    await col("users").doc("hod").set({ collegeId: C, name: "HOD ONE", role: "PANEL_MEMBER", isActive: true, seatRoles: ["HOD", "ACADEMICS"], seatIds: ["s1", "s2"], departments: ["Mech"], department: "Mech", email: "hod@x.test", phone: "9000000001" });
    await col("facultyMembers").doc("fh").set({ collegeId: C, userUid: "hod", legalName: "HOD ONE", employeeId: "E2", status: "ACTIVE", department: "Mech", academicProfile: AP, fatherName: "F", mobileNo: "9000000001", createdAt: t });
    // plain faculty
    await col("users").doc("fac").set({ collegeId: C, name: "FAC ONE", role: "PANEL_MEMBER", isActive: true, seatRoles: [], department: "Mech", phone: "9000000002" });
    await col("facultyMembers").doc("ff").set({ collegeId: C, userUid: "fac", legalName: "FAC ONE", employeeId: "E1", status: "ACTIVE", department: "Mech", academicProfile: AP, createdAt: t });
    // legacy role-account HOD: role HOD on the login itself, no faculty record
    await col("users").doc("legacy").set({ collegeId: C, name: "LEGACY HOD", role: "HOD", isActive: true, seatRoles: [], department: "Mech", academicProfile: { researchAreasInterests: "OLD" } });
    // Principal: no faculty record
    await col("users").doc("principal").set({ collegeId: C, name: "PRINCIPAL", role: "PRINCIPAL", isActive: true });
    // a login carrying its OWN profile AND a faculty record also holding one (non-empty on both)
    await col("users").doc("both").set({ collegeId: C, name: "BOTH", role: "PANEL_MEMBER", isActive: true, seatRoles: [], academicProfile: { researchAreasInterests: "LOGIN COPY" } });
    await col("facultyMembers").doc("fb").set({ collegeId: C, userUid: "both", legalName: "BOTH", employeeId: "E9", status: "ACTIVE", academicProfile: { researchAreasInterests: "FACULTY COPY" }, createdAt: t });
  });

  const ON = () => { process.env.FACULTY_SINGLE_SOURCE_COLLEGES = C; };

  it("switch OFF (default / other colleges): users/me and users/[uid] behave exactly as before (write the login)", async () => {
    expect((await call("me", { academicProfile: { researchAreasInterests: "NEW" } })).status).toBe(200);
    expect((await get("users", "hod")).academicProfile).toMatchObject({ researchAreasInterests: "NEW" });
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL"];
    expect((await call("uid", { academicProfile: { researchAreasInterests: "P" } }, "fac")).status).toBe(200);
    expect((await get("users", "fac")).academicProfile).toMatchObject({ researchAreasInterests: "P" });
  });

  it("switch ON for ANOTHER college: unchanged", async () => {
    process.env.FACULTY_SINGLE_SOURCE_COLLEGES = "other";
    expect((await call("me", { academicProfile: { researchAreasInterests: "NEW" } })).status).toBe(200);
  });

  it("ON: a seat-holding HOD who is faculty saving profile content from the login side gets 409 and NOTHING changes", async () => {
    ON();
    const before = await dump();
    const res = await call("me", { academicProfile: AP, fatherName: "X", gender: "Male" });
    expect(res.status).toBe(409);
    const j = (await res.json()) as { code: string; fields: string[]; error: string };
    expect(j.code).toBe("FACULTY_RECORD_IS_SOURCE");
    expect(j.fields).toEqual(expect.arrayContaining(["academicProfile", "fatherName", "gender"]));
    expect(await dump()).toBe(before);                       // both seats, seatRoles, departments, faculty doc, systemUsers: identical
    expect(authCalls.n).toBe(0);
  });

  it("ON: a CHANGED name/employee id/mobile from the login side is refused, an UNCHANGED re-send still works", async () => {
    ON();
    const before = await dump();
    expect((await call("me", { name: "Renamed", phone: "9111111111" })).status).toBe(409);
    expect(await dump()).toBe(before);
    expect((await call("me", { name: "HOD ONE", phone: "9000000001" })).status).toBe(200);   // same values re-sent
  });

  it("ON: non-profile self edits keep working (photo is redirected to the faculty record by the existing sync)", async () => {
    ON();
    const photo = `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent("profile-photos/hod_1.jpg")}?alt=media`;
    expect((await call("me", { profilePhotoUrl: photo })).status).toBe(200);
    expect((await get("facultyMembers", "fh")).profilePhotoUrl).toBe(photo);
    expect((await get("users", "hod")).profilePhotoUrl).toBe(photo);
  });

  it("ON: a legacy role-account HOD (no PANEL_MEMBER, no faculty record) and a Principal are completely unaffected", async () => {
    ON();
    who.uid = "legacy"; who.role = "HOD"; who.roles = ["HOD"];
    expect((await call("me", { academicProfile: { researchAreasInterests: "NEWER" } })).status).toBe(200);
    expect((await get("users", "legacy")).academicProfile).toMatchObject({ researchAreasInterests: "NEWER" });
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL", "PANEL_MEMBER"];
    expect((await call("me", { academicProfile: { researchAreasInterests: "P" } })).status).toBe(200);
  });

  it("ON, users/[uid]: the Principal editing a faculty-linked HOD's profile is refused (409, nothing changed); a login with no faculty record still saves", async () => {
    ON();
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL"];
    const before = await dump();
    const res = await call("uid", { academicProfile: { researchAreasInterests: "HIJACK" }, legalName: "Z" }, "hod");
    expect(res.status).toBe(409);
    expect(await dump()).toBe(before);
    expect((await call("uid", { academicProfile: { researchAreasInterests: "OK" } }, "legacy")).status).toBe(200);
    expect(authCalls.n).toBe(0);                              // the refusal happened before any Auth work
  });

  it("ON, users/[uid]: account-level edits on a faculty-linked person (deactivate, department) still work - only profile content moves", async () => {
    ON();
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL"];
    expect((await call("uid", { isActive: false }, "fac")).status).toBe(200);
    expect((await get("users", "fac")).isActive).toBe(false);
    expect((await get("facultyMembers", "ff")).academicProfile).toMatchObject(AP);   // faculty record untouched
  });

  it("ON: GET users/[uid] shows the FACULTY copy where both are non-empty, flags the page to save there, and deletes nothing", async () => {
    ON();
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL"];
    const before = await dump();
    const { GET } = await import("@/app/api/college/users/[uid]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ uid: "both" }) });
    const { user } = (await res.json()) as { user: Record<string, unknown> };
    expect(user.academicProfile).toMatchObject({ researchAreasInterests: "FACULTY COPY" });
    expect(user).toMatchObject({ facultyRecordSource: true, recordId: "fb", uid: "both", role: "PANEL_MEMBER" });
    expect(await dump()).toBe(before);                                                  // the login's own copy is still stored
    expect((await get("users", "both")).academicProfile).toMatchObject({ researchAreasInterests: "LOGIN COPY" });
  });

  it("OFF: GET users/[uid] is byte-identical to the old merge (login copy wins) and carries no new flag", async () => {
    who.uid = "principal"; who.role = "PRINCIPAL"; who.roles = ["PRINCIPAL"];
    const { GET } = await import("@/app/api/college/users/[uid]/route");
    const { user } = (await (await GET(new Request("http://x"), { params: Promise.resolve({ uid: "both" }) })).json()) as { user: Record<string, unknown> };
    expect(user.academicProfile).toMatchObject({ researchAreasInterests: "LOGIN COPY" });
    expect(user).not.toHaveProperty("facultyRecordSource");
  });

  it("faculty/me GET: editViaFacultyRecord only when ON and the caller holds the Faculty role", async () => {
    const { GET } = await import("@/app/api/college/faculty/me/route");
    const flag = async () => ((await (await GET()).json()) as { editViaFacultyRecord?: boolean }).editViaFacultyRecord;
    expect(await flag()).toBeUndefined();                    // OFF
    ON();
    expect(await flag()).toBe(true);                         // HOD who is faculty
    who.roles = ["HOD"];
    expect(await flag()).toBeUndefined();                    // no Faculty role held -> no new path
  });

  it("ON, the repointed save: the HOD's own faculty/me PATCH lands on the faculty record only; seats, logins and every other field are untouched", async () => {
    ON();
    const { PATCH } = await import("@/app/api/college/faculty/me/route");
    const loginBefore = { ...(await get("users", "hod")), updatedAt: undefined };
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ academicProfileChanges: { set: { researchAreasInterests: "UPDATED" }, remove: [] } }) }));
    expect(res.status).toBe(200);
    const f = await get("facultyMembers", "fh");
    expect(f.academicProfile).toMatchObject({ researchAreasInterests: "UPDATED", educationalQualifications: [{ course: "B.Tech" }] });   // sibling key kept
    expect(f).toMatchObject({ employeeId: "E2", userUid: "hod", fatherName: "F", status: "ACTIVE", department: "Mech" });
    const u = await get("users", "hod");
    expect(u).toMatchObject({ seatRoles: ["HOD", "ACADEMICS"], seatIds: ["s1", "s2"], departments: ["Mech"], role: "PANEL_MEMBER", isActive: true });
    expect(u).not.toHaveProperty("academicProfile");
    const loginAfter = { ...u, updatedAt: undefined };
    expect(loginAfter).toEqual(loginBefore);                 // the login changed in no field but its timestamp
  });
});
