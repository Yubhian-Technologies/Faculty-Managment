import { describe, expect, it } from "vitest";
import {
  normalizeRatificationRecords, ratificationRecordsFromDoc, ratifiedDesignationChoices, matchRatifiedDesignation,
  RATIFICATION_STATUS_CHOICES,
} from "./ratificationHistory";
import { buildPersonalDetailsUpdate, normalizeRatificationStatus } from "@/lib/firestore/personalDetails";

describe("Ratified Designation choices", () => {
  const labels = (names: string[]) => ratifiedDesignationChoices(names).map((c) => c.label);

  it("shows the catalogue's three cadre designations by full name and adds Principal after them", () => {
    expect(labels(["Professor", "Assistant Professor", "Associate Professor", "Lecturer", "HOD"]))
      .toEqual(["Professor", "Assistant Professor", "Associate Professor", "Principal"]);
    expect(ratifiedDesignationChoices(["Professor"]).at(-1)).toEqual({ value: "Principal", label: "Principal" });
  });

  it("stores the catalogue's own spelling (legacy codes included) and shows its full name, Principal once", () => {
    const c = ratifiedDesignationChoices(["PROFESSOR", "ASSISTANT_PROFESSOR", "ASSOCIATE_PROFESSOR", "Principal"]);
    expect(c.map((x) => x.value)).toEqual(["PROFESSOR", "ASSISTANT_PROFESSOR", "ASSOCIATE_PROFESSOR", "Principal"]);
    expect(c.map((x) => x.label)).toEqual(["Professor", "Assistant Professor", "Associate Professor", "Principal"]);
  });

  it("always offers Principal, even while the catalogue is loading or fails", () => {
    expect(labels([])).toEqual(["Principal"]);
  });

  it("matches a stored value to its choice by meaning, not spelling", () => {
    const c = ratifiedDesignationChoices(["PROFESSOR", "ASSISTANT_PROFESSOR"]);
    expect(matchRatifiedDesignation("Assistant Professor", c)).toBe("ASSISTANT_PROFESSOR");
    expect(matchRatifiedDesignation("principal", c)).toBe("Principal");
    expect(matchRatifiedDesignation("Lecturer", c)).toBeUndefined();
    expect(matchRatifiedDesignation("", c)).toBeUndefined();
  });
});

describe("Ratification Status", () => {
  it("offers Attended and Ratified", () => {
    expect([...RATIFICATION_STATUS_CHOICES]).toEqual(["Attended", "Ratified"]);
  });

  it("normalizes Attended, and still understands the older Not Ratified", () => {
    expect(normalizeRatificationStatus("attended")).toBe("Attended");
    expect(normalizeRatificationStatus("Ratified")).toBe("Ratified");
    expect(normalizeRatificationStatus("Not Ratified")).toBe("Not Ratified");
  });

  it("saving a record that already holds an array with Ratified keeps its rows untouched", () => {
    const out = buildPersonalDetailsUpdate({
      ratificationStatus: "Ratified",
      ratifications: [{ designation: "ASSISTANT_PROFESSOR", proceedingsNumber: "RP-1", date: "2019-01-01" }],
    });
    expect(out.ratificationStatus).toBe("Ratified");
    // The stored designation text is not rewritten just because the picker shows a short label.
    expect(out.ratifications).toEqual([{ designation: "ASSISTANT_PROFESSOR", proceedingsNumber: "RP-1", date: "2019-01-01" }]);
  });

  it("an untouched default blank row is not stored", () => {
    const out = buildPersonalDetailsUpdate({ ratificationStatus: "Ratified", ratifications: [{ designation: "", proceedingsNumber: "", date: "" }] });
    expect(out.ratifications).toEqual([]);
  });

  it("a status save without the history array never touches stored ratification rows", () => {
    expect(buildPersonalDetailsUpdate({ ratificationStatus: "Ratified" })).not.toHaveProperty("ratifications");
  });
});

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
