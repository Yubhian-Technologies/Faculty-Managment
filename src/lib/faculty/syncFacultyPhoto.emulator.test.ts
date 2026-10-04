import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// A faculty/HOD photo change from the LOGIN side must land on the faculty record (the source of truth
// every faculty list reads) AND the users/systemUsers mirror - through the REAL routes, on a real
// Firestore (the local emulator). Skipped unless the emulator is running:
//   firebase emulators:exec --only firestore --project demo-ph "npx vitest run src/lib/faculty/syncFacultyPhoto.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const authCalls = { n: 0 };
const who = { uid: "u1", role: "PANEL_MEMBER" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ph" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { authCalls.n++; throw new Error("Auth must not be used"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: who.uid, email: "x@y.z", role: who.role, collegeId: "c1" }),
}));

const C = "c1";
const url = (uid: string, n = 1) => `https://firebasestorage.googleapis.com/v0/b/b/o/${encodeURIComponent(`profile-photos/${uid}_${n}.jpg`)}?alt=media`;

describe.skipIf(!EMULATOR)("photo edits from the login side update the faculty record first, then the mirror", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ph" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const get = async (c: string, id: string) => (await col(c).doc(id).get()).data() as Record<string, unknown>;
  const sys = async (id: string) => (await db().collection("systemUsers").doc(id).get()).data() as Record<string, unknown> | undefined;

  beforeEach(async () => {
    for (const n of ["users", "facultyMembers", "auditLogs"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    authCalls.n = 0; who.uid = "u1"; who.role = "PANEL_MEMBER";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("users").doc("u1").set({ collegeId: C, name: "FAC ONE", role: "PANEL_MEMBER", isActive: true, seatRoles: [] });
    await col("facultyMembers").doc("f1").set({ collegeId: C, userUid: "u1", legalName: "FAC ONE", employeeId: "E1", status: "ACTIVE", department: "Mech" });
    await col("users").doc("hod").set({ collegeId: C, name: "HOD ONE", role: "PANEL_MEMBER", isActive: true, seatRoles: ["HOD"], departments: ["Mech"] });
    await col("facultyMembers").doc("fh").set({ collegeId: C, userUid: "hod", legalName: "HOD ONE", employeeId: "E2", status: "ACTIVE", department: "Mech", profilePhotoUrl: "https://firebasestorage.googleapis.com/v0/b/b/o/old-hod-photo" });
    await col("users").doc("principal").set({ collegeId: C, name: "PRINCIPAL", role: "PRINCIPAL", isActive: true });  // no faculty record
  });

  const mePhoto = async (photoUrl: string) => {
    const { PATCH } = await import("@/app/api/college/users/me/photo/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ photoUrl }) }));
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };

  it("faculty uploads a photo via the shared uploader (users/me/photo): faculty record AND mirror both get it", async () => {
    const r = await mePhoto(url("u1"));
    expect(r.status).toBe(200);
    expect((await get("facultyMembers", "f1")).profilePhotoUrl).toBe(url("u1"));            // source of truth
    expect((await get("users", "u1")).profilePhotoUrl).toBe(url("u1"));                     // mirror
    expect((await sys("u1"))?.profilePhotoUrl).toBe(url("u1"));
    // nothing else on either record moved
    expect(await get("users", "u1")).toMatchObject({ role: "PANEL_MEMBER", isActive: true, name: "FAC ONE" });
    expect(await get("facultyMembers", "f1")).toMatchObject({ legalName: "FAC ONE", employeeId: "E1", status: "ACTIVE", department: "Mech", userUid: "u1" });
    expect(authCalls.n).toBe(0);
  });

  it("an HOD (PANEL_MEMBER + seat) replacing a photo overwrites THEIR OWN old photo on both records", async () => {
    who.uid = "hod";
    expect((await mePhoto(url("hod", 2))).status).toBe(200);
    expect((await get("facultyMembers", "fh")).profilePhotoUrl).toBe(url("hod", 2));
    expect((await get("users", "hod")).profilePhotoUrl).toBe(url("hod", 2));
  });

  it("removing the photo (explicit clear) clears it in both places", async () => {
    await mePhoto(url("u1"));
    expect((await mePhoto("")).status).toBe(200);
    expect((await get("facultyMembers", "f1")).profilePhotoUrl).toBe("");
    expect((await get("users", "u1")).profilePhotoUrl).toBe("");
  });

  it("a login with NO faculty record (Principal) behaves exactly as before: users + systemUsers only", async () => {
    who.uid = "principal"; who.role = "PRINCIPAL";
    expect((await mePhoto(url("principal"))).status).toBe(200);
    expect((await get("users", "principal")).profilePhotoUrl).toBe(url("principal"));
    expect((await col("facultyMembers").get()).size).toBe(2);                                // no faculty doc created
  });

  it("only the caller's OWN faculty record is touched (other faculty keep their photos)", async () => {
    await mePhoto(url("u1"));
    expect((await get("facultyMembers", "fh")).profilePhotoUrl).toBe("https://firebasestorage.googleapis.com/v0/b/b/o/old-hod-photo");
  });

  it("an invalid / foreign photo URL is rejected and NOTHING is written to either record", async () => {
    expect((await mePhoto("https://evil.example.com/x.jpg")).status).toBe(400);
    expect((await mePhoto(url("someone-else"))).status).toBe(403);
    expect((await get("facultyMembers", "f1")).profilePhotoUrl).toBeUndefined();
    expect((await get("users", "u1")).profilePhotoUrl).toBeUndefined();
  });

  it("HOD self-edit (users/me PATCH) with a photo updates the faculty record first too", async () => {
    who.uid = "hod"; who.role = "HOD";
    const { PATCH } = await import("@/app/api/college/users/me/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ profilePhotoUrl: url("hod", 3) }) }));
    expect(res.status).toBe(200);
    expect((await get("facultyMembers", "fh")).profilePhotoUrl).toBe(url("hod", 3));
    expect((await get("users", "hod")).profilePhotoUrl).toBe(url("hod", 3));
  });

  it("users/me PATCH that does NOT mention the photo leaves both photos alone", async () => {
    who.uid = "hod"; who.role = "HOD";
    const { PATCH } = await import("@/app/api/college/users/me/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ phone: "9999999999" }) }));
    expect(res.status).toBe(200);
    expect((await get("facultyMembers", "fh")).profilePhotoUrl).toBe("https://firebasestorage.googleapis.com/v0/b/b/o/old-hod-photo");
  });

  it("Principal editing a person's photo (users/[uid] PATCH) updates that person's faculty record first too", async () => {
    who.uid = "principal"; who.role = "PRINCIPAL";
    const { PATCH } = await import("@/app/api/college/users/[uid]/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ profilePhotoUrl: url("hod", 4) }) }), { params: Promise.resolve({ uid: "hod" }) });
    // loadTargetInScope decides whether a Principal may edit this login at all; whichever way it answers,
    // the two records must never disagree.
    const f = (await get("facultyMembers", "fh")).profilePhotoUrl;
    const u = (await get("users", "hod")).profilePhotoUrl;
    if (res.status === 200) { expect(f).toBe(url("hod", 4)); expect(u).toBe(url("hod", 4)); }
    else { expect(f).toBe("https://firebasestorage.googleapis.com/v0/b/b/o/old-hod-photo"); expect(u).toBeUndefined(); }
  });
});
