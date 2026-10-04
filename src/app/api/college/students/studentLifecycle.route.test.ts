import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// Drives the REAL student routes against in-memory Firestore/Auth fakes - nothing
// here can reach a real project. Covers S5 (archive instead of delete), S4 (roll
// sync, status/labBatch edits), S6 (promotion/graduation validation).

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string; email?: string },
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

import { DELETE as deleteStudent, PATCH as patchStudent } from "./[id]/route";
import { POST as promote } from "./promote/route";

const C = "colleges/c1";
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

function seed() {
  h.db = new FakeFirestore({
    [`${C}/users/office1`]: { name: "Office" },
    [`${C}/courses/course1`]: { name: "BTech", catalogId: "btech", durationYears: 4 },
    [`${C}/courses/course2`]: { name: "MBA", catalogId: "mba", durationYears: 2 },
    [`${C}/sections/y2A`]: { name: "A", year: 2, department: "CSE", courseId: "course1", courseName: "BTech", batch: "2024-28" },
    [`${C}/sections/y3A`]: { name: "A", year: 3, department: "CSE", courseId: "course1", courseName: "BTech", batch: "2023-27" },
    [`${C}/sections/y4A`]: { name: "A", year: 4, department: "CSE", courseId: "course1", courseName: "BTech", batch: "2022-26" },
    [`${C}/sections/mba1`]: { name: "A", year: 3, department: "MBA", courseId: "course2", courseName: "MBA" },
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "R1", rollNumberUpper: "R1", status: "REGULAR", department: "CSE", year: 2, section: "A", courseId: "course1", uid: "u1", loginEmail: "r1@students.internal", labBatch: "B1" },
    [`${C}/students/s2`]: { name: "Bala", rollNumber: "R2", rollNumberUpper: "R2", status: "REGULAR", department: "CSE", year: 2, section: "A", courseId: "course1" },
    [`${C}/students/s4`]: { name: "Final", rollNumber: "R4", rollNumberUpper: "R4", status: "REGULAR", department: "CSE", year: 4, section: "A", courseId: "course1", uid: "u4", loginEmail: "r4@students.internal" },
    [`${C}/users/u1`]: { uid: "u1", isActive: true, role: "STUDENT" },
    [`${C}/users/u4`]: { uid: "u4", isActive: true, role: "STUDENT" },
    "studentUsernames/R1": { uid: "u1", collegeId: "c1", studentDocId: "s1", rollKey: "r1", loginEmail: "r1@students.internal", active: true, createdAt: new Date() },
    "studentUsernames/R4": { uid: "u4", collegeId: "c1", studentDocId: "s4", rollKey: "r4", loginEmail: "r4@students.internal", active: true, createdAt: new Date() },
  });
  h.auth = new FakeAuth();
  h.auth.users.set("u1", { uid: "u1", email: "r1@students.internal", password: "pw", disabled: false, customClaims: { role: "STUDENT" } });
  h.auth.users.set("u4", { uid: "u4", email: "r4@students.internal", password: "pw", disabled: false, customClaims: { role: "STUDENT" } });
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
}

beforeEach(() => {
  seed();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const audits = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d);

describe("DELETE /students/[id] - permanent, complete, no archive", () => {
  it("deletes the student completely: record, history, login (Auth + profiles) and roll registry entry - and keeps NO copy", async () => {
    const res = await deleteStudent(req(), params("s1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
    expect([...h.db.docs.keys()].filter((k) => k.startsWith(`${C}/students/s1/`))).toEqual([]); // departmentHistory
    expect(h.auth.users.has("u1")).toBe(false); // the Firebase Auth login is gone, not disabled
    expect(h.db.get(`${C}/users/u1`)).toBeUndefined();
    expect(h.db.get("systemUsers/u1")).toBeUndefined();
    expect(h.db.get("studentUsernames/R1")).toBeUndefined(); // the roll is free again

    // Nothing archived, anywhere.
    expect([...h.db.docs.keys()].filter((k) => /archived/i.test(k))).toEqual([]);
    // ...and no leftover document holds the student's personal data.
    const everything = JSON.stringify([...h.db.docs.entries()]);
    expect(everything).not.toContain("r1@students.internal");
    expect(everything).not.toContain('"name":"Anil"');
  });

  it("the other students and everyone else's records are untouched", async () => {
    await deleteStudent(req(), params("s1"));
    expect(h.db.get(`${C}/students/s2`)).toBeDefined();
    expect(h.db.get(`${C}/students/s4`)).toBeDefined();
    expect(h.db.get(`${C}/users/u4`)).toBeDefined();
    expect(h.db.get("studentUsernames/R4")).toBeDefined();
    expect(h.auth.users.has("u4")).toBe(true);
  });

  it("a student with no login is deleted too (no Auth call), and a library book out no longer blocks it", async () => {
    h.db.docs.set(`${C}/bookLoans/l1`, { studentId: "s2", status: "ACTIVE" });
    h.db.docs.set("studentUsernames/R2", { collegeId: "c1", studentDocId: "s2", active: true, createdAt: new Date() });
    const res = await deleteStudent(req(), params("s2"));
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toBeUndefined();
    expect(h.db.get("studentUsernames/R2")).toBeUndefined();
    expect(h.auth.calls.filter((c) => c.fn === "deleteUser")).toHaveLength(0);
  });

  it("records OTHER modules keep (attendance, library history) are not rewritten by this delete", async () => {
    h.db.docs.set(`${C}/studentAttendance/a1`, { entries: [{ studentId: "s1", status: "PRESENT" }] });
    h.db.docs.set(`${C}/bookLoans/l9`, { studentId: "s1", status: "RETURNED" });
    await deleteStudent(req(), params("s1"));
    expect(h.db.get(`${C}/studentAttendance/a1`)).toEqual({ entries: [{ studentId: "s1", status: "PRESENT" }] });
    expect(h.db.get(`${C}/bookLoans/l9`)).toBeDefined();
  });

  it("never takes a STAFF profile with it, even if a uid were shared", async () => {
    h.db.docs.set(`${C}/users/u1`, { uid: "u1", role: "HOD" });
    h.db.docs.set("systemUsers/u1", { uid: "u1", role: "HOD" });
    await deleteStudent(req(), params("s1"));
    expect(h.db.get(`${C}/users/u1`)).toBeDefined();
    expect(h.db.get("systemUsers/u1")).toBeDefined();
    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
  });

  it("another student's registry entry for the same roll is never removed", async () => {
    h.db.docs.set("studentUsernames/R1", { collegeId: "c2", studentDocId: "other", name: "Not Mine", active: true, createdAt: new Date() });
    await deleteStudent(req(), params("s1"));
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ studentDocId: "other" });
  });

  it("if the login cannot be deleted NOTHING is deleted (500), and a retry then completes", async () => {
    h.auth.failNext.deleteUser = new Error("auth hiccup");
    const res = await deleteStudent(req(), params("s1"));
    expect(res.status).toBe(500);
    expect(h.db.get(`${C}/students/s1`)).toBeDefined();
    expect(h.db.get("studentUsernames/R1")).toBeDefined();
    expect(h.auth.users.has("u1")).toBe(true);

    expect((await deleteStudent(req(), params("s1"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
    expect(h.auth.users.has("u1")).toBe(false);
  });

  it("an Auth user that is already gone does not stop the delete", async () => {
    h.auth.users.delete("u1");
    expect((await deleteStudent(req(), params("s1"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
  });

  it("404 for an unknown student", async () => {
    expect((await deleteStudent(req(), params("nope"))).status).toBe(404);
  });

  it("the faculty member IN CHARGE of the student's section can delete (as before); another faculty member cannot", async () => {
    h.db.docs.set(`${C}/sections/y2A`, { ...h.db.get(`${C}/sections/y2A`)!, facultyInchargeUid: "t1" });
    h.session = { collegeId: "c1", uid: "t2", role: "PANEL_MEMBER" };
    expect((await deleteStudent(req(), params("s1"))).status).toBe(403);
    expect(h.db.get(`${C}/students/s1`)).toBeDefined();

    h.session = { collegeId: "c1", uid: "t1", role: "PANEL_MEMBER" };
    expect((await deleteStudent(req(), params("s1"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toBeUndefined();
  });

  it("an HOD, the Principal and the College Office can delete; other roles and no session cannot", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await deleteStudent(req(), params("s1"))).status).toBe(200);
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await deleteStudent(req(), params("s2"))).status).toBe(200);
    h.session = { collegeId: "c1", uid: "o1", role: "COLLEGE_OFFICE" };
    expect((await deleteStudent(req(), params("s4"))).status).toBe(200);

    h.session = { collegeId: "c1", uid: "lib1", role: "LIBRARY" };
    expect((await deleteStudent(req(), params("s4"))).status).toBe(401);
    h.session = null;
    expect((await deleteStudent(req(), params("s4"))).status).toBe(401);
  });
});

describe("PATCH /students/[id] (S4)", () => {
  beforeEach(() => { h.session = { collegeId: "c1", uid: "hod1", role: "HOD" }; });

  it("changing the roll moves the whole login identity: registry, Auth email, profile emails; the old roll is retired; the password survives", async () => {
    const res = await patchStudent(req({ rollNumber: "R1-NEW" }), params("s1"));
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1-NEW", rollNumberUpper: "R1-NEW", loginEmail: "r1new@students.internal" });
    expect(h.db.get("studentUsernames/R1NEW")).toMatchObject({ uid: "u1", active: true, collegeId: "c1", studentDocId: "s1", loginEmail: "r1new@students.internal" });
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(h.auth.users.get("u1")).toMatchObject({ email: "r1new@students.internal", password: "pw" });
    expect(h.db.get(`${C}/users/u1`)?.email).toBe("r1new@students.internal");
    expect(audits().some((a) => a.action === "STUDENT_ROLL_CHANGED")).toBe(true);
  });

  it("refuses a roll another student already holds (case-insensitively) and changes nothing", async () => {
    const res = await patchStudent(req({ rollNumber: "r2" }), params("s1"));
    expect(res.status).toBe(400);
    expect(h.db.get(`${C}/students/s1`)?.rollNumber).toBe("R1");
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: true });
  });

  it("refuses a roll held by a student of ANOTHER college (any formatting), without naming them, and changes nothing", async () => {
    h.db.docs.set("colleges/c2/students/other", { name: "Other College Student", rollNumber: "R9" });
    h.db.docs.set("studentUsernames/R9", { collegeId: "c2", studentDocId: "other", name: "Other College Student", active: true, createdAt: new Date() });
    const res = await patchStudent(req({ rollNumber: "R-9" }), params("s1"));
    expect(res.status).toBe(400);
    const err = (await res.json()).error as string;
    expect(err).toMatch(/another college/);
    expect(err).not.toContain("Other College Student");
    expect(h.db.get(`${C}/students/s1`)?.rollNumber).toBe("R1");
    expect(h.auth.users.get("u1")?.email).toBe("r1@students.internal");
  });

  it("a roll can never be blanked", async () => {
    expect((await patchStudent(req({ rollNumber: "  " }), params("s1"))).status).toBe(400);
  });

  it("a student without a login changes roll: the registry follows, no login is touched", async () => {
    expect((await patchStudent(req({ rollNumber: "R2-NEW" }), params("s2"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ rollNumber: "R2-NEW", rollNumberUpper: "R2-NEW" });
    expect(h.db.get("studentUsernames/R2NEW")).toMatchObject({ collegeId: "c1", studentDocId: "s2", active: true });
    expect(h.db.get("studentUsernames/R2NEW")).not.toHaveProperty("uid");
    expect(h.auth.calls).toHaveLength(0);
  });

  it("re-sending the unchanged roll with a lab-batch edit does not trip the uniqueness rule", async () => {
    const res = await patchStudent(req({ rollNumber: "R1", labBatch: " B2 " }), params("s1"));
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", labBatch: "B2" });
  });

  it("GRADUATED cannot be set by a bare status flip (it must go through Promotion > Graduate)", async () => {
    const res = await patchStudent(req({ status: "GRADUATED" }), params("s1"));
    expect(res.status).toBe(400);
    expect(h.db.get(`${C}/students/s1`)?.status).toBe("REGULAR");
  });

  it("an invalid status is rejected", async () => {
    expect((await patchStudent(req({ status: "WHATEVER" }), params("s1"))).status).toBe(400);
  });

  it("DETAINED is allowed and audited", async () => {
    expect((await patchStudent(req({ status: "DETAINED" }), params("s1"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)?.status).toBe("DETAINED");
    expect(audits().some((a) => a.action === "STUDENT_STATUS_CHANGED")).toBe(true);
  });

  it("undoing a graduation is the Principal's call: it drops the graduation snapshot and re-enables the login", async () => {
    h.db.docs.set(`${C}/students/s1`, { ...h.db.get(`${C}/students/s1`)!, status: "GRADUATED", graduatedAt: new Date(), graduationBatch: "2022-26", graduationCourseId: "course1", graduationCourseName: "BTech" });
    h.auth.users.get("u1")!.disabled = true;
    h.db.docs.set(`${C}/users/u1`, { uid: "u1", isActive: false, role: "STUDENT" });

    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await patchStudent(req({ status: "REGULAR" }), params("s1"))).status).toBe(403); // HOD cannot

    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL" };
    expect((await patchStudent(req({ status: "REGULAR" }), params("s1"))).status).toBe(200);
    const s = h.db.get(`${C}/students/s1`)!;
    expect(s.status).toBe("REGULAR");
    for (const k of ["graduatedAt", "graduationBatch", "graduationCourseId", "graduationCourseName"]) expect(s).not.toHaveProperty(k);
    expect(h.auth.users.get("u1")?.disabled).toBe(false);
    expect(h.db.get(`${C}/users/u1`)?.isActive).toBe(true);
    expect(h.db.get("studentUsernames/R1")?.active).toBe(true);
    expect(audits().some((a) => a.action === "STUDENT_GRADUATION_UNDONE")).toBe(true);
  });

  it("unassigning clears the lab batch with the section; moving to another section clears it too (no stale batch)", async () => {
    expect((await patchStudent(req({ unassign: true }), params("s1"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ section: "", labBatch: "" });

    h.db.docs.set(`${C}/students/s2`, { ...h.db.get(`${C}/students/s2`)!, labBatch: "B7" });
    h.db.docs.set(`${C}/sections/y2B`, { name: "B", year: 2, department: "CSE", courseId: "course1", courseName: "BTech" });
    expect((await patchStudent(req({ targetSectionId: "y2B" }), params("s2"))).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ section: "B", labBatch: "" });
  });
});

describe("POST /students/promote (S6)", () => {
  beforeEach(() => { h.session = { collegeId: "c1", uid: "office1", role: "PRINCIPAL" }; });

  it("promotes exactly one year within the programme, clears the lab batch, records history", async () => {
    const res = await promote(req({ studentIds: ["s1"], action: "PROMOTE", targetSectionId: "y3A", sourceSectionId: "y2A" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, updatedCount: 1, loginDeactivationFailures: 0 });
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ year: 3, section: "A", labBatch: "", courseId: "course1" });
    expect([...h.db.docs.keys()].some((k) => k.startsWith(`${C}/students/s1/departmentHistory/`))).toBe(true);
  });

  it("refuses to skip a year - the student is left exactly as they were", async () => {
    const res = await promote(req({ studentIds: ["s1"], action: "PROMOTE", targetSectionId: "y4A" }));
    expect(res.status).toBe(400);
    expect((await res.json()).skippedReasons[0].reason).toMatch(/can only be promoted/);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ year: 2, section: "A" });
  });

  it("refuses a different programme", async () => {
    const res = await promote(req({ studentIds: ["s1"], action: "PROMOTE", targetSectionId: "mba1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).skippedReasons[0].reason).toMatch(/different programme/);
  });

  it("skips a student who is not in the source section, while promoting the ones who are", async () => {
    h.db.docs.set(`${C}/students/s3`, { name: "Stray", rollNumber: "R3", status: "REGULAR", department: "CSE", year: 2, section: "B", courseId: "course1" });
    const res = await promote(req({ studentIds: ["s1", "s3"], action: "PROMOTE", targetSectionId: "y3A", sourceSectionId: "y2A" }));
    const body = await res.json();
    expect(body.updatedCount).toBe(1);
    expect(body.skipped).toEqual(["s3"]);
    expect(h.db.get(`${C}/students/s3`)?.year).toBe(2);
  });

  it("a non-REGULAR student is never promoted", async () => {
    h.db.docs.set(`${C}/students/s1`, { ...h.db.get(`${C}/students/s1`)!, status: "DETAINED" });
    const res = await promote(req({ studentIds: ["s1"], action: "PROMOTE", targetSectionId: "y3A" }));
    expect(res.status).toBe(400);
    expect(h.db.get(`${C}/students/s1`)?.year).toBe(2);
  });

  it("graduating a final-year student records the snapshot and DISABLES (not deletes) the login", async () => {
    const res = await promote(req({ studentIds: ["s4"], action: "GRADUATE", sourceSectionId: "y4A" }));
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s4`)).toMatchObject({ status: "GRADUATED", graduationBatch: "2022-26", graduationCourseId: "course1" });
    expect(h.auth.users.get("u4")?.disabled).toBe(true);
    expect(h.db.get(`${C}/users/u4`)?.isActive).toBe(false);
    // A graduate still holds their roll number: the registry entry stays active.
    expect(h.db.get("studentUsernames/R4")?.active).toBe(true);
    expect(h.auth.calls.some((c) => c.fn === "deleteUser")).toBe(false);
  });

  it("refuses to graduate a student who is not in the final year", async () => {
    const res = await promote(req({ studentIds: ["s1"], action: "GRADUATE", sourceSectionId: "y2A" }));
    expect(res.status).toBe(400);
    expect((await res.json()).skippedReasons[0].reason).toMatch(/not the final year/);
    expect(h.db.get(`${C}/students/s1`)?.status).toBe("REGULAR");
    expect(h.auth.users.get("u1")?.disabled).toBe(false);
  });

  it("a login that fails to disable does not undo the graduation; the failure is reported", async () => {
    h.auth.failNext.updateUser = new Error("auth down");
    const res = await promote(req({ studentIds: ["s4"], action: "GRADUATE", sourceSectionId: "y4A" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updatedCount: 1, loginDeactivationFailures: 1 });
    expect(h.db.get(`${C}/students/s4`)?.status).toBe("GRADUATED");
  });

  it("input validation: empty list, bad action, missing target, too many", async () => {
    expect((await promote(req({ studentIds: [], action: "PROMOTE" }))).status).toBe(400);
    expect((await promote(req({ studentIds: ["s1"], action: "NOPE" }))).status).toBe(400);
    expect((await promote(req({ studentIds: ["s1"], action: "PROMOTE" }))).status).toBe(400);
    expect((await promote(req({ studentIds: Array.from({ length: 401 }, (_, i) => `x${i}`), action: "GRADUATE" }))).status).toBe(400);
  });

  it("HOD cannot promote (office tier only)", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await promote(req({ studentIds: ["s1"], action: "PROMOTE", targetSectionId: "y3A" }))).status).toBe(401);
  });
});
