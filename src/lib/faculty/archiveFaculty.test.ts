import { describe, it, expect } from "vitest";
import { fakeAuth, fakeFs } from "@/lib/testing/fakeFirestore.testutil";
import { archiveFaculty, archivedFacultyEmail } from "@/lib/faculty/archiveFaculty";

const actor = { uid: "hod1", name: "HOD" };

function setup(extra: Record<string, Record<string, unknown>> = {}) {
  const fs = fakeFs({
    "colleges/c1/facultyMembers/f1": { legalName: "Dr Rao", employeeId: "EMP0001", collegeEmail: "rao@vit.edu", userUid: "u1", department: "CSE" },
    "colleges/c1/users/u1": { uid: "u1", role: "PANEL_MEMBER", name: "Dr Rao" },
    "systemUsers/u1": { uid: "u1", role: "PANEL_MEMBER", collegeId: "c1" },
    ...extra,
  });
  const au = fakeAuth();
  au.auth.users.set("u1", { uid: "u1", email: "rao@vit.edu", password: "p", disabled: false, customClaims: {} });
  return { ...fs, ...au };
}

describe("archiveFaculty (F1)", () => {
  it("archives the record with its login documents, disables the login and frees the email", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    expect(await archiveFaculty(firestore, adminAuth, "c1", "f1", actor, "REMOVED_BY_USER")).toEqual({ ok: true });

    const archived = db.get("colleges/c1/archivedFacultyMembers/f1")!;
    expect(archived).toMatchObject({ legalName: "Dr Rao", employeeId: "EMP0001", archivedBy: "hod1" });
    expect(archived.archivedLogin).toMatchObject({ uid: "u1", loginEmail: "rao@vit.edu" });
    expect((archived.archivedLogin as { userDoc: unknown }).userDoc).toMatchObject({ role: "PANEL_MEMBER" });
    expect((archived.archivedLogin as { systemUserDoc: unknown }).systemUserDoc).toMatchObject({ collegeId: "c1" });

    expect(db.get("colleges/c1/facultyMembers/f1")).toBeUndefined();
    expect(db.get("colleges/c1/users/u1")).toBeUndefined();
    expect(db.get("systemUsers/u1")).toBeUndefined();
    expect(auth.users.get("u1")).toMatchObject({ disabled: true, email: archivedFacultyEmail("u1") });
    expect(auth.calls.some((c) => c.fn === "deleteUser")).toBe(false); // restorable, not destroyed
  });

  const blocked = async (extra: Record<string, Record<string, unknown>>, blocker: string) => {
    const { db, firestore, adminAuth, auth } = setup(extra);
    const res = await archiveFaculty(firestore, adminAuth, "c1", "f1", actor, "x");
    expect(res).toMatchObject({ ok: false, code: "BLOCKED", blocker });
    // A refusal changes nothing.
    expect(db.get("colleges/c1/facultyMembers/f1")).toBeDefined();
    expect(db.get("colleges/c1/users/u1")).toBeDefined();
    expect(db.get("colleges/c1/archivedFacultyMembers/f1")).toBeUndefined();
    expect(auth.users.get("u1")?.disabled).toBe(false);
  };

  it("is refused while they still have a teaching assignment", () => blocked({ "colleges/c1/teachingAssignments/t1": { facultyId: "f1" } }, "ASSIGNMENTS"));
  it("is refused while they still have a timetable slot", () => blocked({ "colleges/c1/timetableSlots/s1": { facultyId: "f1" } }, "ASSIGNMENTS"));
  it("is refused while they hold a role seat", () => blocked({ "colleges/c1/roleSeats/seat1": { holderUid: "u1", role: "HOD" } }, "ROLE_SEAT"));
  it("is refused while they are a section's in-charge (login uid)", () => blocked({ "colleges/c1/sections/sec1": { facultyInchargeUid: "u1" } }, "SECTION_INCHARGE"));
  it("is refused while they are a section's in-charge (the historical faculty-id form)", () => blocked({ "colleges/c1/sections/sec1": { facultyInchargeUid: "f1" } }, "SECTION_INCHARGE"));
  it("is refused while they are a timetable in-charge", () => blocked({ "colleges/c1/timetableIncharges/c_year1": { uid: "u1" } }, "TIMETABLE_INCHARGE"));

  it("someone else's assignments or seat do not block", async () => {
    const { firestore, adminAuth } = setup({
      "colleges/c1/teachingAssignments/t1": { facultyId: "other" },
      "colleges/c1/roleSeats/seat1": { holderUid: "otherUid" },
      "colleges/c1/sections/sec1": { facultyInchargeUid: "otherUid" },
    });
    expect(await archiveFaculty(firestore, adminAuth, "c1", "f1", actor, "x")).toEqual({ ok: true });
  });

  it("a faculty member with no login archives cleanly", async () => {
    const { db, firestore, adminAuth, auth } = setup({ "colleges/c1/facultyMembers/f2": { legalName: "No Login", employeeId: "EMP0002" } });
    expect(await archiveFaculty(firestore, adminAuth, "c1", "f2", actor, "x")).toEqual({ ok: true });
    expect(db.get("colleges/c1/archivedFacultyMembers/f2")?.archivedLogin).toBeNull();
    expect(auth.calls).toHaveLength(0);
  });

  it("unknown id -> NOT_FOUND", async () => {
    const { firestore, adminAuth } = setup();
    expect(await archiveFaculty(firestore, adminAuth, "c1", "nope", actor, "x")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("a failure while disabling the login leaves the live records intact and the retry completes", async () => {
    const { db, firestore, adminAuth, auth } = setup();
    auth.failNext.updateUser = new Error("auth hiccup");
    await expect(archiveFaculty(firestore, adminAuth, "c1", "f1", actor, "x")).rejects.toThrow("auth hiccup");
    expect(db.get("colleges/c1/facultyMembers/f1")).toBeDefined();
    expect(db.get("colleges/c1/users/u1")).toBeDefined();
    expect(await archiveFaculty(firestore, adminAuth, "c1", "f1", actor, "x")).toEqual({ ok: true });
    expect(db.get("colleges/c1/facultyMembers/f1")).toBeUndefined();
  });
});
