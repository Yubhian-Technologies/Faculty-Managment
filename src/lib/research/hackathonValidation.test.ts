import { describe, expect, it } from "vitest";
import { hackathonMissingFields, type HackathonValidationInput } from "./hackathonValidation";

const complete: HackathonValidationInput = {
  academicYear: "2024-25", eventTitle: "Smart Hack", eventType: "HACKATHON", levelOfEvent: "STATE",
  organizingDeptCell: "IIC", startDate: "2025-01-10", endDate: "2025-01-11", durationHours: 24,
  venue: "Seminar Hall", themeDomain: "AI", remarks: "None",
  noOfProblemStatements: 5, teamsRegisteredInternal: 10, teamsRegisteredExternal: 0,
  participantsInternal: 40, participantsExternal: 0, ideasPresentedCount: 8, pocsPresentedCount: 0,
  productsPresentedCount: 0, ideasUploadedYukti: 0, ideasVerifiedRecommendedYukti: 0,
  prototypesUploadedYukti: 0, prototypesVerifiedRecommendedYukti: 0,
  evaluators: [{ name: "A", affiliation: "X" }], facultyCoordinators: [],
};

describe("hackathonMissingFields", () => {
  it("accepts a complete record (zero counts are real answers)", () => {
    expect(hackathonMissingFields(complete)).toEqual([]);
  });

  it("flags every required field of an empty form, not just the title/type/level", () => {
    const missing = hackathonMissingFields({});
    for (const label of ["Academic Year", "Event Title", "Venue", "Theme / Domain", "Remarks", "Duration (Hrs)", "Teams Registered - Internal", "Ideas Uploaded in YUKTI"]) {
      expect(missing).toContain(label);
    }
  });

  it("treats a blank or null count as missing but 0 as filled", () => {
    expect(hackathonMissingFields({ ...complete, ideasPresentedCount: undefined })).toEqual(["Ideas Presented"]);
    expect(hackathonMissingFields({ ...complete, ideasPresentedCount: null })).toEqual(["Ideas Presented"]);
    expect(hackathonMissingFields({ ...complete, ideasPresentedCount: 0 })).toEqual([]);
  });

  it("refuses whitespace-only text and a zero duration", () => {
    expect(hackathonMissingFields({ ...complete, venue: "   ", durationHours: 0 })).toEqual(["Venue", "Duration (Hrs)"]);
  });

  it("flags incomplete evaluator / coordinator rows by position", () => {
    const missing = hackathonMissingFields({
      ...complete,
      evaluators: [{ name: "A", affiliation: "X" }, { name: "", affiliation: "" }],
      facultyCoordinators: [{ name: "B", designation: "", departmentOrCell: "CSE" }],
    });
    expect(missing).toEqual(["Evaluator 2 - Name", "Evaluator 2 - Affiliation", "Faculty Coordinator 1 - Designation"]);
  });

  it("refuses an end date before the start date", () => {
    expect(hackathonMissingFields({ ...complete, startDate: "2025-02-01", endDate: "2025-01-01" }))
      .toEqual(["End Date must be on or after Start Date"]);
  });
});
