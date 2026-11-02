import { describe, expect, it } from "vitest";
import { buildParentDetailsUpdate, parentDetailsOf } from "./parentDetails";
import { STUDENT_SELF_EDITABLE_KEYS } from "./selfEdit";

const student = { fatherName: "P. Ramesh", fatherContactNo: "9876543210", motherName: "P. Lakshmi", motherContactNo: "" };

describe("parent details", () => {
  it("returns only what changes, mobiles as 10 digits, blank clears", () => {
    const r = buildParentDetailsUpdate(student, { fatherName: "P. Ramesh", fatherContactNo: "+91 98765 43211", motherContactNo: "9123456789", fatherOccupation: "Farmer", motherName: "" });
    expect(r).toEqual({ ok: true, updates: { fatherContactNo: "9876543211", motherContactNo: "9123456789", fatherOccupation: "Farmer", motherName: null } });
  });
  it("an unchanged mobile written differently is not a change", () => {
    expect(buildParentDetailsUpdate(student, { fatherContactNo: "98765 43210" })).toEqual({ ok: true, updates: {} });
  });
  it("refuses a bad mobile and anything that isn't a parent detail", () => {
    expect(buildParentDetailsUpdate(student, { motherContactNo: "12345" })).toMatchObject({ ok: false, error: expect.stringMatching(/10 digits/) });
    expect(buildParentDetailsUpdate(student, { rollNumber: "X" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only parent/) });
  });
  it("reads the stored values", () => {
    expect(parentDetailsOf(student)).toMatchObject({ fatherName: "P. Ramesh", guardianName: "" });
  });
  it("students can no longer change them from their profile", () => {
    for (const k of ["fatherName", "fatherContactNo", "motherName", "motherContactNo", "guardianName", "guardianContact"]) {
      expect(STUDENT_SELF_EDITABLE_KEYS).not.toContain(k);
    }
  });
});
