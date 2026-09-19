/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures poke at deliberately loose migrated shapes */
import { describe, expect, it } from "vitest";
import { normalizeAcademicProfile, normalizeSupportingStaffProfile } from "./academicProfileCompat";
import { migrateAcademicProfile } from "./fieldRenames";
import { degreeYear } from "@/types";

const legacy = {
  highestQualification: "Ph.D",
  researchAreas: ["AI"],
  highSchoolDetails: { degree: "SSC", universityOrInstitute: "ZP School", yearOfCompletion: 1990 },
  ugDetails: { degree: "B.Tech/BE", location: "Bhimavaram", percentageOrDivision: "80", yearOfCompletion: 1995, certificateNumber: "1" },
  phdDetails: { specialization: "ML", yearOfCompletion: 2016, guideOrSupervisorName: "Dr X" },
  additionalPhdDetails: [{ yearOfCompletion: 2020 }],
  schoolQualifications: [{ level: "SSC", degree: "x", yearOfCompletion: 2000 }],
  qualifyingExamQualified: "YES",
  qualifyingExam: "NET",
  qualifyingExamScore: "70",
  qualifyingExamYear: 2001,
  // Experience / Professional Development / Financial
  previousInstitutions: [{ institutionName: "A" }],
  industryExperienceEntries: [{ institutionName: "B" }],
  primaryIndustryRole: "Engineer",
  trainingEntries: [{ title: "T", type: "FDP", role: "CONDUCTED", organizer: "Me", coConductors: [] }],
  awardEntries: [{ category: "OTHER", title: "Best", awardingBody: "X", dateAwarded: "2020-01-02", level: "STATE", year: 2020 }],
  professionalMemberships: [{ body: "OTHER", otherName: "ABC", validity: "LIFETIME", sinceDate: "2001-01-01" }],
  promotionHistory: [{ designation: "Asst Prof", orderUrl: "u" }],
  presentSalary: 100,
  fundingConsultancyRevenue: 5,
  teachingAssignment: { primaryTeachingRole: "Lecturer", courses: [] },
};

describe("normalizeAcademicProfile", () => {
  it("lifts the qualification keys, splitting the year by level", () => {
    const out = normalizeAcademicProfile(legacy) as Record<string, unknown>;
    expect(out.researchAreasInterests).toEqual(["AI"]);
    expect(out.secondaryEducation).toEqual({ course: "SSC", institutionName: "ZP School", yearOfPassing: 1990 });
    expect(out.ugDetails).toEqual({ course: "B.Tech/BE", place: "Bhimavaram", percentageCgpa: "80", yearOfPassing: 1995, hallTicketNumber: "1" });
    expect(out.phdDetails).toEqual({ specialization: "ML", yearOfAward: 2016, nameOfTheGuideSupervisor: "Dr X" });
    expect(out.additionalPhdDetails).toEqual([{ yearOfAward: 2020 }]);
    expect(out.educationalQualifications).toEqual([{ level: "SSC", course: "x", yearOfPassing: 2000 }]);
    expect(out.netSletSetGateOthers).toBe("YES");
    expect(out.qualifiedExam).toBe("NET");
    expect(out.examScore).toBe("70");
    expect(out.qualifiedYear).toBe(2001);
    for (const old of ["researchAreas", "highSchoolDetails", "schoolQualifications", "qualifyingExam", "qualifyingExamYear"]) {
      expect(out).not.toHaveProperty(old);
    }
  });

  it("lifts the experience, professional development and financial keys too", () => {
    const out = normalizeAcademicProfile(legacy) as Record<string, any>;
    expect(out.academicExperience).toEqual([{ institutionName: "A" }]);
    expect(out.industryExperience).toEqual([{ institutionName: "B" }]);
    expect(out.industryRolesResponsibilities).toBe("Engineer");
    expect(out.teachingRolesResponsibilities).toBe("Lecturer");
    expect(out.teachingAssignment).toEqual({ courses: [] });
    expect(out.fdpsWorkshopsMoocsCertifications).toEqual([
      { type: "FDP", titleOfTheProgram: "T", participatedOrConducted: "CONDUCTED", nameOfTheFacultyCoordinator: "Me", coConductingFaculty: [] },
    ]);
    expect(out.awardsRecognition).toEqual([
      { category: "OTHER", titleOfAward: "Best", awardingAgencyBody: "X", dateOfAward: "2020-01-02", stateNationalInternational: "STATE", year: 2020 },
    ]);
    expect(out.professionalMemberships).toEqual([
      { body: "OTHER", bodyName: "ABC", membershipValidity: "LIFETIME", memberSince: "2001-01-01" },
    ]);
    expect(out.promotionHistory).toEqual([{ designation: "Asst Prof", promotionOrderUrl: "u" }]);
    expect(out.monthlySalary).toBe(100);
    expect(out.fundingConsultancyRevenueGeneration).toBe(5);
    for (const old of [
      "previousInstitutions", "industryExperienceEntries", "primaryIndustryRole", "trainingEntries",
      "awardEntries", "presentSalary", "fundingConsultancyRevenue",
    ]) {
      expect(out).not.toHaveProperty(old);
    }
  });

  it("is the full registry", () => {
    expect(normalizeAcademicProfile(legacy)).toEqual(migrateAcademicProfile(legacy));
  });

  it("is idempotent, never adds undefined keys, and passes non-objects through", () => {
    const once = normalizeAcademicProfile(legacy);
    expect(normalizeAcademicProfile(once)).toEqual(once);
    expect(Object.values(normalizeAcademicProfile({ highestQualification: "x" })).some((v) => v === undefined)).toBe(false);
    expect(normalizeAcademicProfile(undefined)).toBeUndefined();
    expect(normalizeAcademicProfile(null)).toBeNull();
  });
});

describe("normalizeSupportingStaffProfile", () => {
  it("lifts qualifications, training and achievements", () => {
    const out = normalizeSupportingStaffProfile({
      qualifications: [{ level: "SSC", degree: "x", yearOfCompletion: 2000 }],
      nonTechnicalProfile: {
        skills: "s",
        training: [{ type: "FDP", title: "T", organizer: "O", year: 2020 }],
        achievements: [{ category: "OTHER", title: "A", awardingBody: "B", level: "STATE", year: 2021 }],
      },
    }) as Record<string, any>;
    expect(out.qualifications).toEqual([{ level: "SSC", course: "x", yearOfPassing: 2000 }]);
    expect(out.nonTechnicalProfile.skills).toBe("s");
    expect(out.nonTechnicalProfile.training).toEqual([{ type: "FDP", titleOfTheProgram: "T", nameOfTheFacultyCoordinator: "O", year: 2020 }]);
    expect(out.nonTechnicalProfile.achievements).toEqual([
      { category: "OTHER", titleOfAward: "A", awardingAgencyBody: "B", stateNationalInternational: "STATE", year: 2021 },
    ]);
  });

  it("passes profiles without those lists (and non-objects) through", () => {
    expect(normalizeSupportingStaffProfile({ foo: 1 })).toEqual({ foo: 1 });
    expect(normalizeSupportingStaffProfile(undefined)).toBeUndefined();
  });
});

describe("degreeYear", () => {
  it("reads yearOfAward for doctoral and yearOfPassing otherwise", () => {
    const d = { yearOfPassing: 1995, yearOfAward: 2016 };
    expect(degreeYear(d, false)).toBe(1995);
    expect(degreeYear(d, true)).toBe(2016);
    expect(degreeYear(undefined, true)).toBeUndefined();
  });
});
