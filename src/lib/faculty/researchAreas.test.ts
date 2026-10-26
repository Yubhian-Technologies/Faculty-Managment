import { describe, expect, it } from "vitest";
import { areaMatchesTerm, filterByResearchArea, matchedResearchAreas, parseResearchQuery, researchAreaList, researchAreaOptions } from "./researchAreas";

const person = (id: string, areas: unknown, extra: Record<string, unknown> = {}) => ({ id, academicProfile: { researchAreasInterests: areas }, ...extra });

describe("researchAreaList", () => {
  it("returns the entered areas, trimmed", () => {
    expect(researchAreaList(person("a", ["Machine Learning", " Deep Learning ", "LLMs"]))).toEqual(["Machine Learning", "Deep Learning", "LLMs"]);
  });
  it("reads a plain string and the older researchAreas key, and copes with missing or odd data", () => {
    expect(researchAreaList(person("a", "Fog Computing"))).toEqual(["Fog Computing"]);
    expect(researchAreaList({ academicProfile: { researchAreas: ["IoT"] } })).toEqual(["IoT"]);
    expect(researchAreaList(person("a", []))).toEqual([]);
    expect(researchAreaList(person("a", [1, null, "  "]))).toEqual([]);
    expect(researchAreaList({})).toEqual([]);
    expect(researchAreaList({ academicProfile: null })).toEqual([]);
  });
});

describe("parseResearchQuery", () => {
  it("splits alternatives on / , ; and drops one-letter terms", () => {
    expect(parseResearchQuery("ml/ds")).toEqual(["ml", "ds"]);
    expect(parseResearchQuery(" IoT, AI ; x ")).toEqual(["iot", "ai"]);
    expect(parseResearchQuery("   ")).toEqual([]);
    expect(parseResearchQuery("Machine  Learning")).toEqual(["machine learning"]);
  });
});

describe("areaMatchesTerm", () => {
  it("matches on whole words / phrases, so ml does not find HTML", () => {
    expect(areaMatchesTerm("HTML5 and CSS", "ml")).toBe(false);
    expect(areaMatchesTerm("ML for Healthcare", "ml")).toBe(true);
    expect(areaMatchesTerm("Machine Learning", "learn")).toBe(true);
    expect(areaMatchesTerm("Machine Learning", "machine learn")).toBe(true);
    expect(areaMatchesTerm("Machine Learning", "chine")).toBe(false);
  });
  it("matches the initials of a phrase", () => {
    expect(areaMatchesTerm("Machine Learning", "ml")).toBe(true);
    expect(areaMatchesTerm("Data Science", "ds")).toBe(true);
    expect(areaMatchesTerm("Internet of Things", "iot")).toBe(true);
    expect(areaMatchesTerm("Machine Learning Algorithms", "ml")).toBe(false); // initials are "mla": a two-letter term must equal them
    expect(areaMatchesTerm("Machine Learning Algorithms", "mla")).toBe(true);
    expect(areaMatchesTerm("Image Processing", "ml")).toBe(false);
  });
});

describe("filtering by research area only (never by name)", () => {
  const rows = [
    person("ml", ["Machine Learning", "Cloud"], { legalName: "A KUMAR" }),
    person("ds", ["Data Science"], { legalName: "B RAO" }),
    person("named", ["Networks"], { legalName: "SMLDS PERSON ML DS" }),
    person("none", [], { legalName: "C" }),
    { id: "noprofile", legalName: "D" },
  ];
  it("a faculty whose NAME contains the letters is not returned unless a research area matches", () => {
    expect(filterByResearchArea(rows, "ml/ds").map((r) => r.id)).toEqual(["ml", "ds"]);
  });
  it("tells which areas matched, so the list can show why", () => {
    expect(matchedResearchAreas(rows[0], "ml")).toEqual(["Machine Learning"]);
    expect(filterByResearchArea(rows, "ml")[0].researchMatches).toEqual(["Machine Learning"]);
  });
  it("leaves the rows untouched when the filter is off or unusable, and does not change the input rows", () => {
    expect(filterByResearchArea(rows, "")).toBe(rows);
    expect(filterByResearchArea(rows, " x ")).toBe(rows);
    expect("researchMatches" in rows[0]).toBe(false);
  });
});

describe("researchAreaOptions", () => {
  it("lists every distinct area once (case-insensitive) with how many people hold it, most common first", () => {
    const o = researchAreaOptions([person("1", ["Machine Learning", "IoT"]), person("2", ["machine learning"]), person("3", ["IoT", "iot"]), person("4", [])]);
    expect(o.map((x) => [x.label, x.count])).toEqual([["IoT", 2], ["Machine Learning", 2]]);
  });
  it("is empty when nobody has entered any", () => {
    expect(researchAreaOptions([person("1", []), { id: "2" }])).toEqual([]);
  });
});
