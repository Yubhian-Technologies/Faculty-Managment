import { describe, expect, it } from "vitest";
import { findSubstituteConflicts, describeSubstituteConflict } from "./availability";
import type { SubstitutePick } from "./availability";

// One person cannot teach two classes in the same period. The per-period
// candidate list already keeps out anyone teaching then, on leave, or covering
// that slot for another request - what it could not see was the picks in a
// single submission colliding with EACH OTHER, because each period resolves
// its candidates independently and the caller de-duplicated on
// `date|timetableSlotId`, which two periods sharing a slot time do not share.

const pick = (facultyId: string, periodNumber: number, date = "2026-09-01"): SubstitutePick => ({
  substituteFacultyId: facultyId,
  substituteFacultyName: facultyId.toUpperCase(),
  date,
  periodNumber,
  subjectName: `Subject P${periodNumber}`,
});

describe("findSubstituteConflicts", () => {
  it("finds nothing in an empty submission", () => {
    expect(findSubstituteConflicts([])).toEqual([]);
  });

  it("allows one person across DIFFERENT periods on the same day", () => {
    expect(findSubstituteConflicts([pick("ravi", 1), pick("ravi", 2), pick("ravi", 5)])).toEqual([]);
  });

  it("allows one person in the same period on DIFFERENT days", () => {
    expect(
      findSubstituteConflicts([pick("ravi", 3, "2026-09-01"), pick("ravi", 3, "2026-09-02")])
    ).toEqual([]);
  });

  it("allows DIFFERENT people in the same period", () => {
    expect(findSubstituteConflicts([pick("ravi", 3), pick("pradeep", 3)])).toEqual([]);
  });

  // The regression guard: two timetable slots can share a (date, periodNumber)
  // - merged sections, an elective split, a lab against a theory class - and
  // both offer the same free person.
  it("catches one person picked twice for the same date and period", () => {
    const out = findSubstituteConflicts([pick("ravi", 1), pick("ravi", 3), pick("ravi", 1)]);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("DUPLICATE_IN_SUBMISSION");
    expect(out[0].substituteFacultyId).toBe("ravi");
    expect(out[0].periodNumber).toBe(1);
  });

  it("reports every colliding pick, not just the first pair", () => {
    const out = findSubstituteConflicts([pick("ravi", 1), pick("ravi", 1), pick("ravi", 1)]);
    expect(out).toHaveLength(2);
  });

  describe("with live coverage (the acceptance path)", () => {
    // Stands in for Unavailability.isCoveringAt - ravi already covers period 2
    // on the 1st for some OTHER request.
    const isCoveringAt = (facultyId: string, dateISO: string, periodNumber: number) =>
      facultyId === "ravi" && dateISO === "2026-09-01" && periodNumber === 2;

    it("catches a pick another request already took", () => {
      const out = findSubstituteConflicts([pick("ravi", 2)], { isCoveringAt });
      expect(out).toHaveLength(1);
      expect(out[0].reason).toBe("ALREADY_COVERING");
    });

    it("leaves the same person's other periods alone", () => {
      expect(findSubstituteConflicts([pick("ravi", 1), pick("ravi", 4)], { isCoveringAt })).toEqual([]);
    });

    it("leaves other people in that period alone", () => {
      expect(findSubstituteConflicts([pick("pradeep", 2)], { isCoveringAt })).toEqual([]);
    });

    // Without the check passed in, only the duplicate half runs - which is what
    // validatePeriodSubstitutions relies on, since the candidate list has
    // already enforced the other half one step earlier.
    it("skips the live check entirely when no checker is given", () => {
      expect(findSubstituteConflicts([pick("ravi", 2)])).toEqual([]);
    });
  });
});

describe("describeSubstituteConflict", () => {
  it("tells a duplicate apart from a clash with another request", () => {
    const dup = describeSubstituteConflict({ ...pick("ravi", 1), reason: "DUPLICATE_IN_SUBMISSION" });
    const taken = describeSubstituteConflict({ ...pick("ravi", 1), reason: "ALREADY_COVERING" });
    expect(dup).toContain("picked twice");
    expect(taken).toContain("another request");
    // Both have to say who, when and which class, or the person reading it
    // cannot act on it.
    for (const msg of [dup, taken]) {
      expect(msg).toContain("RAVI");
      expect(msg).toContain("2026-09-01");
      expect(msg).toContain("period 1");
    }
  });

  it("still reads sensibly with no name or subject", () => {
    const msg = describeSubstituteConflict({
      substituteFacultyId: "f1", date: "2026-09-01", periodNumber: 2, reason: "DUPLICATE_IN_SUBMISSION",
    });
    expect(msg).toContain("That faculty member");
    expect(msg).not.toContain("undefined");
  });
});
