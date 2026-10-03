import { describe, it, expect } from "vitest";
import { fakeAuth, fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { archiveStudent, archivedLoginEmail } from "@/lib/students/archiveStudent";

const actor = { uid: "office1", name: "Office" };

function setup(extra: Record<string, Record<string, unknown>> = {}) {
  const fs = fakeFs({
    "colleges/c1/students/s1": { name: "Anil", rollNumber: "R1", status: "REGULAR", department: "CSE", year: 2, section: "A", uid: "u1", loginEmail: "r1.c1@students.internal" },
    "colleges/c1/students/s1/departmentHistory/h1": { department: "CSE", section: "A", year: 2 },
    "colleges/c1/students/s1/departmentHistory/h2": { department: "CSE", section: "", year: 1 },
    "colleges/c1/users/u1": { uid: "u1", isActive: true, role: "STUDENT" },
    "studentUsernames/R1": { uid: "u1", collegeId: "c1", studentDocId: "s1", loginEmail: "r1.c1@students.internal", active: true },
    ...extra,
  });
  const au = fakeAuth();
  au.auth.users.set("u1", { uid: "u1", email: "r1.c1@students.internal", password: "pw", disabled: false, customClaims: { role: "STUDENT" } });
  return { ...fs, ...au };
}

describe("archiveStudent (S5)", () => {
  it("keeps the whole record, with its history, in archivedStudents and removes it from the live roster", async () => {
    const { db, firestore, adminAuth } = setup();
    const res = await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "REMOVED_BY_USER");
    expect(res).toEqual({ ok: true });

    const archived = db.get("colleges/c1/archivedStudents/s1")!;
    expect(archived).toMatchObject({ name: "Anil", rollNumber: "R1", archivedBy: "office1", archivedByName: "Office", archiveReason: "REMOVED_BY_USER" });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((archived.departmentHistory as unknown[]).length).toBe(2);
    expect(archived.archivedLogin).toEqual({ uid: "u1", loginEmail: "r1.c1@students.internal" });

    expect(db.get("colleges/c1/students/s1")).toBeUndefined();
    expect(db.get("colleges/c1/students/s1/departmentHistory/h1")).toBeUndefined();
  });

  it("disables the login, frees its email, and switches the profile and lookups off - deleting none of them", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x");
    const u = auth.users.get("u1")!;
    expect(u.disabled).toBe(true);
    expect(u.email).toBe(archivedLoginEmail("u1"));
    expect(u.email).not.toBe("r1.c1@students.internal"); // the real identity is free for a re-admission
    expect(db.get("colleges/c1/users/u1")).toMatchObject({ isActive: false });
    expect(db.get("studentUsernames/R1")).toMatchObject({ active: false });
    expect(auth.calls.some((c) => c.fn === "deleteUser")).toBe(false);
  });

  it("retires the roll's registry entry so the number can be re-admitted - even in another college", async () => {
    const { db, firestore, adminAuth } = setup();
    await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x");
    const { claimStudentRoll } = await import("@/lib/students/rollIdentity");
    expect(await claimStudentRoll(firestore, { roll: "R1", collegeId: "c2", studentDocId: "new1", name: "Returning" })).toEqual({ ok: true, created: true });
    expect(db.get("studentUsernames/R1")).toMatchObject({ active: true, collegeId: "c2", studentDocId: "new1" });
  });

  it("a student with no login still retires their roll", async () => {
    const { db, firestore, adminAuth } = setup({
      "colleges/c1/students/s3": { name: "No Login", rollNumber: "R3", status: "REGULAR" },
      "studentUsernames/R3": { collegeId: "c1", studentDocId: "s3", active: true },
    });
    await archiveStudent(firestore, adminAuth, "c1", "s3", actor, "x");
    expect(db.get("studentUsernames/R3")).toMatchObject({ active: false });
  });

  it("refuses a student who still holds a library book, changing nothing at all", async () => {
    const { db, firestore, adminAuth, auth } = setup({ "colleges/c1/bookLoans/l1": { studentId: "s1", status: "OVERDUE" } });
    const res = await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x");
    expect(res).toMatchObject({ ok: false, code: "ACTIVE_LOANS" });
    expect(db.get("colleges/c1/students/s1")).toBeDefined();
    expect(db.get("colleges/c1/archivedStudents/s1")).toBeUndefined();
    expect(auth.users.get("u1")?.disabled).toBe(false);
  });

  it("a returned book does not block; open reservations are cancelled, not deleted", async () => {
    const { db, firestore, adminAuth } = setup({
      "colleges/c1/bookLoans/l1": { studentId: "s1", status: "RETURNED" },
      "colleges/c1/bookReservations/r1": { studentId: "s1", status: "WAITING" },
      "colleges/c1/bookReservations/r2": { studentId: "s1", status: "FULFILLED" },
    });
    expect(await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x")).toEqual({ ok: true });
    expect(db.get("colleges/c1/bookReservations/r1")?.status).toBe("CANCELLED");
    expect(db.get("colleges/c1/bookReservations/r2")?.status).toBe("FULFILLED");
  });

  it("leaves attendance, marks and uploaded documents untouched", async () => {
    const { db, firestore, adminAuth } = setup({
      "colleges/c1/studentAttendance/a1": { entries: [{ studentId: "s1", status: "PRESENT" }] },
      "colleges/c1/studentDocuments/d1": { studentId: "s1", type: "CERT" },
    });
    await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x");
    expect(db.get("colleges/c1/studentAttendance/a1")).toBeDefined();
    expect(db.get("colleges/c1/studentDocuments/d1")).toBeDefined();
  });

  it("a student with no login archives without touching Auth", async () => {
    const { db, firestore, adminAuth, auth } = setup({ "colleges/c1/students/s2": { name: "No Login", rollNumber: "R2", status: "REGULAR" } });
    expect(await archiveStudent(firestore, adminAuth, "c1", "s2", actor, "x")).toEqual({ ok: true });
    expect(db.get("colleges/c1/archivedStudents/s2")?.archivedLogin).toBeNull();
    expect(auth.calls).toHaveLength(0);
  });

  it("unknown student -> NOT_FOUND", async () => {
    const { firestore, adminAuth } = setup();
    expect(await archiveStudent(firestore, adminAuth, "c1", "nope", actor, "x")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is safe to run again after a failure part-way (Auth failed: the live student is still there, and a retry completes)", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    auth.failNext.updateUser = new Error("auth hiccup");
    await expect(archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x")).rejects.toThrow("auth hiccup");
    expect(db.get("colleges/c1/students/s1")).toBeDefined(); // nothing live was removed
    expect(db.get("colleges/c1/archivedStudents/s1")).toBeDefined(); // the copy exists already

    expect(await archiveStudent(firestore, adminAuth, "c1", "s1", actor, "x")).toEqual({ ok: true });
    expect(db.get("colleges/c1/students/s1")).toBeUndefined();
    expect(auth.users.get("u1")?.disabled).toBe(true);
  });
});
