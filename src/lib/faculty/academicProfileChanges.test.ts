import { describe, expect, it } from "vitest";
import {
  academicProfileFirestoreUpdates, applyAcademicProfileChanges, diffAcademicProfile, isEmptyChanges,
  parseAcademicProfileChanges, touchesTrainingEntries, withoutAcademicProfileKeys,
} from "./academicProfileChanges";

const DELETE = Symbol("delete");

const profile = {
  highestQualification: "Ph.D",
  ugDetails: { course: "B.Tech", yearOfPassing: 2000 },
  academicExperience: [{ institutionName: "A", designation: "Lecturer" }],
  fdpsWorkshopsMoocsCertifications: [{ titleOfTheProgram: "FDP" }],
  monthlySalary: 50000,
  orcidId: "0000-1",
};

describe("diffAcademicProfile", () => {
  it("is empty when nothing changed, ignoring key order", () => {
    const reordered = { orcidId: "0000-1", monthlySalary: 50000, ugDetails: { yearOfPassing: 2000, course: "B.Tech" }, highestQualification: "Ph.D",
      academicExperience: [{ designation: "Lecturer", institutionName: "A" }], fdpsWorkshopsMoocsCertifications: [{ titleOfTheProgram: "FDP" }] };
    expect(isEmptyChanges(diffAcademicProfile(profile, reordered))).toBe(true);
  });

  it("only reports the section that was edited", () => {
    const edited = { ...profile, academicExperience: [{ institutionName: "A", designation: "Professor" }] };
    const diff = diffAcademicProfile(profile, edited);
    expect(Object.keys(diff.set)).toEqual(["academicExperience"]);
    expect(diff.remove).toEqual([]);
  });

  it("reports added and removed keys", () => {
    const { orcidId: _o, ...withoutOrcid } = profile;
    void _o;
    const diff = diffAcademicProfile(withoutOrcid, { ...withoutOrcid, otherInformation: "x" });
    expect(diff.set).toEqual({ otherInformation: "x" });
    const removed = diffAcademicProfile(profile, withoutOrcid);
    expect(removed.remove).toEqual(["orcidId"]);
  });

  it("treats an explicit undefined like a missing key", () => {
    expect(isEmptyChanges(diffAcademicProfile({ a: undefined }, {}))).toBe(true);
  });
});

describe("parseAcademicProfileChanges", () => {
  it("accepts a well-formed body and defaults the missing halves", () => {
    expect(parseAcademicProfileChanges({ set: { a: 1 } })).toEqual({ set: { a: 1 }, remove: [] });
    expect(parseAcademicProfileChanges({ remove: ["a"] })).toEqual({ set: {}, remove: ["a"] });
  });
  it("rejects malformed input and dotted / odd keys", () => {
    expect(parseAcademicProfileChanges(null)).toBeNull();
    expect(parseAcademicProfileChanges([])).toBeNull();
    expect(parseAcademicProfileChanges({ set: [] })).toBeNull();
    expect(parseAcademicProfileChanges({ remove: "a" })).toBeNull();
    expect(parseAcademicProfileChanges({ set: { "a.b": 1 } })).toBeNull();
    expect(parseAcademicProfileChanges({ remove: ["a.b"] })).toBeNull();
    expect(parseAcademicProfileChanges({ remove: [1] })).toBeNull();
  });
});

describe("academicProfileFirestoreUpdates", () => {
  it("writes one dot-path per changed key and nothing else", () => {
    const updates = academicProfileFirestoreUpdates(profile, { set: { academicExperience: [{ institutionName: "B" }] }, remove: [] }, DELETE);
    expect(Object.keys(updates)).toEqual(["academicProfile.academicExperience"]);
  });

  it("editing Experience never touches Qualification, Professional Development, financial or research keys", () => {
    const edited = { ...profile, academicExperience: [{ institutionName: "Z" }] };
    const updates = academicProfileFirestoreUpdates(profile, diffAcademicProfile(profile, edited), DELETE);
    const keys = Object.keys(updates);
    for (const other of ["ugDetails", "highestQualification", "fdpsWorkshopsMoocsCertifications", "monthlySalary", "orcidId"]) {
      expect(keys).not.toContain(`academicProfile.${other}`);
    }
  });

  it("uses the delete sentinel for removed keys", () => {
    expect(academicProfileFirestoreUpdates(profile, { set: {}, remove: ["otherInformation"] }, DELETE)).toEqual({ "academicProfile.otherInformation": DELETE });
  });

  it("deletes the old-named twin on an un-migrated doc when writing the new key", () => {
    const stored = { trainingEntries: [{ title: "old" }], previousInstitutions: [{ institutionName: "old" }] };
    const updates = academicProfileFirestoreUpdates(stored, { set: { fdpsWorkshopsMoocsCertifications: [{ titleOfTheProgram: "new" }] }, remove: [] }, DELETE);
    expect(updates["academicProfile.fdpsWorkshopsMoocsCertifications"]).toEqual([{ titleOfTheProgram: "new" }]);
    expect(updates["academicProfile.trainingEntries"]).toBe(DELETE);
    expect("academicProfile.previousInstitutions" in updates).toBe(false);
  });

  it("lifts legacy key names sent by an older client", () => {
    const updates = academicProfileFirestoreUpdates({}, { set: { trainingEntries: [{ title: "t" }] }, remove: [] }, DELETE);
    expect(updates["academicProfile.fdpsWorkshopsMoocsCertifications"]).toEqual([{ titleOfTheProgram: "t" }]);
    expect("academicProfile.trainingEntries" in updates).toBe(false);
  });

  it("deletes a legacy shared role field only once an entry being written carries its text", () => {
    const stored = { teachingRolesResponsibilities: "old", teachingAssignment: { primaryTeachingRole: "old", courses: [] } };
    const carried = academicProfileFirestoreUpdates(stored, { set: { academicExperience: [{ institutionName: "A", rolesResponsibilities: "old" }] }, remove: [] }, DELETE);
    expect(carried["academicProfile.teachingRolesResponsibilities"]).toBe(DELETE);
    expect(carried["academicProfile.teachingAssignment.primaryTeachingRole"]).toBe(DELETE);
    // A write that dropped the text (stale client) must not delete the only copy.
    const dropped = academicProfileFirestoreUpdates(stored, { set: { academicExperience: [{ institutionName: "A" }] }, remove: [] }, DELETE);
    expect("academicProfile.teachingRolesResponsibilities" in dropped).toBe(false);
    expect("academicProfile.teachingAssignment.primaryTeachingRole" in dropped).toBe(false);
  });

  it("skips the nested legacy path when teachingAssignment itself is rewritten (parent/child conflict)", () => {
    const stored = { teachingAssignment: { primaryTeachingRole: "old", courses: [] } };
    const b = academicProfileFirestoreUpdates(stored, { set: { academicExperience: [{ rolesResponsibilities: "old" }], teachingAssignment: { courses: [] } }, remove: [] }, DELETE);
    expect("academicProfile.teachingAssignment.primaryTeachingRole" in b).toBe(false);
  });
});

describe("applyAcademicProfileChanges", () => {
  it("returns the stored profile with only the change applied", () => {
    const out = applyAcademicProfileChanges(profile, { set: { academicExperience: [{ institutionName: "B" }] }, remove: ["orcidId"] });
    expect(out.academicExperience).toEqual([{ institutionName: "B" }]);
    expect(out.ugDetails).toEqual(profile.ugDetails);
    expect(out.monthlySalary).toBe(50000);
    expect("orcidId" in out).toBe(false);
  });
  it("normalizes an old-shaped stored profile first", () => {
    const out = applyAcademicProfileChanges({ previousInstitutions: [{ institutionName: "old" }] }, { set: {}, remove: [] });
    expect(out.academicExperience).toEqual([{ institutionName: "old" }]);
  });
  it("handles a missing stored profile", () => {
    expect(applyAcademicProfileChanges(undefined, { set: { a: 1 }, remove: [] })).toEqual({ a: 1 });
  });
});

describe("withoutAcademicProfileKeys / touchesTrainingEntries", () => {
  it("drops blocked keys from set and remove", () => {
    const out = withoutAcademicProfileKeys({ set: { monthlySalary: 1, ugDetails: {} }, remove: ["orcidId", "hIndex"] }, ["monthlySalary", "orcidId"]);
    expect(out).toEqual({ set: { ugDetails: {} }, remove: ["hIndex"] });
  });
  it("detects a training-list change, including by legacy name", () => {
    expect(touchesTrainingEntries({ set: { fdpsWorkshopsMoocsCertifications: [] }, remove: [] })).toBe(true);
    expect(touchesTrainingEntries({ set: { trainingEntries: [] }, remove: [] })).toBe(true);
    expect(touchesTrainingEntries({ set: { ugDetails: {} }, remove: [] })).toBe(false);
  });
});
