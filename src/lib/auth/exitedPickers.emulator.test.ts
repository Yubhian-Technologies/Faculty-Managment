import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// R7 on a real Firestore (the local emulator), through the REAL routes: the pickers for Department Office,
// Sub-HOD, Leave Handover and Role Assignments leave out RESIGNED/RETIRED people - in every college - and nothing stored changes. Skipped unless the emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-ex "npx vitest run src/lib/auth/exitedPickers.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "hod", role: "HOD" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-ex" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("Auth must not be used"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async () => ({ uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" }),
  isDepartmentOffice: () => false,
}));
vi.mock("@/lib/roles/seatContext", () => ({
  requireSeatManager: async () => ({ collegeId: "c1", actor: { uid: "principal", name: "Principal" } }),
  assertCanAssign: () => {},
}));
vi.mock("@/lib/roles/seats", async (orig) => ({
  ...(await orig<typeof import("@/lib/roles/seats")>()),
  convertLegacyAccounts: async () => {},
}));

const C = "c1";

describe.skipIf(!EMULATOR)("pickers leave out RESIGNED/RETIRED people (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-ex" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const dump = async () => {
    const out: Record<string, unknown> = {};
    for (const n of ["users", "facultyMembers", "roleSeats", "departments", "leaveRequests"]) for (const d of (await col(n).get()).docs) out[`${n}/${d.id}`] = d.data();
    return JSON.stringify(out, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v));
  };

  beforeEach(async () => {
    for (const n of ["users", "facultyMembers", "roleSeats", "departments", "leaveRequests", "auditLogs"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    who.uid = "hod"; who.role = "HOD";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db().collection("colleges").doc(C).set({ name: "C", seatsConvertedAt: new Date() }, { merge: true });
    const t = new Date("2026-01-01T00:00:00Z");
    const user = (uid: string, name: string, extra: Record<string, unknown> = {}) => col("users").doc(uid).set({ collegeId: C, name, role: "PANEL_MEMBER", isActive: true, department: "Mech", seatRoles: [], ...extra });
    const fac = (id: string, uid: string, status: string) => col("facultyMembers").doc(id).set({ collegeId: C, userUid: uid, legalName: uid, employeeId: `E-${id}`, status, department: "Mech", createdAt: t });
    await user("hod", "HOD", { role: "HOD", departments: ["Mech"] });
    await user("active", "Active Person"); await fac("fa", "active", "ACTIVE");
    await user("resigned", "Resigned Person"); await fac("fr", "resigned", "RESIGNED");
    await user("retired", "Retired Person"); await fac("ft", "retired", "RETIRED");
    await user("onleave", "On Leave Person"); await fac("fo", "onleave", "ON_LEAVE");
    await user("nofac", "No Faculty Record");
    await col("departments").doc("dMech").set({ collegeId: C, name: "Mech", code: "ME", isActive: true, hodUid: "hod", hodName: "HOD", createdAt: t });
  });

  const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

  it("exitedFacultyUids: exactly the RESIGNED/RETIRED logins, in any college", async () => {
    const { exitedFacultyUids } = await import("@/lib/auth/readOnlyFacultyLookup");
    expect([...(await exitedFacultyUids(db(), C))].sort()).toEqual(["resigned", "retired"]);
    process.env.READ_ONLY_FACULTY_COLLEGES = "other"; // the old switch is gone - ignored
    expect([...(await exitedFacultyUids(db(), C))].sort()).toEqual(["resigned", "retired"]);
  });

  it("Department Office / Sub-HOD source (users?role=PANEL_MEMBER): exited people are FLAGGED, nobody is removed or changed", async () => {
    const { GET } = await import("@/app/api/college/users/route");
    const before = await dump();
    const { users } = (await json(await GET(new Request("http://x/api/college/users?role=PANEL_MEMBER")))) as { users: { uid: string; facultyExited?: boolean }[] };
    const flagged = users.filter((u) => u.facultyExited).map((u) => u.uid).sort();
    expect(flagged).toEqual(["resigned", "retired"]);
    expect(users.map((u) => u.uid)).toEqual(expect.arrayContaining(["active", "resigned", "retired", "onleave", "nofac"]));   // list itself intact
    expect(users.find((u) => u.uid === "active")).not.toHaveProperty("facultyExited");
    expect(await dump()).toBe(before);
  });

  it("Role Assignments source (role-seats GET): exited people flagged, the people list is the same length", async () => {
    const { GET } = await import("@/app/api/college/role-seats/route");
    const on = (await json(await GET(new Request("http://x/api/college/role-seats")))) as { people: { uid: string; facultyExited?: boolean }[] };
    expect(on.people.length).toBeGreaterThanOrEqual(5);              // nobody is removed from the list itself
    expect(on.people.filter((p) => p.facultyExited).map((p) => p.uid).sort()).toEqual(["resigned", "retired"]);
  });

  it("Leave Handover pickers filter exited people server-side ; a saved application's pool is untouched", async () => {
    who.uid = "active"; who.role = "PANEL_MEMBER";
    const { GET: candidates } = await import("@/app/api/leave/handover-candidates/route");
    const { GET: options } = await import("@/app/api/leave/role-handover-options/route");
    const uids = async (r: Response, key: string) => ((await json(r))[key] as { uid: string }[]).map((p) => p.uid).sort();

    const onC = await uids(await candidates(new Request("http://x/api/leave/handover-candidates")), "candidates");
    const onO = await uids(await options(new Request("http://x/api/leave/role-handover-options?department=Mech")), "people");
    expect(onC).not.toContain("resigned"); expect(onC).not.toContain("retired");
    expect(onO).not.toContain("resigned"); expect(onO).not.toContain("retired");
    expect(onC).toEqual(expect.arrayContaining(["onleave", "nofac"]));   // only RESIGNED/RETIRED are hidden
    expect(onO).toEqual(expect.arrayContaining(["onleave", "nofac"]));
  });

  it("a lookup failure shows everyone instead of hiding people (the server still refuses the appointment)", async () => {
    const mod = await import("@/lib/auth/readOnlyFacultyLookup");
    const bad = { collection: () => { throw new Error("firestore down"); } } as never;
    expect((await mod.exitedFacultyUidsOrNone(bad, C)).size).toBe(0);
  });
});
