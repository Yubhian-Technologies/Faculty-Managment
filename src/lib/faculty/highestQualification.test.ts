import { describe, expect, it } from "vitest";
import {
  HIGHEST_QUALIFICATION_OPTIONS, classifyHighestQualification, isHighestQualificationCategory, normalizeHighestQualification,
} from "./highestQualification";

describe("normalizeHighestQualification - single degrees", () => {
  it.each([
    ["M.TECH", "M.Tech"], ["M.Tech", "M.Tech"], ["M.Tech.", "M.Tech"], ["m tech", "M.Tech"], ["MTech", "M.Tech"],
    ["Ph.D.", "Ph.D"], ["Ph.D", "Ph.D"], ["PHD", "Ph.D"],
    ["M.SC", "M.Sc"], ["M.Sc", "M.Sc"], ["M.Sc.", "M.Sc"],
    ["M.E.", "M.E"], ["M.E", "M.E"],
    ["M.A.", "M.A"], ["MA", "M.A"], ["M.A.(ENG)", "M.A"],
    ["M.PHIL", "M.Phil"], ["M.Phil", "M.Phil"], ["M.Phil.", "M.Phil"],
    ["M.P.ED", "M.P.Ed"], ["M.P.Ed", "M.P.Ed"], ["M.P.Ed.", "M.P.Ed"],
    ["MSIT", "MSIT"], ["MBA", "MBA"], ["B.Tech", "B.Tech"], ["B.SC.", "B.Sc"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeHighestQualification(raw)).toBe(expected);
  });
});

describe("normalizeHighestQualification - several degrees in one value", () => {
  it("M.A, B.Ed, M.Phil -> M.Phil (highest level wins, unknown B.Ed ignored)", () => {
    expect(normalizeHighestQualification("M.A, B.Ed, M.Phil")).toBe("M.Phil");
  });
  it("M.A., M.P.ED, -> M.P.Ed (equal level: the one listed last wins; trailing comma ignored)", () => {
    expect(normalizeHighestQualification("M.A., M.P.ED,")).toBe("M.P.Ed");
  });
  it("Ph.D outranks everything, wherever it is listed", () => {
    expect(normalizeHighestQualification("Ph.D, M.Tech")).toBe("Ph.D");
    expect(normalizeHighestQualification("M.Tech / Ph.D")).toBe("Ph.D");
  });
  it("a master's outranks a bachelor's", () => {
    expect(normalizeHighestQualification("M.Sc and B.Sc")).toBe("M.Sc");
  });
  it("flags multi-degree input as ambiguous, single degrees as not", () => {
    expect(classifyHighestQualification("M.A, B.Ed, M.Phil").ambiguous).toBe(true);
    expect(classifyHighestQualification("M.A.(ENG)").ambiguous).toBe(false);
    expect(classifyHighestQualification("M.A., M.A").ambiguous).toBe(false);
  });
});

describe("normalizeHighestQualification - Others and blanks", () => {
  it("keeps genuinely unmapped text verbatim (trimmed, whitespace collapsed)", () => {
    expect(normalizeHighestQualification("PG(DHM)")).toBe("PG(DHM)");
    expect(normalizeHighestQualification("  MCA  ")).toBe("MCA");
    expect(classifyHighestQualification("PG(DHM)").category).toBe("Others");
  });
  it("returns empty for blank / non-string input", () => {
    expect(normalizeHighestQualification("")).toBe("");
    expect(normalizeHighestQualification("   ")).toBe("");
    expect(normalizeHighestQualification(undefined)).toBe("");
    expect(normalizeHighestQualification(42)).toBe("");
    expect(classifyHighestQualification(null).category).toBeNull();
  });
  it("is idempotent for every category", () => {
    for (const c of HIGHEST_QUALIFICATION_OPTIONS) expect(normalizeHighestQualification(c)).toBe(c);
  });
});

describe("categories", () => {
  it("are exactly the agreed set, in order", () => {
    expect([...HIGHEST_QUALIFICATION_OPTIONS]).toEqual(["Ph.D", "M.Tech", "M.E", "M.Sc", "M.A", "M.Phil", "M.P.Ed", "MSIT", "MBA", "B.Tech", "B.Sc"]);
  });
  it("isHighestQualificationCategory only accepts the canonical spelling", () => {
    expect(isHighestQualificationCategory("M.Tech")).toBe(true);
    expect(isHighestQualificationCategory("M.TECH")).toBe(false);
  });
});
