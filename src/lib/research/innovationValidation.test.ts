import { describe, expect, it } from "vitest";
import { innovationMissingFields, type InnovationValidationInput } from "./innovationValidation";

const base: InnovationValidationInput = {
  academicYear: "2024-25", innovatorType: "STUDENT", studentName: "A", studentRegdNo: "21A", studentYearOfStudy: "3",
  studentDepartment: "CSE", facultyMentorName: "Dr B", innovationTitle: "T", innovationType: "PRODUCT", trlLevel: "4",
  problemStatement: "P", briefDescription: "D", prototypeDeveloped: "NO", businessModelDeveloped: "NO",
  startupFormed: "NO", verifiedRecommendedYukti: "NO", presentedInCompetition: "NO", remarks: "ok",
};

describe("innovationMissingFields", () => {
  it("accepts a complete student innovation", () => {
    expect(innovationMissingFields(base)).toEqual([]);
  });

  it("requires every starred field, not just title/type", () => {
    const missing = innovationMissingFields({});
    for (const label of ["Academic Year", "TRL Level", "Problem Statement", "Brief Description", "Prototype Developed", "Remarks"]) {
      expect(missing).toContain(label);
    }
  });

  it("asks for the details only once the answer is Yes", () => {
    expect(innovationMissingFields({ ...base, prototypeDeveloped: "YES" })).toEqual(["Prototype Details"]);
    expect(innovationMissingFields({ ...base, startupFormed: "YES" })).toEqual(["Start-up Name", "Name of the Incubation", "YUKTI ID"]);
    expect(innovationMissingFields({ ...base, presentedInCompetition: "YES" })).toEqual(["Name of the Competition", "Organized By"]);
  });

  it("switches the people block with the innovator type", () => {
    const faculty = { ...base, innovatorType: "FACULTY", facultyInvolvedCount: 0, facultyMembers: [{ name: "X", department: "", contribution: "" }] };
    expect(innovationMissingFields(faculty)).toEqual(["Faculty 1 - Dept.", "Faculty 1 - Contribution"]);
    expect(innovationMissingFields({ ...faculty, facultyInvolvedCount: undefined, facultyMembers: [] })).toEqual(["No. of Faculty Involved"]);
  });
});
