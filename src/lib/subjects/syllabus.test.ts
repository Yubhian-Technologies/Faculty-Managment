import { describe, expect, it } from "vitest";
import { cleanSyllabus, cosOfUnit, syllabusAsOutcomes, syllabusChanges, syllabusOutcomesId, syllabusStep, syllabusSubjectOf } from "./syllabus";
import type { SubjectSyllabus } from "@/types";

const form = {
  units: [{ title: "Matrices" }, { title: "Calculus" }],
  cos: [{ statement: "Solve linear systems", unit: 1 }, { statement: "Apply mean value theorems", unit: 2 }],
  mapping: { CO1: ["PO1", "PO2"], CO2: ["PO1"] },
};

describe("cleanSyllabus", () => {
  it("keeps each CO's unit and numbers units / COs in order", () => {
    const { value, errors } = cleanSyllabus(form, true);
    expect(errors).toEqual([]);
    expect(value.units.map((u) => u.no)).toEqual([1, 2]);
    expect(value.cos).toEqual([{ id: "CO1", statement: "Solve linear systems", unit: 1 }, { id: "CO2", statement: "Apply mean value theorems", unit: 2 }]);
  });
  it("every CO needs an existing unit", () => {
    const { errors } = cleanSyllabus({ ...form, cos: [{ statement: "A" }, { statement: "B", unit: 5 }] }, false);
    expect(errors).toContain("CO1: pick its unit");
    expect(errors).toContain("CO2: Unit 5 doesn't exist");
  });
  it("submitting needs every CO mapped; a draft does not", () => {
    const unmapped = { ...form, mapping: { CO1: ["PO1"] } };
    expect(cleanSyllabus(unmapped, false).errors).toEqual([]);
    expect(cleanSyllabus(unmapped, true).errors).toContain("CO2 is not mapped to any PO or PSO");
  });
});

describe("syllabusStep", () => {
  it("HOD prepares and submits; can't touch it once submitted or frozen", () => {
    expect(syllabusStep(null, "HOD", "SAVE")).toEqual({ status: "DRAFT" });
    expect(syllabusStep("DRAFT", "HOD", "SUBMIT")).toEqual({ status: "SUBMITTED" });
    expect(syllabusStep("RETURNED", "HOD", "SAVE")).toEqual({ status: "RETURNED" });
    expect(syllabusStep("RETURNED", "HOD", "SUBMIT")).toEqual({ status: "SUBMITTED" });
    expect("error" in syllabusStep("SUBMITTED", "HOD", "SAVE")).toBe(true);
    expect("error" in syllabusStep("FROZEN", "HOD", "SAVE")).toBe(true);
    expect("error" in syllabusStep("DRAFT", "HOD", "FREEZE")).toBe(true);
  });
  it("Academics freezes or returns a submitted one, and only edits once frozen", () => {
    expect(syllabusStep("SUBMITTED", "ACADEMICS", "FREEZE")).toEqual({ status: "FROZEN" });
    expect(syllabusStep("SUBMITTED", "ACADEMICS", "RETURN")).toEqual({ status: "RETURNED" });
    expect(syllabusStep("FROZEN", "ACADEMICS", "SAVE")).toEqual({ status: "FROZEN" });
    expect("error" in syllabusStep("DRAFT", "ACADEMICS", "FREEZE")).toBe(true);
    expect("error" in syllabusStep("DRAFT", "ACADEMICS", "SAVE")).toBe(true);
    expect("error" in syllabusStep("FROZEN", "ACADEMICS", "SUBMIT")).toBe(true);
  });
});

describe("syllabusChanges", () => {
  it("lists exactly what moved, old -> new", () => {
    const before = cleanSyllabus(form, true).value;
    const after = cleanSyllabus({
      units: [{ title: "Matrices and Eigenvalues" }, { title: "Calculus" }, { title: "Vectors" }],
      cos: [{ statement: "Solve linear systems", unit: 1 }, { statement: "Apply mean value theorems", unit: 3 }],
      mapping: { CO1: ["PO1", "PO2", "PSO1"], CO2: ["PO1"] },
    }, true).value;
    expect(syllabusChanges(before, after)).toEqual([
      { field: "Unit 1 title", before: "Matrices", after: "Matrices and Eigenvalues" },
      { field: "Unit 3", before: "-", after: "Vectors" },
      { field: "CO1 -> POs / PSOs", before: "PO1, PO2", after: "PO1, PO2, PSO1" },
      { field: "CO2 unit", before: "Unit 2", after: "Unit 3" },
    ]);
    expect(syllabusChanges(before, before)).toEqual([]);
  });
});

describe("outcomes for Mid banks / papers", () => {
  const s = { subjectId: "s1", subjectName: "LAC", subjectCode: "LA", status: "FROZEN", version: 3, updatedByUid: "u", updatedByName: "A", updatedAt: "t", ...cleanSyllabus(form, true).value } as unknown as SubjectSyllabus;
  it("only a frozen syllabus is used", () => {
    expect(syllabusAsOutcomes(s)?.cos).toHaveLength(2);
    expect(syllabusAsOutcomes({ ...s, status: "SUBMITTED" })).toBeNull();
    expect(syllabusAsOutcomes(null)).toBeNull();
  });
  it("outcomes id round-trips", () => {
    expect(syllabusSubjectOf(syllabusOutcomesId("abc"))).toBe("abc");
    expect(syllabusSubjectOf("abc__cse")).toBeNull();
  });
  it("a unit's COs; every CO when they carry no unit", () => {
    expect(cosOfUnit(s.cos, 2).map((c) => c.id)).toEqual(["CO2"]);
    expect(cosOfUnit([{ id: "CO1", statement: "x" }], 2)).toHaveLength(1);
  });
});
