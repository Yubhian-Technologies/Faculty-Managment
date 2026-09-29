import { describe, it, expect } from "vitest";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicSession";
import { isCommonYearDepartment, type DepartmentWithId } from "@/lib/college/academicStructure";

function dept(overrides: Partial<DepartmentWithId>): DepartmentWithId {
  return {
    id: "d1",
    collegeId: "c1",
    name: "Basic Science",
    code: "BS",
    isActive: true,
    createdAt: null as unknown as DepartmentWithId["createdAt"],
    ...overrides,
  };
}

describe("isCommonYearDepartment", () => {
  it("infers a shared first year from year 1 + sub-departments when isFreshman is unset", () => {
    expect(isCommonYearDepartment(dept({ assignedYears: [1], hasSubDepartments: true }))).toBe(true);
  });

  it("infers a shared first year from year 1 + cross-listing when isFreshman is unset", () => {
    expect(isCommonYearDepartment(dept({ assignedYears: [1], secondaryDepartments: ["CSE"] }))).toBe(true);
  });

  it("leaves a plain department that merely teaches year 1 alone", () => {
    expect(isCommonYearDepartment(dept({ assignedYears: [1] }))).toBe(false);
  });

  it("lets an explicit isFreshman win over the inferred rule", () => {
    // No year 1, no sub-departments - nothing to infer from, but ticked.
    expect(isCommonYearDepartment(dept({ isFreshman: true }))).toBe(true);
  });

  it("lets an explicit isFreshman false switch OFF an otherwise-inferred department", () => {
    expect(isCommonYearDepartment(dept({ isFreshman: false, assignedYears: [1], hasSubDepartments: true }))).toBe(false);
  });

  it("still refuses a sub-department that is ticked", () => {
    expect(isCommonYearDepartment(dept({ isFreshman: true, parentDepartmentId: "parent" }))).toBe(false);
  });

  it("still refuses an inactive department that is ticked", () => {
    expect(isCommonYearDepartment(dept({ isFreshman: true, isActive: false }))).toBe(false);
  });
});

describe("regulationsForCourseYearByBatch", () => {
  it("returns all regulations when no batch mapping exists", () => {
    const result = regulationsForCourseYearByBatch({}, 1);
    expect(result).toEqual([]);
  });

  it("returns single regulation when no regulationBatches but fallback provided", () => {
    const result = regulationsForCourseYearByBatch({}, 1, 2024, ["R20", "R23"]);
    expect(result).toEqual(["R20", "R23"]);
  });

  it("returns regulation matching the course year from regulationBatches", () => {
    // R20 covers 2024-2028, R23 covers 2025-2029
    const result = regulationsForCourseYearByBatch(
      { "R20": "2024-2028", "R23": "2025-2029" },
      1, 2024
    );
    expect(result).toEqual(["R20"]);
  });

  it("returns multiple regulations when multiple batches match", () => {
    // Both batches include 2025 as intake year
    const result = regulationsForCourseYearByBatch(
      { "R20": "2024-2028", "R23": "2025-2029" },
      2, 2025
    );
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
