import { describe, expect, it } from "vitest";
import { personalPatchBody, personalRecordFromDoc } from "./personalRecord";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";

// The 7 fields the faculty self-edit page used to drop.
const FORMERLY_MISSING = [
  "motherTongue", "languagesKnown", "heightFeet", "heightInches", "weightKg", "pfNumber",
  "emergencyContactRelation", "ratificationProceedingsNumber",
] as const;

const doc = {
  gender: "Male", legalName: "CHINNAM NAVEENKUMAR", motherTongue: "Telugu", languagesKnown: ["tel", "hindi", "english"],
  heightFeet: 5, heightInches: 6, weightKg: 68, pfNumber: "PF1", emergencyContactRelation: "Spouse",
  ratificationProceedingsNumber: "RP-9", emergencyContactMobileNo: "7013952296", bankAccountNumber: "6769646093",
  passportNo: "P123", permanentAddressSameAsTemporary: false, temporaryAddress: "T", permanentAddress: "P",
};

describe("personalRecordFromDoc", () => {
  it("loads every field the self-edit page used to drop, under the stored key names", () => {
    const rec = personalRecordFromDoc(doc) as Record<string, unknown>;
    expect(rec.motherTongue).toBe("Telugu");
    expect(rec.languagesKnown).toEqual(["tel", "hindi", "english"]);
    expect(rec.heightFeet).toBe(5);
    expect(rec.heightInches).toBe(6);
    expect(rec.weightKg).toBe(68);
    expect(rec.pfNumber).toBe("PF1");
    expect(rec.emergencyContactRelation).toBe("Spouse");
    expect(rec.ratificationProceedingsNumber).toBe("RP-9");
  });

  it("defaults blanks safely for a record that has none of them", () => {
    const rec = personalRecordFromDoc({}) as Record<string, unknown>;
    expect(rec.motherTongue).toBe("");
    expect(rec.languagesKnown).toEqual([]);
    expect(rec.heightFeet).toBeUndefined();
    expect(rec.pfNumber).toBe("");
  });
});

describe("personalPatchBody", () => {
  it("sends every previously-missing field", () => {
    const body = personalPatchBody(personalRecordFromDoc(doc) as never);
    for (const k of FORMERLY_MISSING) expect(body).toHaveProperty(k);
    expect(body.motherTongue).toBe("Telugu");
    expect(body.weightKg).toBe(68);
  });

  it("round-trips: what is loaded is exactly what the server helper writes back", () => {
    const body = personalPatchBody(personalRecordFromDoc(doc) as never);
    const written = buildPersonalDetailsUpdate(body as never);
    for (const k of FORMERLY_MISSING) expect(written[k]).toEqual((doc as Record<string, unknown>)[k]);
    expect(written.bankAccountNumber).toBe("6769646093");
    expect(written.emergencyContactMobileNo).toBe("7013952296");
  });

  it("uses only key names the server accepts (no legacy names)", () => {
    const body = personalPatchBody(personalRecordFromDoc(doc) as never);
    for (const legacy of ["passportNumber", "bankAccountNo", "emergencyContactPhone", "permanentSameAsTemporary"]) {
      expect(body).not.toHaveProperty(legacy);
    }
  });
});
