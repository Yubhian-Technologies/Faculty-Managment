import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// The College Office's student Edit form may change the Roll No; every other role's
// edit still ignores it. Real route against in-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string },
}));
vi.mock("@/lib/auth/verifySession", () => ({
  requireCollegeMember: async (...roles: string[]) => {
    if (!h.session) throw new Error("UNAUTHORIZED");
    if (roles.length && !roles.includes(h.session.role)) throw new Error("UNAUTHORIZED");
    return h.session;
  },
}));
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => h.db, getAdminAuth: async () => h.auth }));
vi.mock("@/lib/departments/scope", () => ({
  getHodDepartmentScope: async () => ({
    ownDepartmentNames: ["CSE"], childDepartmentNames: [], managedDepartmentNames: [], departmentName: "CSE",
    ownDepartmentIds: [], childDepartmentIds: [], managedDepartmentIds: [], departmentId: null,
  }),
}));

import { PATCH } from "./[id]/route";

const C = "colleges/c1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, details: Record<string, unknown>) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ details }) }), params(id));
const audits = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d.action);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.auth.users.set("u1", { uid: "u1", email: "r1@students.internal", password: "pw-keep-1", disabled: false, customClaims: { role: "STUDENT" } });
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({
    [`${C}/users/office1`]: { name: "Office" },
    [`${C}/courses/course1`]: { name: "BTech", catalogId: "btech", durationYears: 4 },
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "R1", rollNumberUpper: "R1", status: "REGULAR", department: "CSE", year: 2, section: "A", courseId: "course1", uid: "u1", loginEmail: "r1@students.internal", mobileNo: "9000000000" },
    [`${C}/students/s2`]: { name: "Bala", rollNumber: "R2", rollNumberUpper: "R2", status: "REGULAR", department: "CSE", year: 2, section: "A", courseId: "course1", mobileNo: "9000000001" },
    [`${C}/users/u1`]: { uid: "u1", role: "STUDENT", email: "r1@students.internal" },
    "studentUsernames/R1": { uid: "u1", collegeId: "c1", studentDocId: "s1", loginEmail: "r1@students.internal", rollKey: "r1", active: true, createdAt: new Date() },
    "studentUsernames/R2": { collegeId: "c1", studentDocId: "s2", name: "Bala", rollKey: "r2", active: true, createdAt: new Date() },
    "colleges/c9/students/z1": { name: "Other College Zed", rollNumber: "Z9" },
    "studentUsernames/Z9": { collegeId: "c9", studentDocId: "z1", name: "Other College Zed", rollKey: "z9", active: true, createdAt: new Date() },
  });
});

describe("College Office edit form: Roll No is editable", () => {
  it("changes the roll together with the other edited fields in ONE write, and the login follows (registry, Auth email, profile) with the password kept", async () => {
    const res = await patch("s1", { rollNumber: "R1-NEW", mobileNo: "9876543210" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1-NEW", rollNumberUpper: "R1-NEW", mobileNo: "9876543210", loginEmail: "r1new@students.internal" });
    expect(h.db.get("studentUsernames/R1NEW")).toMatchObject({ uid: "u1", collegeId: "c1", studentDocId: "s1", active: true });
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(h.auth.users.get("u1")).toMatchObject({ email: "r1new@students.internal", password: "pw-keep-1" });
    expect(h.db.get(`${C}/users/u1`)?.email).toBe("r1new@students.internal");
    expect(audits()).toEqual(expect.arrayContaining(["STUDENT_ROLL_CHANGED", "STUDENT_DETAILS_UPDATED"]));
  });

  it("the unchanged roll the form re-sends with every save is a no-op: no registry or Auth change", async () => {
    const res = await patch("s1", { rollNumber: "R1", mobileNo: "9876543210" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", mobileNo: "9876543210" });
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: true });
    expect(h.auth.calls).toHaveLength(0);
    expect(audits()).not.toContain("STUDENT_ROLL_CHANGED");
  });

  it("a roll-only request works", async () => {
    expect((await patch("s1", { rollNumber: "R1-NEW" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)?.rollNumber).toBe("R1-NEW");
  });

  it("a student without a login: the roll and registry change, no Auth call", async () => {
    expect((await patch("s2", { rollNumber: "R2-NEW" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ rollNumber: "R2-NEW", rollNumberUpper: "R2-NEW" });
    expect(h.db.get("studentUsernames/R2NEW")).toMatchObject({ collegeId: "c1", studentDocId: "s2", active: true });
    expect(h.db.get("studentUsernames/R2")).toMatchObject({ active: false });
    expect(h.auth.calls).toHaveLength(0);
  });

  it("refuses a roll another student of this college holds (any case/format) and writes NOTHING - not even the other fields", async () => {
    const res = await patch("s1", { rollNumber: "r-2", mobileNo: "9876543210" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Bala");
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", mobileNo: "9000000000" });
    expect(h.auth.users.get("u1")?.email).toBe("r1@students.internal");
  });

  it("refuses a roll held in ANOTHER college, without naming that student", async () => {
    const res = await patch("s1", { rollNumber: "z-9", mobileNo: "9876543210" });
    expect(res.status).toBe(400);
    const err = (await res.json()).error as string;
    expect(err).toMatch(/another college/);
    expect(err).not.toContain("Other College Zed");
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", mobileNo: "9000000000" });
  });

  it("an existing roll can never be blanked (empty string or null), and nothing is written", async () => {
    for (const blank of ["", "   ", null]) {
      const res = await patch("s1", { rollNumber: blank, mobileNo: "9876543210" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("can't be removed");
    }
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", mobileNo: "9000000000" });
  });

  it("a legacy roll-less student can still be saved while roll-less", async () => {
    h.db.docs.set(`${C}/students/s3`, { name: "Legacy", rollNumber: "", status: "REGULAR", department: "CSE", year: 2, section: "A", courseId: "course1" });
    expect((await patch("s3", { rollNumber: "", mobileNo: "9876543210" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s3`)?.mobileNo).toBe("9876543210");
  });

  it("a failed Auth email change rolls everything back (roll and other fields unchanged)", async () => {
    h.auth.failNext.updateUser = new Error("auth hiccup");
    const res = await patch("s1", { rollNumber: "R1-NEW", mobileNo: "9876543210" });
    expect(res.status).toBe(500);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", mobileNo: "9000000000" });
    expect(h.db.get("studentUsernames/R1NEW")).toBeUndefined();
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: true });
  });
});

describe("every OTHER role's edit still ignores the Roll No", () => {
  for (const role of ["HOD", "PRINCIPAL", "VICE_PRINCIPAL", "SUPER_ADMIN"]) {
    it(`${role}: the roll in the details is ignored; the other fields still save`, async () => {
      h.session = { collegeId: "c1", uid: "x1", role };
      const res = await patch("s1", { rollNumber: "HACKED-1", mobileNo: "9876543210" });
      expect(res.status).toBe(200);
      expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", rollNumberUpper: "R1", mobileNo: "9876543210", loginEmail: "r1@students.internal" });
      expect(h.db.get("studentUsernames/HACKED1")).toBeUndefined();
      expect(h.auth.calls).toHaveLength(0);
    });
  }

  it("a roll-only details request from another role is still 'No editable fields'", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await patch("s1", { rollNumber: "R1-NEW" })).status).toBe(400);
    expect(h.db.get(`${C}/students/s1`)?.rollNumber).toBe("R1");
  });

  it("roles outside the edit list are refused as before", async () => {
    h.session = { collegeId: "c1", uid: "lib1", role: "LIBRARY" };
    expect((await patch("s1", { rollNumber: "R1-NEW" })).status).toBe(401);
  });
});
