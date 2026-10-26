import { describe, it, expect } from "vitest";
import { sectionTitle, shortCourseName } from "./sectionTitle";

describe("sectionTitle", () => {
  it("course, year, then the section, hyphenated", () => {
    expect(sectionTitle({ courseName: "Bachelor of Technology", year: 3, sectionName: "IT-A" })).toBe("B.Tech-III Year-IT-A");
    expect(sectionTitle({ courseName: "M.Tech", year: 2, sectionName: "CSE-A" })).toBe("M.Tech-II Year-CSE-A");
  });
  it("keeps any other course name as it is, and falls back without a course", () => {
    expect(shortCourseName("Diploma in Pharmacy")).toBe("Diploma in Pharmacy");
    expect(sectionTitle({ sectionName: "A" })).toBe("Section A");
  });
});
