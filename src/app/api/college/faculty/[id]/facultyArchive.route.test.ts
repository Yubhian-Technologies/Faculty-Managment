import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// F1: DELETE /faculty/[id] archives instead of erasing. In-memory fakes only.

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

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.hodMayManage = true;
  h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
  h.auth = new FakeAuth();
  h.auth.users.set("u1", { uid: "u1", email: "rao@vit.edu", password: "p", disabled: false, customClaims: {} });
  h.db = new FakeFirestore({
    [`${C}/users/hod1`]: { name: "The HOD" },
    [`${C}/facultyMembers/f1`]: { legalName: "Dr Rao", employeeId: "EMP0001", collegeEmail: "rao@vit.edu", userUid: "u1", department: "CSE" },
    [`${C}/users/u1`]: { uid: "u1", role: "PANEL_MEMBER" },
    "systemUsers/u1": { uid: "u1", role: "PANEL_MEMBER", collegeId: "c1" },
    [`${C}/leaveRequests/lr1`]: { facultyId: "f1", status: "APPROVED" },
    [`${C}/attendanceRecords/u1_2026-10-01`]: { facultyId: "u1", status: "PRESENT" },
  });
});

describe("DELETE /faculty/[id] (F1)", () => {
  it("archives: record + login docs preserved, login disabled, audited; leave and attendance history untouched", async () => {
    const res = await del("f1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, archived: true });

    expect(h.db.get(`${C}/facultyMembers/f1`)).toBeUndefined();
    expect(h.db.get(`${C}/archivedFacultyMembers/f1`)).toMatchObject({ legalName: "Dr Rao", employeeId: "EMP0001", archiveReason: "REMOVED_BY_USER" });
    expect(h.auth.users.get("u1")?.disabled).toBe(true);
    expect(h.auth.calls.some((c) => c.fn === "deleteUser")).toBe(false);
    expect(h.db.get(`${C}/leaveRequests/lr1`)).toBeDefined();
    expect(h.db.get(`${C}/attendanceRecords/u1_2026-10-01`)).toBeDefined();
    const audit = [...h.db.docs.entries()].find(([p, d]) => p.startsWith(`${C}/auditLogs/`) && d.action === "FACULTY_DELETED");
    expect(audit?.[1].details).toMatchObject({ name: "Dr Rao", archived: true });
  });

  it("is refused with 409 and a reason while they still teach, hold a seat, or are an in-charge - nothing changes", async () => {
    const cases: [string, Record<string, unknown>][] = [
      [`${C}/teachingAssignments/t1`, { facultyId: "f1" }],
      [`${C}/roleSeats/seat1`, { holderUid: "u1" }],
      [`${C}/sections/sec1`, { facultyInchargeUid: "u1" }],
    ];
    for (const [path, data] of cases) {
      h.db.docs.set(path, data);
      const res = await del("f1");
      expect(res.status).toBe(409);
      expect(typeof (await res.json()).error).toBe("string");
      expect(h.db.get(`${C}/facultyMembers/f1`)).toBeDefined();
      expect(h.db.get(`${C}/archivedFacultyMembers/f1`)).toBeUndefined();
      expect(h.auth.users.get("u1")?.disabled).toBe(false);
      h.db.docs.delete(path);
    }
  });

  it("an HOD cannot remove faculty outside their scope (403)", async () => {
    h.hodMayManage = false;
    expect((await del("f1")).status).toBe(403);
    expect(h.db.get(`${C}/facultyMembers/f1`)).toBeDefined();
  });

  it("Principal can; unknown id is 404; other roles and no session are 401", async () => {
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await del("nope")).status).toBe(404);
    expect((await del("f1")).status).toBe(200);

    h.db.docs.set(`${C}/facultyMembers/f2`, { legalName: "X", employeeId: "EMP0002" });
    h.session = { collegeId: "c1", uid: "o1", role: "COLLEGE_OFFICE" };
    expect((await del("f2")).status).toBe(401);
    h.session = null;
    expect((await del("f2")).status).toBe(401);
    expect(h.db.get(`${C}/facultyMembers/f2`)).toBeDefined();
  });
});
