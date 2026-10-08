import { describe, expect, it } from "vitest";
import { isSharedYearSection, sectionParityGap, describeSectionParityGap } from "./sectionParity";
import type { Section } from "@/types";

// Shaped after VISHNU INSTITUTE OF TECHNOLOGY: Basic Science - Mathematics
// teaches the first year for AIDS and AIML; those year-1 sections are filed
// under the BRANCH and named after the department that teaches them
// ("BSM-AIDS-A"), while years 2-4 are the branch's own ("AIDS-A").
const DEPARTMENTS = [
  { id: "bsm", name: "Basic Science - Mathematics", assignedYears: [1], managedDepartments: ["AIDS", "AIML"] },
  { id: "aids", name: "AIDS", assignedYears: [2, 3, 4] },
  { id: "cse", name: "CSE", assignedYears: [1, 2, 3, 4] },
];

const sec = (over: Partial<Section>): Section =>
  ({ department: "AIDS", year: 1, name: "BSM-AIDS-A", courseId: "c1", ...over }) as Section;

describe("isSharedYearSection", () => {
  // The case promotion was blocked on: an AIDS year-1 section taught by BS-Maths.
  it("is true for a branch's year that a manager actually runs", () => {
    expect(isSharedYearSection(sec({ department: "AIDS", year: 1 }), DEPARTMENTS, undefined)).toBe(true);
  });

  // Years 2-4 are the branch's own again, so the parity rule must still apply.
  it("is false for the same branch's own years", () => {
    expect(isSharedYearSection(sec({ department: "AIDS", year: 2 }), DEPARTMENTS, undefined)).toBe(false);
    expect(isSharedYearSection(sec({ department: "AIDS", year: 4 }), DEPARTMENTS, undefined)).toBe(false);
  });

  it("is false for a department nobody manages, in any year", () => {
    expect(isSharedYearSection(sec({ department: "CSE", year: 1 }), DEPARTMENTS, undefined)).toBe(false);
  });

  // The other arrangement, which the check already recognised: the section is
  // filed under the feeder and names the branch it feeds.
  it("is true for a section that names the branch it feeds", () => {
    expect(isSharedYearSection(
      sec({ department: "Basic Science - Mathematics", year: 1, secondaryDepartments: ["AIDS"] }),
      DEPARTMENTS,
      undefined
    )).toBe(true);
  });

  it("is false when the year is not a number", () => {
    expect(isSharedYearSection(sec({ department: "AIDS", year: NaN }), DEPARTMENTS, undefined)).toBe(false);
  });
});

describe("sectionParityGap", () => {
  const sections = [
    { department: "AIDS", courseId: "c1", year: 1, name: "BSM-AIDS-A" },
    { department: "AIDS", courseId: "c1", year: 1, name: "BSM-AIDS-B" },
    { department: "AIDS", courseId: "c1", year: 1, name: "BSM-AIDS-C" },
    { department: "AIDS", courseId: "c1", year: 2, name: "AIDS-A" },
    { department: "AIDS", courseId: "c1", year: 2, name: "AIDS-B" },
    { department: "AIDS", courseId: "other", year: 2, name: "BSM-AIDS-A" },
  ];

  it("reports both sides of the real VIT mismatch", () => {
    const gap = sectionParityGap(sections, "AIDS", "c1", 1, 2);
    expect(gap.missing).toEqual(["BSM-AIDS-A", "BSM-AIDS-B", "BSM-AIDS-C"]);
    expect(gap.extra).toEqual(["AIDS-A", "AIDS-B"]);
    const text = describeSectionParityGap(gap, 1, 2);
    expect(text).toContain("Section BSM-AIDS-A, BSM-AIDS-B, BSM-AIDS-C has no Year 2 section of the same name");
    expect(text).toContain("Section AIDS-A, AIDS-B exists only in Year 2");
    // It is a note, not a refusal - nothing in it tells anyone to stop.
    expect(text).toContain("Each student still goes to the target picked below");
  });

  it("is empty when both years carry the same names", () => {
    const gap = sectionParityGap(sections, "AIDS", "c1", 2, 2);
    expect(gap).toEqual({ missing: [], extra: [] });
  });

  it("ignores another course's sections and matches names case-insensitively", () => {
    const same = [
      { department: "AIDS", courseId: "c1", year: 2, name: "aids-a" },
      { department: "AIDS", courseId: "c1", year: 3, name: "AIDS-A" },
    ];
    expect(sectionParityGap(same, "AIDS", "c1", 2, 3)).toEqual({ missing: [], extra: [] });
  });
});
