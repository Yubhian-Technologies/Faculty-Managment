import { describe, expect, it } from "vitest";
import { degreeTypeError } from "./degreeType";

const btech = { course: "B.Tech/BE", branch: "CSE", institutionName: "X", percentageCgpa: "8" };

describe("degreeTypeError", () => {
  it("requires Degree when Course is B.Tech/BE, on UG and PG (incl. additional)", () => {
    expect(degreeTypeError({ ugDetails: btech })).toMatch(/UG Details.*required/);
    expect(degreeTypeError({ pgDetails: btech })).toMatch(/PG Details.*required/);
    expect(degreeTypeError({ additionalPgDetails: [{ ...btech, degreeType: "BE" }, btech] })).toMatch(/PG Details 3/);
  });
  it("accepts B.Tech and BE, and ignores other courses", () => {
    expect(degreeTypeError({ ugDetails: { ...btech, degreeType: "B.Tech" }, pgDetails: { ...btech, degreeType: "BE" } })).toBeNull();
    expect(degreeTypeError({ ugDetails: { ...btech, course: "BBA" } })).toBeNull();
  });
  it("rejects unknown Degree values and skips absent keys", () => {
    expect(degreeTypeError({ ugDetails: { ...btech, degreeType: "BTech" } })).toMatch(/is required/);
    expect(degreeTypeError({ phdDetails: btech })).toBeNull();
    expect(degreeTypeError(undefined)).toBeNull();
  });
});

describe("degreeTypeError - M.Tech/ME", () => {
  const mtech = { course: "M.Tech/ME", branch: "CSE", institutionName: "X", percentageCgpa: "8" };
  it("requires M.Tech or ME on M.Tech/ME, rejects B.Tech there", () => {
    expect(degreeTypeError({ pgDetails: mtech })).toMatch(/M\.Tech or ME/);
    expect(degreeTypeError({ pgDetails: { ...mtech, degreeType: "ME" } })).toBeNull();
    expect(degreeTypeError({ pgDetails: { ...mtech, degreeType: "BE" } })).toMatch(/required/);
  });
  it("rejects a stray Degree on other courses", () => {
    expect(degreeTypeError({ ugDetails: { ...mtech, course: "BBA", degreeType: "BE" } })).toMatch(/only applicable/);
  });
});
