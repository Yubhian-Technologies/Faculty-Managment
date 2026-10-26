import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Real-database check (the local emulator - nothing here can reach a live project) that a head of several departments raises a
// hiring request, and sees the faculty requirement, for the department they are WORKING in, not just the first one on their login.
// Skipped unless the emulator is running:
//
//   firebase emulators:exec --only firestore --project demo-vacancy "npx vitest run src/app/api/college/vacancyDepartment.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const h = vi.hoisted(() => ({ cookie: "" as string }));

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-vacancy" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => { throw new Error("auth not available in this test"); } };
});
vi.mock("@/lib/auth/verifySession", () => ({ requireCollegeMember: async () => ({ uid: "u-hod", email: "h@x.test", role: "HOD", collegeId: "c1" }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "fms_hod_dept" && h.cookie ? { value: h.cookie } : undefined) }) }));
vi.mock("@/lib/audit/safeAuditLog", () => ({ writeAuditLogSafe: async () => undefined }));

const IT = "Information Technology";
const CSBS = "Computer Science and Business System";
const BS = "Basic Science";
const OTHER = "Mechanical Engineering";
const pick = (dept: string) => encodeURIComponent(`u-hod|${dept}`);

describe.skipIf(!EMULATOR)("hiring request department for a multi-department HOD, through the real routes", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-vacancy" }));
  const col = (n: string) => db().collection("colleges").doc("c1").collection(n);

  const requirement = async (query = "") => {
    const { GET } = await import("@/app/api/college/faculty-requirement/route");
    const res = await GET(new Request(`http://localhost/api/college/faculty-requirement${query}`));
    return { status: res.status, body: await res.json() as { department?: string; totalStudents?: number; error?: string } };
  };
  const submit = async (department: string) => {
    const { POST } = await import("@/app/api/college/vacancy-requests/route");
    const res = await POST(new Request("http://localhost/api/college/vacancy-requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: "Assistant Professor", department, positionCategory: "TEACHING", requiredCount: 1, justification: "needed for the new batch", hodJustification: "needed for the new batch" }),
    }));
    return { status: res.status, body: await res.json() as { error?: string } };
  };

  beforeAll(async () => {
    await db().collection("colleges").doc("c1").set({ name: "C1" });
    for (const name of [IT, CSBS, BS, OTHER]) await col("departments").add({ name, isActive: true });
    await col("users").doc("u-hod").set({ role: "HOD", name: "Multi Head", department: IT, departments: [IT, CSBS, BS] });
    for (let i = 0; i < 3; i++) await col("students").add({ department: CSBS, status: "ACTIVE", name: `S${i}` });
    await col("students").add({ department: IT, status: "ACTIVE", name: "T0" });
  });
  beforeEach(() => { h.cookie = ""; });

  it("with the department named (what the page sends) it returns that department - the one they work in, not the first on their login", async () => {
    h.cookie = pick(CSBS);
    const r = await requirement(`?department=${encodeURIComponent(CSBS)}`);
    expect(r.status).toBe(200);
    expect(r.body.department).toBe(CSBS);
    expect(r.body.totalStudents).toBe(3);
  });

  it("naming one of their other departments works even while a different one is picked in Working as", async () => {
    h.cookie = pick(IT);
    const r = await requirement(`?department=${encodeURIComponent(BS)}`);
    expect(r.status).toBe(200);
    expect(r.body.department).toBe(BS);
  });

  it("with no department named it follows the pick in Working as (it used to always answer for the first department)", async () => {
    h.cookie = pick(CSBS);
    expect((await requirement()).body.department).toBe(CSBS);
    h.cookie = pick(BS);
    expect((await requirement()).body.department).toBe(BS);
  });

  it("with nothing picked it still answers for their login's own department, as before", async () => {
    const r = await requirement();
    expect(r.status).toBe(200);
    expect(r.body.department).toBe(IT);
  });

  it("a department they do not head is refused", async () => {
    const r = await requirement(`?department=${encodeURIComponent(OTHER)}`);
    expect(r.status).toBe(403);
  });

  it("a hiring request can be raised for any department they head, and is stored under that department", async () => {
    for (const dept of [CSBS, BS, IT]) {
      const r = await submit(dept);
      expect(r.status).toBe(201);
    }
    const stored = (await col("vacancyRequests").get()).docs.map((d) => (d.data() as { department: string }).department).sort();
    expect(stored).toEqual([BS, CSBS, IT].sort());
  });

  it("but not for a department outside their scope - nothing is stored", async () => {
    const before = (await col("vacancyRequests").get()).size;
    const r = await submit(OTHER);
    expect(r.status).toBe(403);
    expect((await col("vacancyRequests").get()).size).toBe(before);
  });
  const attach = async (vacancyRequestId: string, candidateId: string) => {
    const { POST } = await import("@/app/api/college/candidate-applications/route");
    const res = await POST(new Request("http://localhost/api/college/candidate-applications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId, vacancyRequestId }),
    }));
    return res.status;
  };

  it("candidates can be attached to a request raised for ANY department they head (not only the first), but not to another department's", async () => {
    await col("candidates").doc("cand1").set({ name: "Cand One" });
    await col("candidates").doc("cand2").set({ name: "Cand Two" });
    await col("vacancyRequests").doc("v-csbs").set({ department: CSBS, status: "APPROVED", position: "Assistant Professor", hodUid: "u-hod" });
    await col("vacancyRequests").doc("v-other").set({ department: OTHER, status: "APPROVED", position: "Assistant Professor", hodUid: "u-other" });
    expect([200, 201]).toContain(await attach("v-csbs", "cand1"));
    expect(await attach("v-other", "cand2")).toBe(403);
  });
});
