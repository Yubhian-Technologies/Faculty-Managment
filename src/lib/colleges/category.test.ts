import { describe, expect, it } from "vitest";
import { collegeCategoryOf, isSameCategory, parseCollegeCategory } from "./category";

describe("college category", () => {
  it("parses only the two known values", () => {
    expect(parseCollegeCategory("MAIN")).toBe("MAIN");
    expect(parseCollegeCategory("TEST")).toBe("TEST");
    for (const bad of ["main", "test", "", "PROD", null, undefined, 1, {}]) expect(parseCollegeCategory(bad)).toBeNull();
  });
  it("a college with no (or an unknown) category is MAIN", () => {
    expect(collegeCategoryOf({})).toBe("MAIN");
    expect(collegeCategoryOf(undefined)).toBe("MAIN");
    expect(collegeCategoryOf(null)).toBe("MAIN");
    expect(collegeCategoryOf({ collegeCategory: "weird" })).toBe("MAIN");
    expect(collegeCategoryOf({ collegeCategory: "TEST" })).toBe("TEST");
  });
  it("same-category check treats a missing value as MAIN", () => {
    expect(isSameCategory({}, { collegeCategory: "MAIN" })).toBe(true);
    expect(isSameCategory({ collegeCategory: "TEST" }, { collegeCategory: "TEST" })).toBe(true);
    expect(isSameCategory({ collegeCategory: "TEST" }, {})).toBe(false);
    expect(isSameCategory({}, { collegeCategory: "TEST" })).toBe(false);
  });
});
