import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// DELETE /faculty/[id] is a permanent delete again: the faculty record, its login
// profile and role mapping and the Firebase Auth account all go; nothing is archived.
// In-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string },
  hodMayManage: true,
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session || (roles.length && !roles.includes(h.session.role))) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db, getAdminAuth: async () => h.auth }));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({ departmentName: "CSE" }),
  canHodManageFacultyDepartment: () => h.hodMayManage,
}));

import { DELETE } from "./route";

const C = "colleges/c1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(new Request("http://localhost/x", { method: "DELETE" }), params(id));
const auditDocs = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.hodMayManage = true;
  h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
  h.auth = new FakeAuth();
  h.auth.users.set("u1", { uid: "u1", email: "rao@vit.edu", password: "p", disabled: false, customClaims: {} });
  h.db = new FakeFirestore({
    [`${C}/users/hod1`]: { name: "The HOD" },
    [`${C}/facultyMembers/f1`]: { legalName: "Dr Rao", employeeId: "EMP0001", collegeEmail: "rao@vit.edu", userUid: "u1", department: "CSE" },
    [`${C}/facultyMembers/f2`]: { legalName: "Someone Else", employeeId: "EMP0002", userUid: "u2", department: "CSE" },
    [`${C}/users/u1`]: { uid: "u1", role: "PANEL_MEMBER", name: "Dr Rao" },
    [`${C}/users/u2`]: { uid: "u2", role: "PANEL_MEMBER", name: "Someone Else" },
    "systemUsers/u1": { uid: "u1", role: "PANEL_MEMBER", collegeId: "c1" },
    "systemUsers/u2": { uid: "u2", role: "PANEL_MEMBER", collegeId: "c1" },
    [`${C}/leaveRequests/lr1`]: { facultyId: "f1", status: "APPROVED" },
  });
  h.auth.users.set("u2", { uid: "u2", email: "se@vit.edu", password: "p", disabled: false, customClaims: {} });
});

describe("DELETE /faculty/[id] - permanent, no archive", () => {
  it("deletes the record, the login profile, the role mapping AND the Firebase Auth account", async () => {
    const res = await del("f1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(h.db.get(`${C}/facultyMembers/f1`)).toBeUndefined();
    expect(h.db.get(`${C}/users/u1`)).toBeUndefined();
    expect(h.db.get("systemUsers/u1")).toBeUndefined();
    expect(h.auth.users.has("u1")).toBe(false); // deleted, not disabled
  });

  it("keeps NO archive copy anywhere, and no personal data is left in any document (the audit trail aside, which records who was deleted, as before)", async () => {
    await del("f1");
    expect([...h.db.docs.keys()].filter((k) => /archiv/i.test(k))).toEqual([]);
    const everything = JSON.stringify([...h.db.docs.entries()].filter(([p]) => !p.startsWith(`${C}/auditLogs/`)));
    expect(everything).not.toContain("rao@vit.edu");
    expect(everything).not.toContain("Dr Rao");
  });

  it("other faculty and their logins are untouched", async () => {
    await del("f1");
    expect(h.db.get(`${C}/facultyMembers/f2`)).toBeDefined();
    expect(h.db.get(`${C}/users/u2`)).toBeDefined();
    expect(h.db.get("systemUsers/u2")).toBeDefined();
    expect(h.auth.users.has("u2")).toBe(true);
  });

  it("writes one FACULTY_DELETED audit entry that records the name (not an 'archived' flag)", async () => {
    await del("f1");
    const entries = auditDocs().filter((a) => a.action === "FACULTY_DELETED");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ performedBy: "hod1", performedByName: "The HOD", targetId: "f1" });
    expect(entries[0].details).toEqual({ name: "Dr Rao" });
  });

  it("records other modules keep (leave requests) are not rewritten", async () => {
    await del("f1");
    expect(h.db.get(`${C}/leaveRequests/lr1`)).toEqual({ facultyId: "f1", status: "APPROVED" });
  });

  it("a failure deleting the Auth account is non-fatal: the Firestore records are still gone and it answers 200", async () => {
    h.auth.failNext.deleteUser = new Error("auth hiccup");
    const res = await del("f1");
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/facultyMembers/f1`)).toBeUndefined();
    expect(h.db.get(`${C}/users/u1`)).toBeUndefined();
    expect(h.db.get("systemUsers/u1")).toBeUndefined();
  });

  it("a faculty member with no login is deleted without touching Auth", async () => {
    h.db.docs.set(`${C}/facultyMembers/f3`, { legalName: "No Login", employeeId: "EMP0003", department: "CSE" });
    expect((await del("f3")).status).toBe(200);
    expect(h.db.get(`${C}/facultyMembers/f3`)).toBeUndefined();
    expect(h.auth.calls).toHaveLength(0);
  });

  it("is refused (409) while they still have a teaching assignment or a timetable slot - nothing is deleted", async () => {
    for (const [path, data] of [
      [`${C}/teachingAssignments/t1`, { facultyId: "f1" }],
      [`${C}/timetableSlots/s1`, { facultyId: "f1" }],
    ] as const) {
      h.db.docs.set(path, data);
      const res = await del("f1");
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Resigned\/Retired/);
      expect(h.db.get(`${C}/facultyMembers/f1`)).toBeDefined();
      expect(h.db.get(`${C}/users/u1`)).toBeDefined();
      expect(h.auth.users.has("u1")).toBe(true);
      h.db.docs.delete(path);
    }
    expect(auditDocs().filter((a) => a.action === "FACULTY_DELETED")).toHaveLength(0);
  });

  it("someone else's assignments do not block", async () => {
    h.db.docs.set(`${C}/teachingAssignments/t1`, { facultyId: "f2" });
    expect((await del("f1")).status).toBe(200);
  });

  it("an HOD cannot delete faculty outside their scope (403) and nothing changes", async () => {
    h.hodMayManage = false;
    expect((await del("f1")).status).toBe(403);
    expect(h.db.get(`${C}/facultyMembers/f1`)).toBeDefined();
    expect(h.auth.users.has("u1")).toBe(true);
  });

  it("Principal and Vice Principal can delete; unknown id is 404; other roles and no session are 401", async () => {
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await del("nope")).status).toBe(404);
    expect((await del("f1")).status).toBe(200);

    h.session = { collegeId: "c1", uid: "vp1", role: "VICE_PRINCIPAL" };
    expect((await del("f2")).status).toBe(200);

    h.db.docs.set(`${C}/facultyMembers/f4`, { legalName: "X", employeeId: "EMP0004" });
    h.session = { collegeId: "c1", uid: "o1", role: "COLLEGE_OFFICE" };
    expect((await del("f4")).status).toBe(401);
    h.session = null;
    expect((await del("f4")).status).toBe(401);
    expect(h.db.get(`${C}/facultyMembers/f4`)).toBeDefined();
  });
});
