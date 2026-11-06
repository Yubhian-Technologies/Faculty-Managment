import { describe, expect, it } from "vitest";
import { ownerDepartmentNames, ownerDepartmentRefs, reviewDepartmentsOf } from "./ownerDepartment";
import { deadlineProgress } from "@/lib/midBank/progress";

describe("Subject Department(s)", () => {
  const names = new Map([["bsm", "Basic Science - Maths"], ["bsp", "Basic Science - Physics"], ["bsc", "Basic Science - Chemistry"]]);

  it("not set: the branch reviews, as before", () => {
    expect(reviewDepartmentsOf("CSE", {})).toEqual(["CSE"]);
    expect(reviewDepartmentsOf("CSE", null)).toEqual(["CSE"]);
    expect(ownerDepartmentNames({})).toEqual([]);
  });

  it("one set: that department reviews in every branch", () => {
    const maths = { ownerDepartments: [{ id: "bsm", name: "Maths (old name)" }] };
    expect(reviewDepartmentsOf("CSE", maths, names)).toEqual(["Basic Science - Maths"]);
    expect(reviewDepartmentsOf("ECE", maths, names)).toEqual(["Basic Science - Maths"]);
  });

  it("two set: both review (either decides)", () => {
    const s = { ownerDepartments: [{ id: "bsp", name: "" }, { id: "bsc", name: "" }] };
    expect(reviewDepartmentsOf("CSE", s, names)).toEqual(["Basic Science - Physics", "Basic Science - Chemistry"]);
  });

  it("reads a single department saved before the list existed", () => {
    expect(ownerDepartmentRefs({ ownerDepartmentId: "bsm", ownerDepartmentName: "Maths" })).toEqual([{ id: "bsm", name: "Maths" }]);
    expect(reviewDepartmentsOf("CSE", { ownerDepartmentId: "bsm", ownerDepartmentName: "Old" }, names)).toEqual(["Basic Science - Maths"]);
    // The list wins over the old field.
    expect(ownerDepartmentRefs({ ownerDepartments: [{ id: "bsc", name: "C" }], ownerDepartmentId: "bsm" })).toEqual([{ id: "bsc", name: "C" }]);
  });

  it("uses the department's current name, else the saved one", () => {
    expect(ownerDepartmentNames({ ownerDepartments: [{ id: "gone", name: "Physics" }] }, names)).toEqual(["Physics"]);
    // A name with no id is never used (the id is what was set).
    expect(ownerDepartmentNames({ ownerDepartmentName: "Physics" }, names)).toEqual([]);
  });

  it("a subject another department reviews is not counted as waiting for this viewer", () => {
    const bank = (id: string) => ({ id, status: "COMPLETE", completeCount: 10, totalCount: 10, approval: "SUBMITTED" });
    const p = deadlineProgress([
      { sections: [{ bankId: "a" }], banks: [bank("a")] },
      { sections: [{ bankId: "b" }], banks: [bank("b")], canOpen: false },
    ]);
    expect(p.banksSubmitted).toBe(1);
    expect(p.banks).toBe(2); // still in the progress
    expect(p.ready).toBe(2);
  });
});
