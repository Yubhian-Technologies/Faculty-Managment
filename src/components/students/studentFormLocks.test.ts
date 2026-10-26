import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/students/rosterFormMetadata", () => ({ fetchRosterFormMetadata: async () => ({ departments: [], courseNames: [], courses: [], years: [] }) }));

import { lockedFieldKeys } from "@/components/students/StudentFormDialog";

describe("student form: which fields are read-only", () => {
  it("Add: nothing is locked", () => {
    expect(lockedFieldKeys(false, false)).toEqual([]);
    expect(lockedFieldKeys(false, true)).toEqual([]);
  });

  it("Edit for every role except the College Office: Regd. No, Department and Year stay locked (unchanged)", () => {
    expect(lockedFieldKeys(true, false)).toEqual(["rollNumber", "department", "year"]);
  });

  it("Edit for the College Office: Regd. No is editable; Department and Year stay locked", () => {
    const locked = lockedFieldKeys(true, true);
    expect(locked).not.toContain("rollNumber");
    expect(locked).toEqual(["department", "year"]);
  });

  it("Edit of a student already in a section: Course is locked too (their course follows the section)", () => {
    expect(lockedFieldKeys(true, true, true)).toEqual(["department", "year", "course"]);
    expect(lockedFieldKeys(true, false, true)).toEqual(["rollNumber", "department", "year", "course"]);
    expect(lockedFieldKeys(true, true, false)).toEqual(["department", "year"]);
    expect(lockedFieldKeys(false, true, true)).toEqual([]);
  });
});
