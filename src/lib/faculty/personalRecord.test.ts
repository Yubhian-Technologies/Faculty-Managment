import { describe, expect, it } from "vitest";
import { personalPatchBody, personalRecordFromDoc } from "./personalRecord";
import { buildPersonalDetailsUpdate } from "@/lib/firestore/personalDetails";

// The 7 fields the faculty self-edit page used to drop.
const FORMERLY_MISSING = [
  "motherTongue", "languagesKnown", "height", "weightKg", "pfNumber",
  "emergencyContactRelation", "ratificationProceedingsNumber",
] as const;

const doc = {
  gender: "Male", legalName: "CHINNAM NAVEENKUMAR", motherTongue: "Telugu", languagesKnown: ["tel", "hindi", "english"],
  height: "5.6", weightKg: 68, pfNumber: "PF1", emergencyContactRelation: "Spouse",
  ratificationProceedingsNumber: "RP-9", emergencyContactMobileNo: "7013952296", bankAccountNumber: "6769646093",
  passportNo: "P123", permanentAddressSameAsTemporary: false, temporaryAddress: "T", permanentAddress: "P",
};

describe("personalRecordFromDoc", () => {
  it("loads every field the self-edit page used to drop, under the stored key names", () => {
    const rec = personalRecordFromDoc(doc) as Record<string, unknown>;
    expect(rec.motherTongue).toBe("Telugu");
    expect(rec.languagesKnown).toEqual(["tel", "hindi", "english"]);
    expect(rec.height).toBe("5.6");
    expect(rec.weightKg).toBe(68);
    expect(rec.pfNumber).toBe("PF1");
    expect(rec.emergencyContactRelation).toBe("Spouse");
    expect(rec.ratificationProceedingsNumber).toBe("RP-9");
  });

  it("defaults blanks safely for a record that has none of them", () => {
    const rec = personalRecordFromDoc({}) as Record<string, unknown>;
    expect(rec.motherTongue).toBe("");
    expect(rec.languagesKnown).toEqual([]);
    expect(rec.height).toBe("");
    expect(rec.pfNumber).toBe("");
  });
});

describe("personalRecordFromDoc with ratificationHistory", () => {
  it("auto-migrates a legacy flat ratification into a single entry with a blank designation", () => {
    const rec = personalRecordFromDoc(
      { ratificationProceedingsNumber: "RP-9", ratificationDate: new Date("2020-01-01") },
      { ratificationHistory: true }
    ) as Record<string, unknown>;
    expect(rec.ratifications).toEqual([{ designation: "", proceedingsNumber: "RP-9", date: "2020-01-01" }]);
    expect(rec.ratificationProceedingsNumber).toBeUndefined();
  });

  it("reads the array shape as-is once a record has been migrated", () => {
    const rec = personalRecordFromDoc(
      { ratifications: [{ designation: "Assistant Professor", proceedingsNumber: "RP-1", date: "2021-06-01" }] },
      { ratificationHistory: true }
    ) as Record<string, unknown>;
    expect(rec.ratifications).toEqual([{ designation: "Assistant Professor", proceedingsNumber: "RP-1", date: "2021-06-01" }]);
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

  it("with ratificationHistory, normalizes and sends `ratifications` instead of the legacy flat pair", () => {
    const body = personalPatchBody(
      { ratifications: [{ designation: "Assistant Professor", proceedingsNumber: " RP-1 ", date: "2021-06-01" }] } as never,
      { ratificationHistory: true }
    );
    expect(body.ratifications).toEqual([{ designation: "Assistant Professor", proceedingsNumber: "RP-1", date: "2021-06-01" }]);
    expect(body).not.toHaveProperty("ratificationProceedingsNumber");
    expect(body).not.toHaveProperty("ratificationDate");
  });
});
