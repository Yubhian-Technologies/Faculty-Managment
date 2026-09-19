/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures poke at deliberately loose migrated shapes */
import { describe, expect, it } from "vitest";
import {
  migrateAcademicProfile, migrateFacultyDoc, migrateUserDoc, migrateSupportingStaffDoc, migrateDegree,
} from "./fieldRenames";

const legacyUg = {
  degree: "B.Tech/BE", branch: "it", universityOrInstitute: "dg", location: "dh",
  percentageOrDivision: "88", yearOfCompletion: 1995, certificateNumber: "365",
  certificateUrl: "", domain: "ENGINEERING", institutionType: "INSTITUTE", affiliatedUniversity: "dh",
};

describe("migrateDegree", () => {
  it("renames Course/Place/Percentage/Hall Ticket Number and uses Year of Passing for non-doctoral", () => {
    expect(migrateDegree(legacyUg, false)).toEqual({
      course: "B.Tech/BE", branch: "it", institutionName: "dg", place: "dh",
      percentageCgpa: "88", yearOfPassing: 1995, hallTicketNumber: "365",
      certificateUrl: "", domain: "ENGINEERING", institutionType: "INSTITUTE", affiliatedUniversity: "dh",
    });
  });

  it("uses Year of Award for doctoral entries", () => {
    const out = migrateDegree({ specialization: "hg", yearOfCompletion: 2016, guideOrSupervisorName: "Dr X" }, true);
    expect(out).toEqual({ specialization: "hg", yearOfAward: 2016, nameOfTheGuideSupervisor: "Dr X" });
  });

  it("is idempotent", () => {
    const once = migrateDegree(legacyUg, false);
    expect(migrateDegree(once, false)).toEqual(once);
  });

  it("lets the new key win when both old and new are present", () => {
    expect(migrateDegree({ degree: "old", course: "new" }, false)).toEqual({ course: "new" });
  });
});

describe("migrateAcademicProfile", () => {
  it("renames root keys and nested degree containers by level", () => {
    const out = migrateAcademicProfile({
      highSchoolDetails: { degree: "SSC", yearOfCompletion: 1989 },
      ugDetails: legacyUg,
      additionalUgDetails: [{ degree: "B.Sc", yearOfCompletion: 2000 }],
      phdDetails: { yearOfCompletion: 2016, status: "AWARDED" },
      postDoctoralDetails: { yearOfCompletion: 2015 },
      qualifyingExamQualified: "YES", qualifyingExam: "NET", qualifyingExamYear: 2010,
      researchAreas: ["AI"],
    }) as Record<string, any>;
    expect(out.secondaryEducation).toEqual({ course: "SSC", yearOfPassing: 1989 });
    expect(out.ugDetails.yearOfPassing).toBe(1995);
    expect(out.additionalUgDetails).toEqual([{ course: "B.Sc", yearOfPassing: 2000 }]);
    expect(out.phdDetails).toEqual({ yearOfAward: 2016, status: "AWARDED" });
    expect(out.postdoctoralFellowshipDetails).toEqual({ yearOfAward: 2015 });
    expect(out.netSletSetGateOthers).toBe("YES");
    expect(out.qualifiedExam).toBe("NET");
    expect(out.qualifiedYear).toBe(2010);
    expect(out.researchAreasInterests).toEqual(["AI"]);
    expect("highSchoolDetails" in out).toBe(false);
    expect("postDoctoralDetails" in out).toBe(false);
  });

  it("renames experience, professional development and financial keys", () => {
    const out = migrateAcademicProfile({
      previousInstitutions: [{ institutionName: "A", fromDate: "2000-01-01" }],
      industryExperienceEntries: [{ institutionName: "B" }],
      researchExperienceEntries: [{ institutionName: "C" }],
      primaryIndustryRole: "lead", primaryResearchRole: "pi",
      teachingAssignment: { primaryTeachingRole: "teach", courses: [] },
      promotionHistory: [{ designation: "AP", orderUrl: "u" }],
      labsEstablished: [{ facilityDetails: "f", outcomes: "o" }],
      adminResponsibilityEntries: [{ category: "NBA", description: "d" }],
      trainingEntries: [{ type: "FDP", title: "t", organizer: "me", durationDays: 3, mode: "ONLINE", coConductors: [{ name: "x" }], beneficiaryTotalCount: 10 }],
      professionalMemberships: [{ body: "IEEE", otherName: "n", validity: "ANNUAL", sinceDate: "2020-01-01" }],
      awardEntries: [{ category: "BEST_TEACHER", title: "T", awardingBody: "B", dateAwarded: "2020-05-01", level: "STATE", year: 2020 }],
      presentSalary: 50000, fundingConsultancyRevenue: 10,
    }) as Record<string, any>;
    expect(out.academicExperience).toEqual([{ institutionName: "A", fromDate: "2000-01-01" }]);
    expect(out.industryExperience).toEqual([{ institutionName: "B" }]);
    expect(out.researchExperience).toEqual([{ institutionName: "C" }]);
    expect(out.industryRolesResponsibilities).toBe("lead");
    expect(out.researchRolesResponsibilities).toBe("pi");
    expect(out.teachingRolesResponsibilities).toBe("teach");
    expect(out.teachingAssignment).toEqual({ courses: [] });
    expect(out.promotionHistory).toEqual([{ designation: "AP", promotionOrderUrl: "u" }]);
    expect(out.newLabsEstablished).toEqual([{ facilityDetails: "f", outcomes: "o" }]);
    expect(out.academicResponsibilities).toEqual([{ category: "NBA", description: "d" }]);
    expect(out.fdpsWorkshopsMoocsCertifications).toEqual([{
      type: "FDP", titleOfTheProgram: "t", nameOfTheFacultyCoordinator: "me", duration: 3,
      modeOfTheProgram: "ONLINE", coConductingFaculty: [{ name: "x" }], totalCount: 10,
    }]);
    expect(out.professionalMemberships).toEqual([{ body: "IEEE", bodyName: "n", membershipValidity: "ANNUAL", memberSince: "2020-01-01" }]);
    expect(out.awardsRecognition).toEqual([{
      category: "BEST_TEACHER", titleOfAward: "T", awardingAgencyBody: "B", dateOfAward: "2020-05-01",
      stateNationalInternational: "STATE", year: 2020,
    }]);
    expect(out.monthlySalary).toBe(50000);
    expect(out.fundingConsultancyRevenueGeneration).toBe(10);
  });

  it("never introduces keys that were absent (Firestore rejects undefined)", () => {
    const out = migrateAcademicProfile({ highestQualification: "PhD" }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["highestQualification"]);
  });

  it("is idempotent on an already-migrated profile", () => {
    const once = migrateAcademicProfile({ ugDetails: legacyUg, trainingEntries: [{ title: "t" }] });
    expect(migrateAcademicProfile(once)).toEqual(once);
  });

  it("passes non-objects straight through", () => {
    expect(migrateAcademicProfile(undefined)).toBeUndefined();
    expect(migrateAcademicProfile(null)).toBeNull();
  });
});

describe("whole-document migrations", () => {
  it("renames facultyMembers top-level and personal keys", () => {
    const out = migrateFacultyDoc({
      qualification: "M.Tech", experienceYears: 7, passportNumber: "P1", bankAccountNo: "123",
      emergencyContactPhone: "999", permanentSameAsTemporary: true, legalName: "keep", name: "keep",
      academicProfile: { presentSalary: 1 },
    });
    expect(out).toEqual({
      highestQualification: "M.Tech", totalYearsOfExperience: 7, passportNo: "P1", bankAccountNumber: "123",
      emergencyContactMobileNo: "999", permanentAddressSameAsTemporary: true, legalName: "keep", name: "keep",
      academicProfile: { monthlySalary: 1 },
    });
  });

  it("leaves users' qualification/experienceYears alone but migrates personal keys and academicProfile", () => {
    const out = migrateUserDoc({ passportNumber: "P", permanentSameAsTemporary: false, experienceYears: 3, academicProfile: { trainingEntries: [] } });
    expect(out).toEqual({ passportNo: "P", permanentAddressSameAsTemporary: false, experienceYears: 3, academicProfile: { fdpsWorkshopsMoocsCertifications: [] } });
  });

  it("migrates the shared-shape lists on supportingStaff docs without touching its flat qualification/experienceYears", () => {
    const out = migrateSupportingStaffDoc({
      qualification: "keep", experienceYears: 4, bankAccountNo: "9", permanentSameAsTemporary: true,
      supportingStaffProfile: {
        qualifications: [{ level: "Degree", degree: "B.Com", yearOfCompletion: 2001 }],
        nonTechnicalProfile: {
          training: [{ title: "t", organizer: "o" }],
          achievements: [{ title: "a", dateAwarded: "2020-01-01" }],
        },
      },
    }) as Record<string, any>;
    expect(out.qualification).toBe("keep");
    expect(out.experienceYears).toBe(4);
    expect(out.bankAccountNumber).toBe("9");
    expect(out.permanentAddressSameAsTemporary).toBe(true);
    expect("permanentSameAsTemporary" in out).toBe(false);
    expect(out.supportingStaffProfile.qualifications).toEqual([{ level: "Degree", course: "B.Com", yearOfPassing: 2001 }]);
    expect(out.supportingStaffProfile.nonTechnicalProfile.training).toEqual([{ titleOfTheProgram: "t", nameOfTheFacultyCoordinator: "o" }]);
    expect(out.supportingStaffProfile.nonTechnicalProfile.achievements).toEqual([{ titleOfAward: "a", dateOfAward: "2020-01-01" }]);
  });
});
