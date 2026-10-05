import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// The real guard chain against a REAL Firestore (emulator): proves the facultyMembers.userUid status
// query itself works and the read-only rule follows facultyMembers.status in both directions.
//   firebase emulators:exec --only firestore --project demo-ro "npx vitest run src/lib/auth/readOnlyFaculty.guard.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const cookieJar = new Map<string, string>();
const reqHeaders = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (cookieJar.has(n) ? { value: cookieJar.get(n)! } : undefined) }),
  headers: async () => ({ get: (n: string) => reqHeaders.get(n.toLowerCase()) ?? null }),
}));
vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ro" }));
  return { getAdminDb: () => getFirestore(app()) };
});

describe.skipIf(!EMULATOR)("read-only follows facultyMembers.status (real Firestore)", () => {
  const C = "cg";
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ro" }));
  const college = () => db().collection("colleges").doc(C);
  const call = async (method: string, path: string, roles: string[]) => {
    reqHeaders.set("x-fms-method", method); reqHeaders.set("x-fms-path", path);
    const { requireCollegeMember } = await import("@/lib/auth/verifySession");
    try { return await requireCollegeMember(...roles); } catch { return null; }
  };

  beforeEach(async () => {
    process.env.SESSION_SECRET = "t";
    const { signSession } = await import("@/lib/auth/sessionToken");
    cookieJar.set("fms-session", await signSession({ uid: "ux", email: "e@x.y", role: "PANEL_MEMBER", roles: ["HOD", "PANEL_MEMBER"], collegeId: C, exp: Math.floor(Date.now() / 1000) + 3600 }));
    await college().collection("users").doc("ux").set({ role: "PANEL_MEMBER", seatRoles: ["HOD"], isActive: true });
    await college().collection("facultyMembers").doc("fx").set({ userUid: "ux", status: "ACTIVE", legalName: "X" });
    const { forgetHeldRoles } = await import("@/lib/auth/liveRoles");
    forgetHeldRoles(C, "ux");
  });
  afterEach(() => { });

  it("ACTIVE -> full access; RESIGNED -> own reads only; back to ACTIVE -> full access again", async () => {
    expect(await call("POST", "/api/college/students", ["HOD", "PANEL_MEMBER"])).not.toBeNull();

    const { forgetHeldRoles } = await import("@/lib/auth/liveRoles");
    await college().collection("facultyMembers").doc("fx").update({ status: "RESIGNED" });
    forgetHeldRoles(C, "ux");
    expect(await call("POST", "/api/college/students", ["HOD", "PANEL_MEMBER"])).toBeNull();
    expect(await call("PATCH", "/api/college/notifications", ["PANEL_MEMBER", "HOD"])).toBeNull();
    const read = await call("GET", "/api/college/faculty/me", ["HOD", "PANEL_MEMBER"]);
    expect(read?.role).toBe("PANEL_MEMBER");
    expect(await call("GET", "/api/college/students", ["HOD", "PANEL_MEMBER"])).toBeNull();

    await college().collection("facultyMembers").doc("fx").update({ status: "ACTIVE" });
    forgetHeldRoles(C, "ux");
    expect(await call("POST", "/api/college/students", ["HOD", "PANEL_MEMBER"])).not.toBeNull();
    // the login record was never modified by any of this
    expect((await college().collection("users").doc("ux").get()).data()).toEqual({ role: "PANEL_MEMBER", seatRoles: ["HOD"], isActive: true });
  });
});
