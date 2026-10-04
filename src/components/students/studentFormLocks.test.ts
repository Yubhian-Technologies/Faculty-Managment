import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/students/rosterFormMetadata", () => ({ fetchRosterFormMetadata: async () => ({ departments: [], courseNames: [], courses: [], years: [] }) }));

import { lockedFieldKeys } from "@/components/students/StudentFormDialog";

describe("student form: which fields are read-only", () => {
  it("Add: nothing is locked", () => {
    expect(lockedFieldKeys(false, false)).toEqual([]);
    expect(lockedFieldKeys(false, true)).toEqual([]);
  });

  it("Edit for every role except the College Office: Roll No, Department and Year stay locked (unchanged)", () => {
    expect(lockedFieldKeys(true, false)).toEqual(["rollNumber", "department", "year"]);
  });

  it("Edit for the College Office: Roll No is editable; Department and Year stay locked", () => {
    const locked = lockedFieldKeys(true, true);
    expect(locked).not.toContain("rollNumber");
    expect(locked).toEqual(["department", "year"]);
  });
});
