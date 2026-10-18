import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuth, FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

// The Edit Student save (PATCH students/[id] with `details`): the name reaches every copy of it, a changed course
// moves its Course record with it, nothing sent is dropped without a word, and a refusal names every problem and writes
// nothing. Real route against in-memory fakes only.

const h = vi.hoisted(() => ({
  db: null as unknown as FakeFirestore,
  auth: null as unknown as FakeAuth,
  session: null as null | { collegeId: string; uid: string; role: string; roles?: string[] },
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
const audits = () => [...h.db.docs.entries()].filter(([p]) => p.startsWith(`${C}/auditLogs/`)).map(([, d]) => d);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.auth = new FakeAuth();
  h.auth.users.set("u1", { uid: "u1", email: "r1@students.internal", password: "pw-keep-1", displayName: "Anil", disabled: false, customClaims: { role: "STUDENT" } });
  h.session = { collegeId: "c1", uid: "office1", role: "COLLEGE_OFFICE" };
  h.db = new FakeFirestore({
    [`${C}/users/office1`]: { name: "Office" },
    // Departments and courses: CSE offers BTech + MTech; a sub-department of it offers its parent's; ME offers BPharm only.
    [`${C}/departments/d-cse`]: { name: "CSE", hasSubDepartments: true },
    [`${C}/departments/d-cs`]: { name: "CSE-CS", parentDepartmentId: "d-cse" },
    [`${C}/departments/d-me`]: { name: "ME" },
    [`${C}/courses/course1`]: { name: "BTech", code: "BTECH", departmentId: "d-cse", catalogId: "btech", durationYears: 4 },
    [`${C}/courses/course2`]: { name: "MTech", code: "MTECH", departmentId: "d-cse", catalogId: "mtech", durationYears: 2 },
    [`${C}/courses/course3`]: { name: "BPharm", code: "BPHARM", departmentId: "d-me", catalogId: "bpharm", durationYears: 4 },
    // s1: in section A, has a login. s2: unassigned, no login. s4: unassigned, in the sub-department.
    [`${C}/students/s1`]: { name: "Anil", rollNumber: "R1", rollNumberUpper: "R1", status: "REGULAR", department: "CSE", year: 2, section: "A", course: "BTech", courseId: "course1", uid: "u1", loginEmail: "r1@students.internal", mobileNo: "9000000000" },
    [`${C}/students/s2`]: { name: "Bala", rollNumber: "R2", rollNumberUpper: "R2", status: "REGULAR", department: "CSE", year: 2, section: "", course: "BTech", courseId: "course1", mobileNo: "9000000001" },
    [`${C}/students/s4`]: { name: "Charan", rollNumber: "R4", rollNumberUpper: "R4", status: "REGULAR", department: "CSE-CS", year: 2, section: "", course: "BTech", courseId: "course1", mobileNo: "9000000004" },
    [`${C}/users/u1`]: { uid: "u1", role: "STUDENT", name: "Anil", email: "r1@students.internal" },
    "systemUsers/u1": { uid: "u1", role: "STUDENT", name: "Anil", email: "r1@students.internal" },
    "studentUsernames/R1": { uid: "u1", collegeId: "c1", studentDocId: "s1", name: "Anil", loginEmail: "r1@students.internal", rollKey: "r1", active: true, createdAt: new Date() },
    "studentUsernames/R2": { collegeId: "c1", studentDocId: "s2", name: "Bala", rollKey: "r2", active: true, createdAt: new Date() },
    "colleges/c9": { name: "Other College" },
    "colleges/c9/students/z1": { name: "Other College Zed", rollNumber: "Z9" },
    "studentUsernames/Z9": { collegeId: "c9", studentDocId: "z1", name: "Other College Zed", rollKey: "z9", active: true, createdAt: new Date() },
  });
});

describe("Name is saved - and reaches every copy of it", () => {
  it("updates the student, the login profile, systemUsers, the roll registry and the Auth display name together", async () => {
    const res = await patch("s1", { name: "Anil Kumar", mobileNo: "9000000000" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toContain("name");
    expect(h.db.get(`${C}/students/s1`)?.name).toBe("Anil Kumar");
    expect(h.db.get(`${C}/users/u1`)?.name).toBe("Anil Kumar");
    expect(h.db.get("systemUsers/u1")?.name).toBe("Anil Kumar");
    expect(h.db.get("studentUsernames/R1")?.name).toBe("Anil Kumar");
    expect(h.auth.users.get("u1")?.displayName).toBe("Anil Kumar");
    // Nothing else about the login moved: same email, same password, same roll.
    expect(h.auth.users.get("u1")).toMatchObject({ email: "r1@students.internal", password: "pw-keep-1" });
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1", loginEmail: "r1@students.internal" });
  });

  it("a student with no login: the student and the registry entry change, no Auth call", async () => {
    expect((await patch("s2", { name: "Bala Krishna" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)?.name).toBe("Bala Krishna");
    expect(h.db.get("studentUsernames/R2")?.name).toBe("Bala Krishna");
    expect(h.auth.calls).toHaveLength(0);
  });

  it("the name and a Regd. No change together: one write, the new roll's entry carries the new name, one Auth call", async () => {
    const res = await patch("s1", { name: "Anil Kumar", rollNumber: "R1-NEW" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ name: "Anil Kumar", rollNumber: "R1-NEW", loginEmail: "r1new@students.internal" });
    expect(h.db.get("studentUsernames/R1NEW")).toMatchObject({ name: "Anil Kumar", uid: "u1", active: true });
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(h.db.get(`${C}/users/u1`)).toMatchObject({ name: "Anil Kumar", email: "r1new@students.internal" });
    expect(h.db.get("systemUsers/u1")).toMatchObject({ name: "Anil Kumar", email: "r1new@students.internal" });
    expect(h.auth.users.get("u1")).toMatchObject({ displayName: "Anil Kumar", email: "r1new@students.internal", password: "pw-keep-1" });
    expect(h.auth.calls.filter((c) => c.fn === "updateUser")).toHaveLength(1);
  });

  it("an unchanged name is left alone: no Auth call, other fields still save", async () => {
    const res = await patch("s1", { name: "Anil", gender: "Male" });
    expect(res.status).toBe(200);
    expect(h.auth.calls).toHaveLength(0);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ name: "Anil", gender: "Male" });
  });

  it("a blank name is refused with a reason and nothing at all is written", async () => {
    for (const blank of ["", "   ", null]) {
      const res = await patch("s1", { name: blank, gender: "Male" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.fieldErrors.name).toBe("Name is required");
      expect(body.saved).toEqual([]);
    }
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ name: "Anil" });
    expect(h.db.get(`${C}/students/s1`)?.gender).toBeUndefined();
    expect(h.auth.calls).toHaveLength(0);
  });

  it("a failed Auth update changes nothing anywhere", async () => {
    h.auth.failNext.updateUser = new Error("auth hiccup");
    const res = await patch("s1", { name: "Anil Kumar", gender: "Male" });
    expect(res.status).toBe(500);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ name: "Anil" });
    expect(h.db.get(`${C}/students/s1`)?.gender).toBeUndefined();
    expect(h.db.get(`${C}/users/u1`)?.name).toBe("Anil");
    expect(h.db.get("studentUsernames/R1")?.name).toBe("Anil");
  });

  it("an HOD in scope can correct a name too, and the audit entry records the old and new name", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    expect((await patch("s2", { name: "Bala K" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)?.name).toBe("Bala K");
    const entry = audits().find((a) => a.action === "STUDENT_DETAILS_UPDATED");
    expect(entry?.details).toMatchObject({ nameFrom: "Bala", nameTo: "Bala K" });
  });
});

describe("Course is saved with its Course record", () => {
  it("an unassigned student: the course and courseId change together", async () => {
    const res = await patch("s2", { course: "MTech" });
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toContain("course");
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ course: "MTech", courseId: "course2" });
  });

  it("the course's short code is accepted and stored as the course name", async () => {
    expect((await patch("s2", { course: "mtech" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ course: "MTech", courseId: "course2" });
  });

  it("a sub-department student resolves through the parent department's courses", async () => {
    expect((await patch("s4", { course: "MTech" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s4`)).toMatchObject({ course: "MTech", courseId: "course2" });
  });

  it("a course the department does not offer is refused with the list it does offer, and nothing is written", async () => {
    const res = await patch("s2", { course: "BPharm", gender: "Male" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.course).toMatch(/not a course CSE offers/);
    expect(body.fieldErrors.course).toMatch(/BTech/);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ course: "BTech", courseId: "course1" });
    expect(h.db.get(`${C}/students/s2`)?.gender).toBeUndefined();
  });

  it("a student already in a section keeps that section's course: a different one is refused with the reason", async () => {
    const res = await patch("s1", { course: "MTech" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.course).toMatch(/is in section A, which belongs to BTech/);
    expect(body.fieldErrors.course).toMatch(/follows their section/);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ course: "BTech", courseId: "course1" });
  });

  it("a sectioned student whose label differs may be set to their section's own course (repairs the pair)", async () => {
    h.db.docs.set(`${C}/students/s1`, { ...h.db.get(`${C}/students/s1`)!, course: "B.Tech", courseId: "course1" });
    expect((await patch("s1", { course: "BTECH" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ course: "BTech", courseId: "course1" });
  });

  it("the unchanged course the form re-sends leaves courseId exactly as it was", async () => {
    h.db.docs.set(`${C}/students/s2`, { ...h.db.get(`${C}/students/s2`)!, courseId: "legacy-id" });
    expect((await patch("s2", { course: "BTech", gender: "Male" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ course: "BTech", courseId: "legacy-id", gender: "Male" });
  });

  it("clearing the course is refused", async () => {
    const res = await patch("s2", { course: null, gender: "Male" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.course).toBe("Course is required");
    expect(h.db.get(`${C}/students/s2`)?.course).toBe("BTech");
  });
});

describe("Nothing is dropped without a word", () => {
  it("a Yes/No that is neither is refused, naming the field; nothing is written", async () => {
    const res = await patch("s2", { scholarship: "maybe", gender: "Male" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.scholarship).toBe("Scholarship (Yes/No) must be Yes or No");
    expect(body.rejected).toEqual([expect.objectContaining({ field: "scholarship" })]);
    expect(h.db.get(`${C}/students/s2`)?.gender).toBeUndefined();
  });

  it("every problem is listed at once (the whole save is refused)", async () => {
    const res = await patch("s2", { name: "", scholarship: "maybe", email: "not-an-email", gender: "Robot" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["email", "gender", "name", "scholarship"]);
    expect(body.error).toMatch(/4 fields could not be saved/);
    expect(body.error).toMatch(/Nothing was changed/);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ name: "Bala" });
  });

  it("a number that is not a number, a bad date and a bad handicapped type are refused", async () => {
    const res = await patch("s2", { distanceFromResidenceKm: "far", dateOfBirth: "2004-13-45", handicappedType: "X" });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fieldErrors).sort()).toEqual(["dateOfBirth", "distanceFromResidenceKm", "handicappedType"]);
  });

  it("valid values are stored cleaned: gender as listed, email lower-case, Yes/No as booleans, a custom caste kept", async () => {
    const res = await patch("s2", { gender: "female", email: "Bala@Example.COM", scholarship: "Yes", dateOfBirth: "2004-08-12", caste: "Some Other Caste", distanceFromResidenceKm: "12 km" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ gender: "Female", email: "bala@example.com", scholarship: true, dateOfBirth: "2004-08-12", caste: "Some Other Caste", distanceFromResidenceKm: 12 });
  });

  it("a value an older record holds that would not pass today is NOT a problem while the form just re-sends it", async () => {
    h.db.docs.set(`${C}/students/s2`, { ...h.db.get(`${C}/students/s2`)!, dateOfBirth: "12/08/2004", gender: "male", email: "legacy-no-at" });
    const res = await patch("s2", { dateOfBirth: "12/08/2004", gender: "male", email: "legacy-no-at", fatherName: "Raju" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ dateOfBirth: "12/08/2004", gender: "male", fatherName: "Raju" });
  });

  it("a different Department or Year is refused (moving a student is sectioning / promotion), the same one is fine", async () => {
    const res = await patch("s2", { department: "ME", year: 3 });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).fieldErrors).sort()).toEqual(["department", "year"]);
    expect((await patch("s2", { department: "CSE", year: 2, gender: "Male" })).status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ department: "CSE", year: 2, gender: "Male" });
  });

  it("the answer lists exactly what changed - not what was merely re-sent", async () => {
    const res = await patch("s2", { name: "Bala", gender: "Male", mobileNo: "9000000001", fatherName: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual(["gender"]);
    expect(body.rejected).toEqual([]);
  });

  it("a Regd. No sent by a role that may not change it is reported as ignored; the other fields still save", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD" };
    const res = await patch("s2", { rollNumber: "HACKED-1", gender: "Male" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual(["gender"]);
    expect(body.ignored).toEqual([expect.objectContaining({ field: "rollNumber" })]);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ rollNumber: "R2", gender: "Male" });
  });
});

describe("A College Admin login (College Office account + College Admin seat) edits as the Office", () => {
  // requireRole evaluates such a login as PRINCIPAL (the most senior role the route allows) but lists every role it
  // really holds in `roles` - the Regd. No change used to be dropped for them while every other field saved.
  const collegeAdmin = { collegeId: "c1", uid: "admin1", role: "PRINCIPAL", roles: ["PRINCIPAL", "COLLEGE_OFFICE"] };

  it("a Regd. No change is saved, with the login following it and the name, exactly as for the Office", async () => {
    h.session = collegeAdmin;
    const res = await patch("s1", { rollNumber: "R1-NEW", name: "Anil Kumar", gender: "Male" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual(expect.arrayContaining(["rollNumber", "name", "gender"]));
    expect(body.ignored).toEqual([]);
    expect(h.db.get(`${C}/students/s1`)).toMatchObject({ rollNumber: "R1-NEW", rollNumberUpper: "R1-NEW", name: "Anil Kumar", loginEmail: "r1new@students.internal" });
    expect(h.db.get("studentUsernames/R1NEW")).toMatchObject({ uid: "u1", active: true, name: "Anil Kumar" });
    expect(h.db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(h.auth.users.get("u1")).toMatchObject({ email: "r1new@students.internal", displayName: "Anil Kumar", password: "pw-keep-1" });
    expect(audits().map((a) => a.action)).toEqual(expect.arrayContaining(["STUDENT_ROLL_CHANGED", "STUDENT_DETAILS_UPDATED"]));
  });

  it("gets the same checks: a Regd. No held in another college is refused (naming the college) and nothing is saved", async () => {
    h.session = collegeAdmin;
    const res = await patch("s2", { rollNumber: "z-9", gender: "Male" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.rollNumber).toMatch(/another college \(Other College\)/);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ rollNumber: "R2" });
    expect(h.db.get(`${C}/students/s2`)?.gender).toBeUndefined();
  });

  it("a plain Principal (does not hold the Office role) is still NOT the Office: the roll is left out and reported", async () => {
    h.session = { collegeId: "c1", uid: "p1", role: "PRINCIPAL", roles: ["PRINCIPAL"] };
    const res = await patch("s2", { rollNumber: "HACKED-1", gender: "Male" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toEqual(["gender"]);
    expect(body.ignored).toEqual([expect.objectContaining({ field: "rollNumber" })]);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ rollNumber: "R2", gender: "Male" });
    expect(h.db.get("studentUsernames/HACKED1")).toBeUndefined();
  });

  it("an HOD who also holds a senior seat but not the Office role gains nothing", async () => {
    h.session = { collegeId: "c1", uid: "hod1", role: "HOD", roles: ["HOD", "PANEL_MEMBER"] };
    const res = await patch("s2", { rollNumber: "HACKED-2", gender: "Male" });
    expect(res.status).toBe(200);
    expect(h.db.get(`${C}/students/s2`)?.rollNumber).toBe("R2");
  });
});

describe("A refusal keeps the whole save out", () => {
  it("a Regd. No held in another college names that college (never the student), and nothing else is saved", async () => {
    const res = await patch("s2", { rollNumber: "z-9", name: "Bala Krishna", gender: "Male" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.fieldErrors.rollNumber).toMatch(/another college \(Other College\)/);
    expect(body.fieldErrors.rollNumber).not.toContain("Zed");
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ name: "Bala", rollNumber: "R2" });
    expect(h.db.get(`${C}/students/s2`)?.gender).toBeUndefined();
    expect(h.db.get("studentUsernames/R2")?.name).toBe("Bala");
  });

  it("a Regd. No problem and a field problem are reported together", async () => {
    const res = await patch("s2", { rollNumber: "r-1", scholarship: "maybe" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["rollNumber", "scholarship"]);
    expect(body.fieldErrors.rollNumber).toContain("Anil");
  });

  it("a mobile number another student holds is refused (409) naming the field, and nothing is saved", async () => {
    const res = await patch("s2", { mobileNo: "9000000000", name: "Bala Krishna" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.fieldErrors.mobileNo).toMatch(/already used by another student/);
    expect(body.saved).toEqual([]);
    expect(h.db.get(`${C}/students/s2`)).toMatchObject({ name: "Bala", mobileNo: "9000000001" });
  });

  it("a Core Department the department does not cross-list to is refused on the Core Department field", async () => {
    const res = await patch("s2", { secondaryDepartment: "ME", gender: "Male" });
    expect(res.status).toBe(400);
    expect((await res.json()).fieldErrors.secondaryDepartment).toMatch(/does not cross-list to "ME"/);
    expect(h.db.get(`${C}/students/s2`)?.gender).toBeUndefined();
  });

  it("an empty request is still 'No editable fields provided', an unknown student still 404, a role outside the list still refused", async () => {
    expect((await patch("s2", {})).status).toBe(400);
    expect((await patch("nope", { gender: "Male" })).status).toBe(404);
    h.session = { collegeId: "c1", uid: "lib1", role: "LIBRARY" };
    expect((await patch("s2", { gender: "Male" })).status).toBe(401);
  });
});
