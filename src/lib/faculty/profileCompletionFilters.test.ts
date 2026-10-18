import { describe, expect, it } from "vitest";
import {
  NO_COMPLETION_FILTERS, completionDesignationOptions, filterCompletionRows, hasActiveCompletionFilters, isPercentRangeBackwards, parsePercent,
} from "./profileCompletionFilters";

const rows = [
  { id: "a", designation: "Professor", overallPercent: 17 },
  { id: "b", designation: "ASSISTANT_PROFESSOR", overallPercent: 38 },
  { id: "c", designation: "Assistant Professor", overallPercent: 53 },
  { id: "d", designation: "Associate Professor", overallPercent: 100 },
  { id: "e", designation: undefined, overallPercent: 0 },
];
const ids = (r: { id: string }[]) => r.map((x) => x.id);

describe("parsePercent", () => {
  it("reads what was typed, clamps to 0-100, and ignores blanks / junk", () => {
    expect(parsePercent("40")).toBe(40);
    expect(parsePercent(" 12.5 ")).toBe(12.5);
    expect(parsePercent("150")).toBe(100);
    expect(parsePercent("-5")).toBe(0);
    expect(parsePercent("")).toBeNull();
    expect(parsePercent("abc")).toBeNull();
  });
});

describe("filterCompletionRows", () => {
  it("no filters = every row, untouched", () => {
    expect(filterCompletionRows(rows, NO_COMPLETION_FILTERS)).toEqual(rows);
    expect(hasActiveCompletionFilters(NO_COMPLETION_FILTERS)).toBe(false);
  });

  it("Min only, Max only, and both (inclusive)", () => {
    expect(ids(filterCompletionRows(rows, { ...NO_COMPLETION_FILTERS, minPercent: "50" }))).toEqual(["c", "d"]);
    expect(ids(filterCompletionRows(rows, { ...NO_COMPLETION_FILTERS, maxPercent: "38" }))).toEqual(["a", "b", "e"]);
    expect(ids(filterCompletionRows(rows, { ...NO_COMPLETION_FILTERS, minPercent: "17", maxPercent: "53" }))).toEqual(["a", "b", "c"]);
    expect(ids(filterCompletionRows(rows, { ...NO_COMPLETION_FILTERS, minPercent: "100" }))).toEqual(["d"]);
  });

  it("designation matches by meaning: a legacy code and the typed name are one designation", () => {
    const key = completionDesignationOptions(rows).find((o) => o.label === "Assistant Professor")!.value;
    expect(ids(filterCompletionRows(rows, { ...NO_COMPLETION_FILTERS, designation: key }))).toEqual(["b", "c"]);
  });

  it("designation and percentage combine", () => {
    const key = completionDesignationOptions(rows).find((o) => o.label === "Assistant Professor")!.value;
    expect(ids(filterCompletionRows(rows, { designation: key, minPercent: "40", maxPercent: "" }))).toEqual(["c"]);
  });

  it("a backwards range is flagged and matches nothing", () => {
    const f = { ...NO_COMPLETION_FILTERS, minPercent: "80", maxPercent: "20" };
    expect(isPercentRangeBackwards(f)).toBe(true);
    expect(filterCompletionRows(rows, f)).toEqual([]);
  });

  it("never changes the rows it is given", () => {
    const copy = JSON.parse(JSON.stringify(rows));
    filterCompletionRows(rows, { designation: "x", minPercent: "1", maxPercent: "2" });
    expect(rows).toEqual(copy);
  });
});

describe("completionDesignationOptions", () => {
  it("one option per designation meaning, labelled and sorted; rows with none are not offered", () => {
    expect(completionDesignationOptions(rows).map((o) => o.label)).toEqual(["Assistant Professor", "Associate Professor", "Professor"]);
  });
});
