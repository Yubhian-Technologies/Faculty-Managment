import { describe, expect, it } from "vitest";
import { normalizeRatificationRecords, ratificationRecordsFromDoc } from "./ratificationHistory";

describe("ratificationRecordsFromDoc", () => {
  it("returns the array as-is once a record has been migrated", () => {
    const rows = ratificationRecordsFromDoc({
      ratifications: [{ designation: "Professor", proceedingsNumber: "RP-3", date: "2025-01-01" }],
      // A stale legacy pair left over from before migration must be ignored
      // once the array exists - never merged or double-counted.
      ratificationProceedingsNumber: "STALE",
      ratificationDate: new Date("1999-01-01"),
    });
    expect(rows).toEqual([{ designation: "Professor", proceedingsNumber: "RP-3", date: "2025-01-01" }]);
  });

  it("auto-migrates a legacy flat pair into a single entry with a blank designation", () => {
    const rows = ratificationRecordsFromDoc({
      ratificationProceedingsNumber: "RP-9",
      ratificationDate: new Date("2020-01-01"),
    });
    expect(rows).toEqual([{ designation: "", proceedingsNumber: "RP-9", date: "2020-01-01" }]);
  });

  it("returns an empty list for a record with neither shape", () => {
    expect(ratificationRecordsFromDoc({})).toEqual([]);
  });
});

describe("normalizeRatificationRecords", () => {
  it("trims every field", () => {
    expect(normalizeRatificationRecords([{ designation: " Professor ", proceedingsNumber: " RP-1 ", date: " 2021-01-01 " }]))
      .toEqual([{ designation: "Professor", proceedingsNumber: "RP-1", date: "2021-01-01" }]);
  });

  it("drops a wholly-blank row (e.g. an unfilled Add More row)", () => {
    expect(normalizeRatificationRecords([{ designation: "", proceedingsNumber: "", date: "" }])).toEqual([]);
  });

  it("keeps a partially-filled row rather than silently dropping it", () => {
    expect(normalizeRatificationRecords([{ designation: "Professor" }])).toEqual([{ designation: "Professor", proceedingsNumber: "", date: "" }]);
  });

  it("never emits undefined - safe to spread straight into a Firestore write", () => {
    const rows = normalizeRatificationRecords(undefined);
    expect(rows).toEqual([]);
  });

  it("allows the same designation to appear more than once (unlike Promotion History)", () => {
    const rows = normalizeRatificationRecords([
      { designation: "Assistant Professor", proceedingsNumber: "RP-1", date: "2018-01-01" },
      { designation: "Assistant Professor", proceedingsNumber: "RP-2", date: "2022-01-01" },
    ]);
    expect(rows).toHaveLength(2);
  });
});
