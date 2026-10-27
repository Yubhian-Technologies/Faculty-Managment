import { describe, expect, it } from "vitest";
import { emptyModuleMessage, isModuleEmpty } from "./moduleEmpty";
import { PROFILE_MODULES, type ProfileModuleKey } from "./profileModules";

const FILLED_TABS: ProfileModuleKey[] = ["personal", "qualification", "experience", "mentorship", "financial", "others"];

describe("isModuleEmpty", () => {
  it("every tab that holds typed details is empty on a record with nothing entered", () => {
    for (const tab of FILLED_TABS) expect(isModuleEmpty(tab, { employeeId: "E1", legalName: "A KUMAR" }), tab).toBe(true);
    expect(isModuleEmpty("others", {})).toBe(true);
  });

  it("a tab stops being empty as soon as one value in it is entered", () => {
    expect(isModuleEmpty("personal", { fatherName: "R KUMAR" })).toBe(false);
    expect(isModuleEmpty("personal", { aadharNo: "123412341234" })).toBe(false);
    expect(isModuleEmpty("qualification", { academicProfile: { ugDetails: { course: "BBA", institutionName: "X" } } })).toBe(false);
    expect(isModuleEmpty("qualification", { academicProfile: { researchAreasInterests: ["AI"] } })).toBe(false);
    expect(isModuleEmpty("experience", { academicProfile: { academicExperience: [{ institutionName: "ABC College" }] } })).toBe(false);
    expect(isModuleEmpty("mentorship", { academicProfile: { awardsRecognition: [{ category: "BEST_TEACHER", titleOfAward: "Best" }] } })).toBe(false);
    expect(isModuleEmpty("financial", { academicProfile: { monthlySalary: 50000 } })).toBe(false);
    expect(isModuleEmpty("others", { academicProfile: { otherInformation: "Chess club" } })).toBe(false);
  });

  it("a value entered in one tab does not make another tab non-empty", () => {
    const record = { academicProfile: { otherInformation: "Chess club" } };
    expect(isModuleEmpty("others", record)).toBe(false);
    expect(isModuleEmpty("qualification", record)).toBe(true);
    expect(isModuleEmpty("financial", record)).toBe(true);
  });

  it("a record still on the old key names counts by what it holds", () => {
    expect(isModuleEmpty("experience", { academicProfile: { previousInstitutions: [{ institutionName: "ABC College" }] } })).toBe(false);
    expect(isModuleEmpty("financial", { academicProfile: { presentSalary: 40000 } })).toBe(false);
  });

  it("Research is never empty (it has its own sub-tabs and Add buttons)", () => {
    expect(isModuleEmpty("research", {})).toBe(false);
  });

  it("Teaching Load is empty only when the caller says its tables have no rows", () => {
    expect(isModuleEmpty("teaching-load", {})).toBe(false);
    expect(isModuleEmpty("teaching-load", {}, { teachingEmpty: true })).toBe(true);
    expect(isModuleEmpty("teaching-load", {}, { teachingEmpty: false })).toBe(false);
  });

  it("anything it cannot read is treated as NOT empty - the tab then shows as it always did", () => {
    expect(isModuleEmpty("personal", null)).toBe(false);
    expect(isModuleEmpty("qualification", undefined)).toBe(false);
    expect(isModuleEmpty("others", "not a record")).toBe(false);
  });
});

describe("emptyModuleMessage", () => {
  it("invites someone who can edit to enter the details", () => {
    expect(emptyModuleMessage("academic", true).title).toBe("Please enter the academic details here.");
  });
  it("only states the fact to someone who cannot edit", () => {
    const m = emptyModuleMessage("compensation", false);
    expect(m.title).toBe("No compensation details have been entered yet.");
    expect(m.title).not.toMatch(/please/i);
  });
  it("every tab has a noun for the sentence", () => {
    for (const k of Object.keys(PROFILE_MODULES) as ProfileModuleKey[]) expect(PROFILE_MODULES[k].emptyNoun.length, k).toBeGreaterThan(2);
    expect(PROFILE_MODULES.qualification.emptyNoun).toBe("academic");
  });
});
