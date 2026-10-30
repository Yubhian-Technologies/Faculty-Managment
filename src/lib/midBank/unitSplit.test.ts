import { describe, expect, it } from "vitest";
import { cleanMidMap, midUnitsFor, suggestedSplit } from "./unitSplit";

const rules = { mids: { "1": [1, 2, 3], "2": [3, 4, 5] }, unitSplits: { "6": { "1": [1, 2, 3], "2": [4, 5, 6] }, "4": { "1": [1, 2], "2": [3, 4] } } };

describe("units of a Mid for a subject", () => {
  it("the subject's exception, else the split for its unit count, else the default", () => {
    expect(midUnitsFor(rules, 2, 6)).toEqual({ units: [4, 5, 6], source: "UNIT_COUNT" });
    expect(midUnitsFor(rules, 2, 4)).toEqual({ units: [3, 4], source: "UNIT_COUNT" });
    expect(midUnitsFor(rules, 2, 5)).toEqual({ units: [3, 4, 5], source: "DEFAULT" });
    expect(midUnitsFor(rules, 2, null)).toEqual({ units: [3, 4, 5], source: "DEFAULT" }); // units not entered yet
    expect(midUnitsFor(rules, 1, 6, { "1": [1, 2] })).toEqual({ units: [1, 2], source: "SUBJECT" });
    expect(midUnitsFor(rules, 2, 6, { "1": [1, 2] })).toEqual({ units: [4, 5, 6], source: "UNIT_COUNT" }); // exception names only Mid 1
    expect(midUnitsFor(null, 1, 5).source).toBe("NONE");
  });

  it("suggested splits: an odd count shares its middle unit", () => {
    expect(suggestedSplit(5)).toEqual({ "1": [1, 2, 3], "2": [3, 4, 5] });
    expect(suggestedSplit(6)).toEqual({ "1": [1, 2, 3], "2": [4, 5, 6] });
    expect(suggestedSplit(4)).toEqual({ "1": [1, 2], "2": [3, 4] });
  });

  it("form maps: units within the count", () => {
    expect(cleanMidMap({ "1": [1, 2, 2], "2": [] }, 5)).toEqual({ value: { "1": [1, 2] }, error: "" });
    expect(cleanMidMap({ "2": [4, 6] }, 5).error).toBe("Mid 2: units must be numbers from 1 to 5");
  });
});
