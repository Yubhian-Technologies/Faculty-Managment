import { describe, expect, it } from "vitest";
import {
  academicSessionLabel, academicYearLongLabel, currentTimetableAcademicYear, deriveBatch,
  lateralEntryBatch, matchesCurrentAcademicYear, parseAcademicYearStart, regulationsForBatchStartYear,
  regulationsForCourseYearByBatch, resolveCurrentAcademicYear, resolveTimetableAcademicYear,
  sectionBatchIntakeYears,
} from "./academicSession";

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
    // Academics-owned regulationBatches field existed) had no per-year narrowing -
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
  // The Academics' actual VISHNU INSTITUTE OF TECHNOLOGY configuration: R23
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

// ─── Session labels ──────────────────────────────────────────────────────────
// A session is written short ("2025-26") as AcademicSession.label and long
// ("2025-2026") as CourseAcademicYear.label. Everything that reads one and
// emits the other goes through the three functions below, so a wrong shape
// here silently mis-stamps every timetable slot and teaching assignment.

describe("academicSessionLabel / academicYearLongLabel", () => {
  it("writes the short and long form of the same year", () => {
    expect(academicSessionLabel(2025)).toBe("2025-26");
    expect(academicYearLongLabel(2025)).toBe("2025-2026");
  });

  it("pads a single-digit end year in the short form", () => {
    expect(academicSessionLabel(2008)).toBe("2008-09");
  });

  it("rolls the century over as 00, not 100", () => {
    expect(academicSessionLabel(2099)).toBe("2099-00");
  });
});

describe("parseAcademicYearStart", () => {
  it("reads the start year out of either shape", () => {
    expect(parseAcademicYearStart("2025-26")).toBe(2025);
    expect(parseAcademicYearStart("2025-2026")).toBe(2025);
  });

  it("tolerates surrounding and inner whitespace", () => {
    expect(parseAcademicYearStart("  2025 - 26 ")).toBe(2025);
  });

  // This is the one that matters. POST /api/college/academic-sessions never
  // validates the label, so a Principal can save free text - and every
  // consumer then falls back to date math without saying so. Anything that
  // is not a year range must come back undefined rather than be mistaken for
  // a session.
  it("returns undefined for anything that is not a year range", () => {
    for (const junk of ["", "   ", "hello", "2025", "25-26", "2025-267", "2025/26", "20a5-26"]) {
      expect(parseAcademicYearStart(junk)).toBeUndefined();
    }
    expect(parseAcademicYearStart(null)).toBeUndefined();
    expect(parseAcademicYearStart(undefined)).toBeUndefined();
  });
});

describe("resolveTimetableAcademicYear", () => {
  // Deliberately fixed dates - the April cutoff is the whole point.
  const inApril = new Date(2026, 3, 1);
  const inMarch = new Date(2026, 2, 31);

  it("uses the stored current session when one is set", () => {
    expect(resolveTimetableAcademicYear("2024-25", inApril)).toBe("2024-25");
    expect(resolveTimetableAcademicYear("2024-2025", inApril)).toBe("2024-25");
  });

  it("falls back to the clock when no session is stored", () => {
    expect(resolveTimetableAcademicYear(null, inApril)).toBe("2026-27");
    expect(resolveTimetableAcademicYear(undefined, inMarch)).toBe("2025-26");
  });

  // A junk label is NOT a session, so it must fall through to the clock
  // rather than be echoed back as one.
  it("falls back to the clock for an unparseable stored label", () => {
    expect(resolveTimetableAcademicYear("whatever", inApril)).toBe("2026-27");
  });
});

describe("currentTimetableAcademicYear", () => {
  it("starts the session in April, not January", () => {
    expect(currentTimetableAcademicYear(new Date(2026, 3, 1))).toBe("2026-27");
    expect(currentTimetableAcademicYear(new Date(2026, 2, 31))).toBe("2025-26");
    expect(currentTimetableAcademicYear(new Date(2026, 0, 15))).toBe("2025-26");
  });
});

describe("resolveCurrentAcademicYear", () => {
  it("returns the long form of the stored session", () => {
    expect(resolveCurrentAcademicYear("2025-26")).toBe("2025-2026");
    expect(resolveCurrentAcademicYear("2025-2026")).toBe("2025-2026");
  });
});

describe("matchesCurrentAcademicYear", () => {
  it("matches an item stamped with the current session", () => {
    expect(matchesCurrentAcademicYear("2026-27", "2026-27")).toBe(true);
  });

  it("rejects an item from a different session", () => {
    expect(matchesCurrentAcademicYear("2025-26", "2026-27")).toBe(false);
  });

  // DELIBERATE, and worth keeping visible: an item with no academicYear always
  // matches, so records written before the field existed are not silently
  // hidden. The cost is that a slot left unstamped follows the college into
  // every future session - which, combined with the unvalidated session label
  // above, is how a previous cohort's timetable can still surface. Changing
  // this is a data-migration decision, not a code tidy-up.
  it("treats an unstamped item as a match", () => {
    expect(matchesCurrentAcademicYear(null, "2026-27")).toBe(true);
    expect(matchesCurrentAcademicYear(undefined, "2026-27")).toBe(true);
  });
});

describe("lateralEntryBatch", () => {
  // A lateral entrant joins in year 2 but graduates with the cohort, so they
  // keep the cohort's end year and start a year later.
  it("keeps the cohort graduation year and moves the start year up", () => {
    expect(lateralEntryBatch("2024-2028", 2025)).toBe("2025-2028");
  });

  it("returns null when the batch has no graduation year to keep", () => {
    expect(lateralEntryBatch("not-a-batch", 2025)).toBeNull();
  });
});
