import { describe, it, expect } from "vitest";
import { invalidPromotion, notInFinalYear, notInSourceSection } from "@/lib/students/promotionRules";
import type { Section } from "@/types";

const section = (over: Partial<Section> = {}) => ({ name: "A", year: 2, department: "CSE", courseId: "course-cse", ...over }) as Section;
const student = (over: Record<string, unknown> = {}) => ({ year: 2, section: "A", department: "CSE", courseId: "course-cse", ...over }) as never;

describe("notInSourceSection (S6)", () => {
  it("passes a real member of the section, and everything when there is no source", () => {
    expect(notInSourceSection(student(), section())).toBeNull();
    expect(notInSourceSection(student({ year: 9, section: "Z" }), null)).toBeNull();
  });
  it("skips a student in another section, another year or another department", () => {
    expect(notInSourceSection(student({ section: "B" }), section())).toMatch(/not in A/);
    expect(notInSourceSection(student({ year: 3 }), section())).toMatch(/Year 2/);
    expect(notInSourceSection(student({ department: "ECE" }), section())).toMatch(/not in CSE/);
  });
  it("accepts a dual-department student through their secondary department", () => {
    expect(notInSourceSection(student({ department: "ECE", secondaryDepartment: "CSE" }), section())).toBeNull();
  });
  it("does NOT block on a stale student courseId (legacy records)", () => {
    expect(notInSourceSection(student({ courseId: "stale-old-id" }), section())).toBeNull();
    expect(notInSourceSection(student({ courseId: undefined }), section())).toBeNull();
  });
});

describe("invalidPromotion (S6)", () => {
  const catalogOf = (id?: string) => ({ "course-cse": "btech", "course-ece": "btech", "course-mba": "mba" } as Record<string, string>)[id ?? ""];

  it("allows exactly one year up within the same programme (different departments share a catalog)", () => {
    expect(invalidPromotion(student(), { year: 3, courseId: "course-cse" }, catalogOf)).toBeNull();
    expect(invalidPromotion(student(), { year: 3, courseId: "course-ece" }, catalogOf)).toBeNull();
  });
  it("refuses skipping a year, going backwards and staying put", () => {
    expect(invalidPromotion(student(), { year: 4, courseId: "course-cse" }, catalogOf)).toMatch(/Year 3 section/);
    expect(invalidPromotion(student(), { year: 1, courseId: "course-cse" }, catalogOf)).toMatch(/can only be promoted/);
    expect(invalidPromotion(student(), { year: 2, courseId: "course-cse" }, catalogOf)).toMatch(/can only be promoted/);
  });
  it("refuses a different programme", () => {
    expect(invalidPromotion(student(), { year: 3, courseId: "course-mba" }, catalogOf)).toMatch(/different programme/);
  });
  it("an unknown programme on either side skips the programme check rather than blocking", () => {
    expect(invalidPromotion(student({ courseId: "unknown" }), { year: 3, courseId: "course-mba" }, catalogOf)).toBeNull();
    expect(invalidPromotion(student(), { year: 3, courseId: undefined as unknown as string }, catalogOf)).toBeNull();
  });
});

describe("notInFinalYear (S6)", () => {
  it("only final-year students graduate", () => {
    expect(notInFinalYear({ year: 4 }, 4)).toBeNull();
    expect(notInFinalYear({ year: 2 }, 4)).toMatch(/not the final year/);
  });
  it("an unknown final year does not block", () => {
    expect(notInFinalYear({ year: 2 }, undefined)).toBeNull();
  });
});
