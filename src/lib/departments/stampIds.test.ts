import { describe, expect, it } from "vitest";
import { buildDepartmentIndex } from "./resolve";
import { stampDepartmentIds } from "./stampIds";

const index = buildDepartmentIndex([
  { id: "d1", name: "Computer Science and Engineering", code: "CSE" },
  { id: "d2", name: "Information Technology", code: "IT" },
]);

describe("stampDepartmentIds", () => {
  it("adds ids next to name fields without touching the names", () => {
    const out = stampDepartmentIds({ department: "Information Technology", secondaryDepartment: "cse", x: 1 }, index);
    expect(out).toMatchObject({ department: "Information Technology", departmentId: "d2", secondaryDepartmentId: "d1", x: 1 });
  });
  it("keeps an id the caller already set", () => {
    expect(stampDepartmentIds({ department: "Information Technology", departmentId: "custom" }, index).departmentId).toBe("custom");
  });
  it("never invents an id for blank/unknown values and never writes undefined", () => {
    const out = stampDepartmentIds({ department: "", secondaryDepartment: "Nope" }, index);
    expect(out).toEqual({ department: "", secondaryDepartment: "Nope" });
    expect(Object.values(out).includes(undefined)).toBe(false);
  });
  it("stamps arrays only when every element resolves", () => {
    expect(stampDepartmentIds({ secondaryDepartments: ["IT", "Computer Science and Engineering"] }, index).secondaryDepartmentIds).toEqual(["d2", "d1"]);
    expect("secondaryDepartmentIds" in stampDepartmentIds({ secondaryDepartments: ["IT", "Nope"] }, index)).toBe(false);
  });
});
