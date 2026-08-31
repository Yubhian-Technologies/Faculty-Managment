import { describe, expect, it } from "vitest";
import { deriveBatch, regulationsForBatchStartYear, regulationsForCourseYearByBatch, sectionBatchIntakeYears } from "./academicSession";

describe("sectionBatchIntakeYears", () => {
  it("returns one intake ahead, the center, then the last four - newest first", () => {
    expect(sectionBatchIntakeYears(2026)).toEqual([2027, 2026, 2025, 2024, 2023, 2022]);
  });

  it("maps through deriveBatch to the widened B.Tech (4yr) label set", () => {
    const labels = sectionBatchIntakeYears(2026).map((y) => deriveBatch(y, 4));
    expect(labels).toEqual([
      "2027-2031", "2026-2030", "2025-2029", "2024-2028", "2023-2027", "2022-2026",
    ]);
  });

  it("respects the course's own duration for a 2yr M.Tech", () => {
    const labels = sectionBatchIntakeYears(2026).map((y) => deriveBatch(y, 2));
    expect(labels).toEqual([
      "2027-2029", "2026-2028", "2025-2027", "2024-2026", "2023-2025", "2022-2024",
    ]);
  });
});

describe("regulationsForCourseYearByBatch", () => {
  it("matches a regulation whose batch start lands on the requested course-year", () => {
    // asOfStartYear 2026, Year 1 -> admission year 2026.
    expect(regulationsForCourseYearByBatch({ R23: "2026-2030" }, 1, 2026)).toEqual(["R23"]);
  });

  it("returns nothing when no batch covers the requested course-year", () => {
    expect(regulationsForCourseYearByBatch({ R23: "2024-2028" }, 1, 2026)).toEqual([]);
  });

  it("falls back to the plain regulations list when regulationBatches is empty entirely", () => {
    // The pre-migration Course Catalog model (Principal-owned, before the
    // Dean-owned regulationBatches field existed) had no per-year narrowing -
    // a catalog entry that predates the migration and was never backfilled
    // must still resolve to its assigned regulations, not to nothing (this is
    // exactly the "R23 isn't offered for Year 1" false negative).
    expect(regulationsForCourseYearByBatch({}, 1, 2026, ["R23"])).toEqual(["R23"]);
  });

  it("does NOT fall back once at least one regulation has real batch coverage", () => {
    // A partially-migrated entry (one regulation backfilled, another not)
    // should narrow by year rather than silently reverting to "offered every
    // year" for the whole list.
    expect(regulationsForCourseYearByBatch({ R20: "2022-2026" }, 1, 2026, ["R20", "R23"])).toEqual([]);
  });
});

describe("regulationsForBatchStartYear", () => {
  // The Dean's actual VISHNU INSTITUTE OF TECHNOLOGY configuration: R23
  // covers the 2023/2024/2025 intakes, R26 covers 2026/2027/2028.
  const VIT_BTECH_BATCHES = {
    R23: "2023-2027,2024-2028,2025-2029",
    R26: "2026-2030,2027-2031,2028-2032",
  };

  it("resolves the regulation directly from the batch's own start year, independent of any session", () => {
    expect(regulationsForBatchStartYear(VIT_BTECH_BATCHES, 2024)).toEqual(["R23"]);
    expect(regulationsForBatchStartYear(VIT_BTECH_BATCHES, 2026)).toEqual(["R26"]);
  });

  it("switches regulation the instant a different batch is picked - no year/session in the loop", () => {
    // This is the actual bug report: picking Batch 2024-2028 must offer only
    // R23, and picking 2026-2030 must offer only R26, regardless of which
    // ordinal Year the section sits in or what the college's current session
    // pin says.
    const forBatch = (batch: string) => regulationsForBatchStartYear(VIT_BTECH_BATCHES, Number(batch.slice(0, 4)));
    expect(forBatch("2024-2028")).toEqual(["R23"]);
    expect(forBatch("2026-2030")).toEqual(["R26"]);
  });

  it("returns nothing for a batch start year no regulation covers", () => {
    expect(regulationsForBatchStartYear(VIT_BTECH_BATCHES, 2030)).toEqual([]);
  });

  it("falls back to the plain regulations list when regulationBatches is empty entirely", () => {
    expect(regulationsForBatchStartYear({}, 2024, ["R23"])).toEqual(["R23"]);
  });
});
