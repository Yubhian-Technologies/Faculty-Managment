import { describe, expect, it } from "vitest";
import {
  normalizeRatificationRecords, ratificationRecordsFromDoc, ratifiedDesignationChoices, matchRatifiedDesignation,
  RATIFICATION_STATUS_CHOICES, RATIFICATION_RESULT_CHOICES, ratificationStatusStep, ratificationResultStep,
  isLegacyRatificationStatus, isRatified, ratificationDisplay, blankRatificationRecord,
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

describe("Ratification Status flow", () => {
  it("Status offers Attended first, then Not Yet Attended; Decision offers Ratified / Not Ratified", () => {
    expect([...RATIFICATION_STATUS_CHOICES]).toEqual(["Attended", "Not Yet Attended"]);
    expect([...RATIFICATION_RESULT_CHOICES]).toEqual(["Ratified", "Not Ratified"]);
  });

  // Every combination the two dropdowns can produce -> what is stored, and what each dropdown shows back.
  it.each([
    ["Not Yet Attended", "Not Yet Attended", "",                 false],
    ["Attended",         "Attended",         "",                 false],
    ["Not Ratified",      "Attended",         "Not Ratified",     false],
    ["Ratified",         "Attended",         "Ratified",         true],
  ])("stored %s -> Status %s, Result '%s', details shown: %s", (stored, step, result, details) => {
    expect(ratificationStatusStep(stored)).toBe(step);
    expect(ratificationResultStep(stored)).toBe(result);
    expect(isRatified(stored)).toBe(details);
    expect(isLegacyRatificationStatus(stored)).toBe(false);
  });

  it("any other stored text is never guessed into the new flow: shown as it is, flagged legacy", () => {
    for (const old of ["Not Applicable", "Pending"]) {
      expect(ratificationStatusStep(old)).toBe(old);
      expect(ratificationResultStep(old)).toBe("");
      expect(isRatified(old)).toBe(false);
      expect(isLegacyRatificationStatus(old)).toBe(true);
    }
    expect(isLegacyRatificationStatus("")).toBe(false);
    expect(isLegacyRatificationStatus(undefined)).toBe(false);
  });

  it("displays Status and Result for the view", () => {
    expect(ratificationDisplay("Ratified")).toEqual({ status: "Attended", result: "Ratified" });
    expect(ratificationDisplay("Not Ratified")).toEqual({ status: "Attended", result: "Not Ratified" });
    expect(ratificationDisplay("Attended")).toEqual({ status: "Attended" });
    expect(ratificationDisplay("Not Yet Attended")).toEqual({ status: "Not Yet Attended" });
    expect(ratificationDisplay("Not Applicable")).toEqual({ status: "Not Applicable" });
    expect(ratificationDisplay("")).toEqual({});
  });

  it("import understands the new statuses and still the older ones", () => {
    expect(normalizeRatificationStatus("attended")).toBe("Attended");
    expect(normalizeRatificationStatus("Not Yet Attended")).toBe("Not Yet Attended");
    expect(normalizeRatificationStatus("not  yet attended")).toBe("Not Yet Attended");
    expect(normalizeRatificationStatus("Ratified")).toBe("Ratified");
    expect(normalizeRatificationStatus("Not Ratified")).toBe("Not Ratified");
    expect(normalizeRatificationStatus("pending")).toBe("Not Ratified");
  });

  it("saving Ratified keeps the rows as stored - the designation text is not rewritten", () => {
    const out = buildPersonalDetailsUpdate({
      ratificationStatus: "Ratified",
      ratifications: [{ designation: "ASSISTANT_PROFESSOR", proceedingsNumber: "RP-1", date: "2019-01-01" }],
    });
    expect(out.ratificationStatus).toBe("Ratified");
    expect(out.ratifications).toEqual([{ designation: "ASSISTANT_PROFESSOR", proceedingsNumber: "RP-1", date: "2019-01-01" }]);
  });

  it("switching to Not Yet Attended / Not Ratified with the rows still sent keeps them (hidden, not deleted)", () => {
    const rows = [{ designation: "Professor", proceedingsNumber: "RP-2", date: "2020-02-02" }];
    for (const status of ["Not Yet Attended", "Not Ratified", "Attended"]) {
      expect(buildPersonalDetailsUpdate({ ratificationStatus: status, ratifications: rows }).ratifications).toEqual(rows);
    }
  });

  it("an untouched default blank row is not stored", () => {
    expect(buildPersonalDetailsUpdate({ ratificationStatus: "Ratified", ratifications: [blankRatificationRecord()] }).ratifications).toEqual([]);
  });

  it("a status save without the history array never touches stored ratification rows", () => {
    expect(buildPersonalDetailsUpdate({ ratificationStatus: "Ratified" })).not.toHaveProperty("ratifications");
  });

  it("the single Proceedings Number/Date pair (staff / user records) is cleared for every not-ratified status, and left for Ratified", () => {
    for (const status of ["Not Yet Attended", "Attended", "Not Ratified"]) {
      const out = buildPersonalDetailsUpdate({ ratificationStatus: status });
      expect(out.ratificationProceedingsNumber).toBe("");
      expect(out.ratificationDate).toBe("");
    }
    expect(buildPersonalDetailsUpdate({ ratificationStatus: "Ratified", ratificationProceedingsNumber: "P-1" }).ratificationProceedingsNumber).toBe("P-1");
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
