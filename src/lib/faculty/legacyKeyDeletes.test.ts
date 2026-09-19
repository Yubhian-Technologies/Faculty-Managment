import { describe, expect, it } from "vitest";
import { withLegacyPersonalKeysDeleted, withLegacyFacultyKeysDeleted } from "./legacyKeyDeletes";

const DEL = Symbol("delete");

describe("withLegacyFacultyKeysDeleted", () => {
  it("marks the old twin of every new key being written for deletion", () => {
    const out = withLegacyFacultyKeysDeleted(
      { highestQualification: "PhD", totalYearsOfExperience: 4, passportNo: "P1", bankName: "SBI" },
      DEL,
    );
    expect(out).toEqual({
      highestQualification: "PhD", totalYearsOfExperience: 4, passportNo: "P1", bankName: "SBI",
      qualification: DEL, experienceYears: DEL, passportNumber: DEL,
    });
  });

  it("leaves an old key alone when its replacement is not part of the write", () => {
    const out = withLegacyFacultyKeysDeleted({ bankName: "SBI" }, DEL);
    expect(out).toEqual({ bankName: "SBI" });
  });

  it("does not mutate its input", () => {
    const input = { passportNo: "P" };
    withLegacyFacultyKeysDeleted(input, DEL);
    expect(input).toEqual({ passportNo: "P" });
  });
});

describe("withLegacyPersonalKeysDeleted", () => {
  it("only covers the flat personal keys, never qualification/experienceYears", () => {
    const out = withLegacyPersonalKeysDeleted(
      { permanentAddressSameAsTemporary: true, emergencyContactMobileNo: "9", bankAccountNumber: "1", highestQualification: "x" },
      DEL,
    );
    expect(out).toEqual({
      permanentAddressSameAsTemporary: true, emergencyContactMobileNo: "9", bankAccountNumber: "1", highestQualification: "x",
      permanentSameAsTemporary: DEL, emergencyContactPhone: DEL, bankAccountNo: DEL,
    });
  });
});
