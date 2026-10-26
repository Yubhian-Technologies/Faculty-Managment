import { beforeAll, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Real-database check of the faculty list order through the REAL GET /api/college/faculty (the local emulator - nothing here can
// reach a live project). Skipped unless the emulator is running:
//
//   firebase emulators:exec --only firestore --project demo-order "npx vitest run src/lib/faculty/listOrder.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const h = vi.hoisted(() => ({ session: { uid: "p1", email: "p@x.test", role: "PRINCIPAL", collegeId: "c1" } as Record<string, string> }));

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-order" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("auth not available in this test"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => h.session }));

describe.skipIf(!EMULATOR)("faculty list order, through the real route", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-order" }));
  const col = (n: string) => db().collection("colleges").doc("c1").collection(n);
  const list = async (query: string) => {
    const { GET } = await import("@/app/api/college/faculty/route");
    const res = await GET(new Request(`http://localhost/api/college/faculty?${query}`));
    const json = await res.json() as { faculty: { legalName: string; seatLabels?: string[]; seatRoleCodes?: string[] }[] };
    return { status: res.status, rows: json.faculty };
  };
  const names = (rows: { legalName: string }[]) => rows.map((r) => r.legalName);

  const member = (legalName: string, joiningDate: string | null, userUid: string, department = "CSE") => ({
    legalName, department, designation: "Assistant Professor", status: "ACTIVE", employeeId: legalName, userUid,
    ...(joiningDate ? { joiningDate: new Date(joiningDate) } : {}),
  });

  beforeAll(async () => {
    await db().collection("colleges").doc("c1").set({ name: "C1" });
    await col("departments").doc("d-cse").set({ name: "CSE", hodUid: "u-hod" });
    await col("facultyMembers").doc("hod").set(member("HOD NEWEST", "2020-06-01", "u-hod"));
    await col("facultyMembers").doc("principal").set(member("PRINCIPAL MID", "2010-06-01", "u-pr"));
    await col("facultyMembers").doc("senior").set(member("SENIOR MOST", "2000-06-01", "u-senior"));
    await col("facultyMembers").doc("mid").set(member("COLLEAGUE MID", "2015-06-01", "u-mid"));
    await col("facultyMembers").doc("nodate").set(member("NO DATE", null, "u-nodate"));
    await col("facultyMembers").doc("viceprincipal").set(member("VICE PRINCIPAL", "2005-06-01", "u-vp"));
    await col("roleSeats").doc("s-hod").set({ role: "HOD", label: "Head of Department - CSE", departmentName: "CSE", holderUid: "u-hod", holderName: "x", isActive: true });
    await col("roleSeats").doc("s-pr").set({ role: "PRINCIPAL", label: "Principal", holderUid: "u-pr", holderName: "x", isActive: true });
    await col("roleSeats").doc("s-vp").set({ role: "VICE_PRINCIPAL", label: "Vice Principal", holderUid: "u-vp", holderName: "x", isActive: true });
    await col("roleSeats").doc("s-old").set({ role: "HOD", label: "Head of Department - CSE", departmentName: "CSE", holderUid: "u-senior", holderName: "x", isActive: false }); // an inactive seat pins nobody
  });

  it("the Faculty Register order: the HOD first, then the Principal, then internal experience (highest first)", async () => {
    const { status, rows } = await list("department=CSE&withSeats=1");
    expect(status).toBe(200);
    expect(names(rows)).toEqual(["HOD NEWEST", "PRINCIPAL MID", "SENIOR MOST", "VICE PRINCIPAL", "COLLEAGUE MID", "NO DATE"]);
  });

  it("each person carries the seats they hold - the phrases as before, plus the role codes the order uses", async () => {
    const { rows } = await list("department=CSE&withSeats=1");
    const byName = Object.fromEntries(rows.map((r) => [r.legalName, r]));
    expect(byName["HOD NEWEST"].seatLabels).toEqual(["HOD of CSE"]);
    expect(byName["HOD NEWEST"].seatRoleCodes).toEqual(["HOD"]);
    expect(byName["PRINCIPAL MID"].seatRoleCodes).toEqual(["PRINCIPAL"]);
    expect(byName["VICE PRINCIPAL"].seatRoleCodes).toEqual(["VICE_PRINCIPAL"]);
    expect(byName["SENIOR MOST"].seatRoleCodes).toBeUndefined();
    expect(byName["COLLEAGUE MID"].seatLabels).toBeUndefined();
  });

  it("the whole college (no department chosen) puts the HOD and the Principal first too", async () => {
    const { rows } = await list("withSeats=1");
    expect(names(rows).slice(0, 2)).toEqual(["HOD NEWEST", "PRINCIPAL MID"]);
  });

  it("a caller that does not ask for seats (the pickers) keeps exactly the order it always had", async () => {
    const { rows } = await list("department=CSE");
    // the department's HOD first, then earliest joining first; no seat data is added
    expect(names(rows)).toEqual(["HOD NEWEST", "SENIOR MOST", "VICE PRINCIPAL", "PRINCIPAL MID", "COLLEAGUE MID", "NO DATE"]);
    expect(rows.every((r) => r.seatRoleCodes === undefined && r.seatLabels === undefined)).toBe(true);
  });
});
