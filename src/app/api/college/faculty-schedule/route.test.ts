import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// GET /faculty-schedule is open to supporting staff (COLLEGE_STAFF) only while they hold a Timetable
// Incharge delegation; every other role that may call it is unchanged. In-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  session: null as null | { collegeId: string; uid: string; role: string; roles?: string[] },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session || (roles.length && !roles.includes(h.session.role))) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db }));

import { GET } from "./route";

const C = "colleges/c1";
const call = (qs: string) => GET(new Request(`http://localhost/api/college/faculty-schedule?${qs}`));
const listDept = () => call("departmentId=d1");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.db = new FakeFirestore({
    [`${C}/departments/d1`]: { name: "CSE" },
    [`${C}/facultyMembers/f1`]: { legalName: "Dr Rao", department: "CSE", status: "ACTIVE" },
    [`${C}/timetableIncharges/course1_year2`]: { uid: "staffIncharge", departmentName: "CSE", courseId: "course1", year: 2 },
  });
});

describe("GET /faculty-schedule - supporting staff need a Timetable Incharge delegation", () => {
  it("refuses a supporting-staff login with no delegation, on both lookups", async () => {
    h.session = { collegeId: "c1", uid: "staffPlain", role: "COLLEGE_STAFF", roles: ["COLLEGE_STAFF"] };
    const byDept = await listDept();
    expect(byDept.status).toBe(403);
    expect(JSON.stringify(await byDept.json())).not.toContain("Dr Rao");
    const bySchedule = await call("facultyId=f1");
    expect(bySchedule.status).toBe(403);
  });

  it("still refuses when the only delegation on file belongs to someone else", async () => {
    h.session = { collegeId: "c1", uid: "staffOther", role: "COLLEGE_STAFF", roles: ["COLLEGE_STAFF"] };
    expect((await listDept()).status).toBe(403);
  });

  it("allows a supporting-staff login that is the Timetable Incharge for any course-year", async () => {
    h.session = { collegeId: "c1", uid: "staffIncharge", role: "COLLEGE_STAFF", roles: ["COLLEGE_STAFF"] };
    const res = await listDept();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ faculty: [{ id: "f1", name: "Dr Rao" }] });
  });

  it("ignores a delegation held in a different college", async () => {
    h.db = new FakeFirestore({
      [`${C}/departments/d1`]: { name: "CSE" },
      "colleges/c2/timetableIncharges/x_year1": { uid: "staffIncharge", departmentName: "CSE" },
    });
    h.session = { collegeId: "c1", uid: "staffIncharge", role: "COLLEGE_STAFF", roles: ["COLLEGE_STAFF"] };
    expect((await listDept()).status).toBe(403);
  });
});

describe("GET /faculty-schedule - every other role is unchanged (no delegation required)", () => {
  for (const role of ["HOD", "PANEL_MEMBER", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"]) {
    it(`${role} without any delegation still gets the lookup`, async () => {
      h.session = { collegeId: "c1", uid: "nobody", role, roles: [role] };
      const res = await listDept();
      expect(res.status).toBe(200);
      expect((await res.json()).faculty).toHaveLength(1);
    });
  }

  it("a login whose effective role is staff but who also holds Faculty/HOD keeps that access", async () => {
    for (const other of ["PANEL_MEMBER", "HOD"]) {
      h.session = { collegeId: "c1", uid: "nobody", role: "COLLEGE_STAFF", roles: ["COLLEGE_STAFF", other] };
      expect((await listDept()).status).toBe(200);
    }
  });

  it("roles outside the route's list are still rejected before any of this", async () => {
    h.session = { collegeId: "c1", uid: "stu", role: "STUDENT", roles: ["STUDENT"] };
    const res = await listDept();
    expect(res.status).not.toBe(200);
  });
});
