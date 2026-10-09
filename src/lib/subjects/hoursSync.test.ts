import { describe, expect, it } from "vitest";
import { planHoursSync } from "./hoursSync";

// Shaped after VISHNU WOMEN'S UNIVERSITY: "Programming for Problem Solving"
// carries hoursPerWeek 4 on Mr.ASAPU SATYAMALLESH's BSC-CE-A assignment with 4
// periods placed, while every subject instance says L+T+P = 3.
const DRIFTED = [{ id: "ta-pps", placedPeriods: 4 }];

describe("planHoursSync", () => {
  // The reported bug: renaming a short code sends the same hours back and was
  // refused because an assignment was already over its cap.
  it("never refuses a save that leaves the hours alone", () => {
    expect(planHoursSync(DRIFTED, 3, false)).toEqual({ syncIds: [], blockedIds: [] });
  });

  // ...and does not quietly lower it either, which would leave the timetable
  // over its own cap instead of refusing.
  it("leaves an over-placed assignment untouched when the hours are unchanged", () => {
    const plan = planHoursSync([...DRIFTED, { id: "ta-ok", placedPeriods: 2 }], 3, false);
    expect(plan.syncIds).toEqual(["ta-ok"]);
    expect(plan.blockedIds).toEqual([]);
  });

  // The case the refusal exists for is untouched.
  it("refuses when this save actually lowers the hours past placed periods", () => {
    expect(planHoursSync(DRIFTED, 3, true)).toEqual({ syncIds: [], blockedIds: ["ta-pps"] });
  });

  it("syncs everything when a changed hours figure still covers every assignment", () => {
    const plan = planHoursSync([{ id: "a", placedPeriods: 4 }, { id: "b", placedPeriods: 1 }], 4, true);
    expect(plan.syncIds).toEqual(["a", "b"]);
    expect(plan.blockedIds).toEqual([]);
  });

  // Exactly at the cap is not over it.
  it("treats placed periods equal to the hours as within the cap", () => {
    expect(planHoursSync([{ id: "a", placedPeriods: 3 }], 3, true).blockedIds).toEqual([]);
  });

  it("refuses over every over-placed assignment, not just the first", () => {
    const plan = planHoursSync(
      [{ id: "a", placedPeriods: 6 }, { id: "b", placedPeriods: 1 }, { id: "c", placedPeriods: 4 }],
      2,
      true
    );
    expect(plan.blockedIds).toEqual(["a", "c"]);
    expect(plan.syncIds).toEqual([]);
  });

  it("does nothing with nothing", () => {
    expect(planHoursSync([], 3, true)).toEqual({ syncIds: [], blockedIds: [] });
    expect(planHoursSync([], 3, false)).toEqual({ syncIds: [], blockedIds: [] });
  });
});
