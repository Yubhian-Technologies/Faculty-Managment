import { describe, expect, it } from "vitest";
import { buildStudentSelfUpdate, STUDENT_SELF_EDITABLE_KEYS, STUDENT_SELF_EDIT_GROUPS, studentMobileSelfEditable } from "./selfEdit";
import type { StudentRecord } from "@/types";

const student = (over: Partial<StudentRecord> = {}): Partial<StudentRecord> => ({
  name: "ASHA", rollNumber: "24A001", mobileNo: "9876500001", fatherName: "RAMU", email: "asha@x.test", ...over,
});
const ok = (r: ReturnType<typeof buildStudentSelfUpdate>) => { if (!r.ok) throw new Error(`${r.status} ${r.error}`); return r; };

describe("what a student may edit", () => {
  it("never includes identity / academic / office-managed fields", () => {
    for (const k of ["rollNumber", "name", "course", "department", "secondaryDepartment", "year", "section", "batch", "regulation", "status", "studentType",
      "admissionNo", "hallTicketNo", "dateOfAdmission", "dateOfJoining", "admissionType", "entranceType", "entranceRank", "jeeRank", "jeePercentage", "scholarship",
      "lastAttendedInstitution", "gender", "dateOfBirth", "caste", "subCaste", "religion", "aadharNo", "rationCardNo", "remarks", "uid", "loginEmail", "profilePhotoUrl"]) {
      expect(STUDENT_SELF_EDITABLE_KEYS, k).not.toContain(k);
    }
  });
  it("every editable key sits in exactly one form section", () => {
    const inGroups = STUDENT_SELF_EDIT_GROUPS.flatMap((g) => g.keys);
    expect([...inGroups].sort()).toEqual([...STUDENT_SELF_EDITABLE_KEYS].sort());
  });
});

describe("buildStudentSelfUpdate", () => {
  it("refuses any non-editable field (403) and names it", () => {
    for (const body of [{ rollNumber: "X1" }, { name: "Hacker" }, { department: "CSE" }, { aadharNo: "123412341234" }, { remarks: "x" }, { fatherName: "A", year: 3 }]) {
      const r = buildStudentSelfUpdate(student(), body);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.status).toBe(403); expect(r.code).toBe("FIELD_NOT_EDITABLE"); }
    }
  });
  it("rejects missing / empty details", () => {
    expect(buildStudentSelfUpdate(student(), undefined).ok).toBe(false);
    expect(buildStudentSelfUpdate(student(), {}).ok).toBe(false);
    expect(buildStudentSelfUpdate(student(), [1]).ok).toBe(false);
  });
  it("returns only what actually changes - an unchanged value is skipped", () => {
    const r = ok(buildStudentSelfUpdate(student(), { fatherName: "RAMU", motherName: "SITA", email: "ASHA@x.test" }));
    expect(r.updates).toEqual({ motherName: "SITA" });
  });
  it("a no-op edit is ok with nothing to write", () => {
    expect(ok(buildStudentSelfUpdate(student(), { fatherName: "RAMU" })).updates).toEqual({});
  });
  it("blank clears an optional field as null; clearing something not stored is a no-op", () => {
    expect(ok(buildStudentSelfUpdate(student(), { fatherName: "  ", guardianName: "" })).updates).toEqual({ fatherName: null });
  });
  it("normalises: phones to 10 digits, email lower-case, IFSC upper-case, account digits only", () => {
    const r = ok(buildStudentSelfUpdate(student(), { fatherContactNo: "+91 98765-43210", email: "New@X.Test", ifscCode: "sbin0001234", bankAccountNo: "1234 5678-9012" }));
    expect(r.updates).toMatchObject({ fatherContactNo: "9876543210", email: "new@x.test", ifscCode: "SBIN0001234", bankAccountNo: "123456789012" });
  });
  it("rejects bad phone, email, IFSC, account, distance, land line, over-long text", () => {
    const bad: Record<string, unknown>[] = [
      { fatherContactNo: "12345" }, { motherContactNo: "5876543210" }, { guardianContact: "abc" }, { email: "nope" },
      { ifscCode: "ABC" }, { bankAccountNo: "12" }, { distanceFromResidenceKm: "-3" }, { distanceFromResidenceKm: "far" },
      { landLineNo: "x" }, { temporaryAddress: "a".repeat(501) }, { fatherName: "a".repeat(201) }, { handicappedType: "Z" },
    ];
    for (const b of bad) { const r = buildStudentSelfUpdate(student(), b); expect(r.ok, JSON.stringify(b)).toBe(false); if (!r.ok) expect(r.status).toBe(400); }
  });
  it("Yes/No answers become booleans and dependent details follow them", () => {
    const base = student({ physicallyHandicapped: true, handicappedType: "H", studiedOutsideAP: true, studiedOutsideAPDetails: "Chennai", familyIdLinkedOtherState: true, familyIdLinkedOtherStateDetails: "TN" });
    const r = ok(buildStudentSelfUpdate(base, { physicallyHandicapped: "No", studiedOutsideAP: "No", familyIdLinkedOtherState: "No" }));
    expect(r.updates).toEqual({
      physicallyHandicapped: false, handicappedType: null, studiedOutsideAP: false, studiedOutsideAPDetails: null,
      familyIdLinkedOtherState: false, familyIdLinkedOtherStateDetails: null,
    });
  });
  it("'permanent address same as temporary' keeps the two addresses identical", () => {
    const r = ok(buildStudentSelfUpdate(student({ temporaryAddress: "Old" }), { permanentAddressSameAsTemporary: "Yes", temporaryAddress: "New Street" }));
    expect(r.updates).toMatchObject({ permanentAddressSameAsTemporary: true, temporaryAddress: "New Street", permanentAddress: "New Street" });
    const again = ok(buildStudentSelfUpdate(student({ permanentAddressSameAsTemporary: true, temporaryAddress: "A", permanentAddress: "A" }), { temporaryAddress: "B" }));
    expect(again.updates).toMatchObject({ temporaryAddress: "B", permanentAddress: "B" });
  });
});

describe("Student Mobile No (self-edit)", () => {
  it("is locked until a Roll No exists (it is the key the Office matches the roll on)", () => {
    expect(studentMobileSelfEditable({ rollNumber: "" })).toBe(false);
    expect(studentMobileSelfEditable({ rollNumber: "  " })).toBe(false);
    expect(studentMobileSelfEditable({ rollNumber: "24A1" })).toBe(true);
    const r = buildStudentSelfUpdate(student({ rollNumber: "" }), { mobileNo: "9000000009" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(403); expect(r.code).toBe("MOBILE_LOCKED"); }
  });
  it("re-sending the same number (any form) is a no-op, even while locked", () => {
    expect(ok(buildStudentSelfUpdate(student({ rollNumber: "" }), { mobileNo: "+91 98765 00001", fatherName: "X" })).updates).toEqual({ fatherName: "X" });
  });
  it("once a roll exists it can change: validated, stored as 10 digits, reported for claiming", () => {
    const r = ok(buildStudentSelfUpdate(student(), { mobileNo: "+91 90000-00009" }));
    expect(r.updates).toEqual({ mobileNo: "9000000009" });
    expect(r.mobile).toBe("9000000009");
    expect(buildStudentSelfUpdate(student(), { mobileNo: "123" }).ok).toBe(false);
  });
  it("can never be cleared", () => {
    const r = buildStudentSelfUpdate(student(), { mobileNo: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
