import { describe, expect, it } from "vitest";
import { changesFacultyLoginEmail, normalizeCollegeEmail } from "./changeCollegeEmail";

describe("normalizeCollegeEmail", () => {
  it("trims and lower-cases; nothing becomes ''", () => {
    expect(normalizeCollegeEmail("  Asha@College.TEST ")).toBe("asha@college.test");
    expect(normalizeCollegeEmail(undefined)).toBe("");
    expect(normalizeCollegeEmail(null)).toBe("");
  });
});

describe("changesFacultyLoginEmail - only a DIFFERENT address counts", () => {
  const stored = { email: "asha@college.test", collegeEmail: "asha@college.test" };
  it("values re-sent unchanged (any case / spacing) are not a change", () => {
    expect(changesFacultyLoginEmail(stored, { email: "ASHA@college.test ", collegeEmail: " asha@college.test" })).toBe(false);
  });
  it("a field that is not sent is not a change", () => {
    expect(changesFacultyLoginEmail(stored, {})).toBe(false);
    expect(changesFacultyLoginEmail(stored, { email: undefined, collegeEmail: undefined })).toBe(false);
  });
  it("a different email or collegeEmail is a change", () => {
    expect(changesFacultyLoginEmail(stored, { email: "other@college.test" })).toBe(true);
    expect(changesFacultyLoginEmail(stored, { collegeEmail: "other@college.test" })).toBe(true);
  });
  it("an account with no stored collegeEmail re-sending '' is not a change", () => {
    expect(changesFacultyLoginEmail({ email: "a@b.test" }, { email: "a@b.test", collegeEmail: "" })).toBe(false);
  });
});
