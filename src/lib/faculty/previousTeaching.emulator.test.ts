import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Previous Teaching Assignments (free text) through the REAL routes on a real Firestore (the local emulator): a faculty
// member's own save (faculty/me) and the HOD/Principal's (faculty/[id]) land on the facultyMembers record, never touch
// the current teachingAssignments, and a stale editor can't erase a row somebody else added. Skipped unless the
// emulator is running:
//   firebase emulators:exec --config <cfg> --only firestore --project demo-pt "npx vitest run src/lib/faculty/previousTeaching.emulator.test.ts"

const EMULATOR = !!process.env.FIRESTORE_EMULATOR_HOST;
const who = { uid: "fu1", role: "PANEL_MEMBER" as string };

vi.mock("@/lib/firebase/admin", () => {
  const app = () => (getApps().length ? getApp() : initializeApp({ projectId: "demo-pt" }));
  return { getAdminDb: () => getFirestore(app()), getAdminAuth: async () => ({ getUser: async () => null, updateUser: async () => ({}) }) };
});
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (roles.length && !roles.includes(who.role)) throw new Error("UNAUTHORIZED");
    return { uid: who.uid, email: "x@y.z", role: who.role, realRole: who.role, roles: [who.role], collegeId: "c1" };
  },
  isDepartmentOffice: () => false,
}));

const C = "c1";
const ext = { source: "EXTERNAL", collegeName: "ABC College", academicYear: "2022-2023", course: "B.Tech", year: "3rd", semester: "II", subject: "Compiler Design", passPercentage: "92" };
const int = { source: "INTERNAL", academicYear: "2023-2024", course: "M.Tech", year: "1st", semester: "I", subject: "Algorithms", passPercentage: "88%" };

describe.skipIf(!EMULATOR)("previous teaching assignments (real Firestore)", () => {
  const db = () => getFirestore(getApps().length ? getApp() : initializeApp({ projectId: "demo-pt" }));
  const col = (n: string) => db().collection("colleges").doc(C).collection(n);
  const faculty = async () => (await col("facultyMembers").doc("f1").get()).data() as Record<string, unknown>;
  const mePatch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/me/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }));
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const idPatch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/college/faculty/[id]/route");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "f1" }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  beforeEach(async () => {
    for (const n of ["users", "facultyMembers", "teachingAssignments", "auditLogs"]) for (const d of (await col(n).get()).docs) await d.ref.delete();
    who.uid = "fu1"; who.role = "PANEL_MEMBER";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await col("users").doc("fu1").set({ collegeId: C, name: "FAC ONE", role: "PANEL_MEMBER", isActive: true });
    await col("facultyMembers").doc("f1").set({ collegeId: C, userUid: "fu1", legalName: "FAC ONE", employeeId: "E1", status: "ACTIVE", department: "Mech", designation: "ASSISTANT_PROFESSOR", fatherName: "F" });
    await col("teachingAssignments").doc("ta1").set({ collegeId: C, facultyId: "f1", courseName: "B.Tech", year: 2, subjectName: "Thermo", isPast: false });
    await col("teachingAssignments").doc("ta2").set({ collegeId: C, facultyId: "f1", courseName: "B.Tech", year: 1, subjectName: "Old", isPast: true, passPercentage: 70 });
  });

  it("faculty/me GET flags a real faculty record (so the self-edit shows)", async () => {
    const { GET } = await import("@/app/api/college/faculty/me/route");
    const json = (await (await GET()).json()) as { facultyRecord?: boolean };
    expect(json.facultyRecord).toBe(true);
  });

  it("a faculty member saves their own previous teaching assignments - free text, Internal and External", async () => {
    const r = await mePatch({ previousTeachingAssignments: [ext, int], previousTeachingAssignmentsLoadedIds: [] });
    expect(r.status).toBe(200);
    const rows = (await faculty()).previousTeachingAssignments as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: "EXTERNAL", collegeName: "ABC College", academicYear: "2022-2023", course: "B.Tech", year: "3rd", semester: "II", subject: "Compiler Design", passPercentage: "92" });
    expect(rows[1]).toMatchObject({ source: "INTERNAL", collegeName: "", subject: "Algorithms", passPercentage: "88%" });
    expect(rows.every((x) => typeof x.id === "string" && x.id)).toBe(true);
  });

  it("nothing else on the faculty record moves, and the current/past teachingAssignments are untouched", async () => {
    await mePatch({ previousTeachingAssignments: [int], previousTeachingAssignmentsLoadedIds: [] });
    expect(await faculty()).toMatchObject({ legalName: "FAC ONE", employeeId: "E1", status: "ACTIVE", department: "Mech", designation: "ASSISTANT_PROFESSOR", fatherName: "F", userUid: "fu1" });
    expect((await col("teachingAssignments").get()).size).toBe(2);
    expect((await col("teachingAssignments").doc("ta1").get()).data()).toMatchObject({ subjectName: "Thermo", isPast: false });
    expect((await col("teachingAssignments").doc("ta2").get()).data()).toMatchObject({ subjectName: "Old", passPercentage: 70 });
  });

  it("a save that does not mention the field leaves stored rows alone", async () => {
    await mePatch({ previousTeachingAssignments: [int], previousTeachingAssignmentsLoadedIds: [] });
    expect((await mePatch({ specialization: "Thermal" })).status).toBe(200);
    expect(((await faculty()).previousTeachingAssignments as unknown[]).length).toBe(1);
  });

  it("External without a College Name is refused (400) and nothing is written", async () => {
    const r = await mePatch({ previousTeachingAssignments: [{ ...ext, collegeName: "" }], previousTeachingAssignmentsLoadedIds: [] });
    expect(r.status).toBe(400);
    expect((await faculty()).previousTeachingAssignments).toBeUndefined();
  });

  it("the HOD/Principal's save and the faculty member's save never erase each other's rows", async () => {
    // faculty loads (nothing yet), HOD adds one, then the faculty saves a stale list with their own new row
    who.role = "PRINCIPAL"; who.uid = "pr1";
    expect((await idPatch({ previousTeachingAssignments: [ext], previousTeachingAssignmentsLoadedIds: [] })).status).toBe(200);
    const hodRow = ((await faculty()).previousTeachingAssignments as { id: string }[])[0];
    who.role = "PANEL_MEMBER"; who.uid = "fu1";
    expect((await mePatch({ previousTeachingAssignments: [int], previousTeachingAssignmentsLoadedIds: [] })).status).toBe(200);
    const rows = (await faculty()).previousTeachingAssignments as { id: string; subject: string }[];
    expect(rows.map((r) => r.subject).sort()).toEqual(["Algorithms", "Compiler Design"]);
    expect(rows.some((r) => r.id === hodRow.id)).toBe(true);
  });

  it("deleting a row the editor had loaded removes it, others stay", async () => {
    await mePatch({ previousTeachingAssignments: [ext, int], previousTeachingAssignmentsLoadedIds: [] });
    const rows = (await faculty()).previousTeachingAssignments as { id: string }[];
    expect((await mePatch({ previousTeachingAssignments: [rows[0]], previousTeachingAssignmentsLoadedIds: rows.map((r) => r.id) })).status).toBe(200);
    expect(((await faculty()).previousTeachingAssignments as unknown[]).length).toBe(1);
  });

  it("edits to an existing row keep its id", async () => {
    await mePatch({ previousTeachingAssignments: [int], previousTeachingAssignmentsLoadedIds: [] });
    const [row] = (await faculty()).previousTeachingAssignments as { id: string }[];
    await mePatch({ previousTeachingAssignments: [{ ...int, id: row.id, subject: "Algorithms II" }], previousTeachingAssignmentsLoadedIds: [row.id] });
    const after = (await faculty()).previousTeachingAssignments as { id: string; subject: string }[];
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: row.id, subject: "Algorithms II" });
  });

  it("a login with no faculty record is refused (404) and nothing is created", async () => {
    await col("users").doc("fu2").set({ collegeId: C, name: "NO REC", role: "PANEL_MEMBER", isActive: true });
    who.uid = "fu2";
    const r = await mePatch({ previousTeachingAssignments: [int], previousTeachingAssignmentsLoadedIds: [] });
    expect(r.status).toBe(404);
    expect((await col("facultyMembers").get()).size).toBe(1);
  });

  it("a role that is not Faculty cannot use faculty/me", async () => {
    who.role = "STUDENT";
    expect((await mePatch({ previousTeachingAssignments: [int] })).status).toBe(401);
    expect((await faculty()).previousTeachingAssignments).toBeUndefined();
  });
});
