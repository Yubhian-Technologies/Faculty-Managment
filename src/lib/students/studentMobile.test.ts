import { describe, expect, it } from "vitest";
import { normalizeStudentMobile, studentMobileProblem, studentMobileTakenMessage } from "./studentMobile";

describe("normalizeStudentMobile", () => {
  it("is the same 10 digits however it was typed", () => {
    for (const typed of ["9876543210", " 98765 43210 ", "98765-43210", "+91 98765 43210", "+919876543210", "919876543210", "09876543210", "(98765) 43210"]) {
      expect(normalizeStudentMobile(typed)).toBe("9876543210");
    }
  });
  it("gives '' for nothing usable and leaves other lengths alone (so they fail validation)", () => {
    expect(normalizeStudentMobile("")).toBe("");
    expect(normalizeStudentMobile(undefined)).toBe("");
    expect(normalizeStudentMobile("Optional; phone/text")).toBe("");
    expect(normalizeStudentMobile("12345")).toBe("12345");
  });
});

describe("studentMobileProblem - the number is REQUIRED", () => {
  it("blank / missing / spaces is a problem", () => {
    for (const blank of ["", "   ", undefined, null]) expect(studentMobileProblem(blank)).toBe("Student Mobile No is required");
  });
  it("accepts a real 10-digit number in any typed form", () => {
    expect(studentMobileProblem("9876543210")).toBeNull();
    expect(studentMobileProblem("+91 6000000000")).toBeNull();
  });
  it("rejects wrong length, wrong first digit and text", () => {
    for (const bad of ["12345", "5876543210", "98765432101", "abcdefghij", "Optional; phone/text", "0000000000"]) {
      expect(studentMobileProblem(bad)).toMatch(/10 digits/);
    }
  });
});

describe("studentMobileTakenMessage", () => {
  it("names the holder when they are in the caller's own college", () => {
    expect(studentMobileTakenMessage("9876543210", { name: "A KUMAR", rollNumber: "24A01", sameCollege: true })).toBe("Student Mobile No 9876543210 is already used by another student (A KUMAR, Roll No 24A01)");
    expect(studentMobileTakenMessage("9876543210", { name: "A KUMAR" })).toContain("(A KUMAR)");
    expect(studentMobileTakenMessage("9876543210", {})).toBe("Student Mobile No 9876543210 is already used by another student");
  });
  it("never names a student of another college", () => {
    const m = studentMobileTakenMessage("9876543210", { name: "A KUMAR", rollNumber: "24A01", sameCollege: false });
    expect(m).toBe("Student Mobile No 9876543210 is already used by a student of another college");
    expect(m).not.toContain("KUMAR");
  });
});
