import { describe, expect, it } from "vitest";
import { honorificKey as catalogKey } from "@/lib/honorifics/config";
import { normalizeHighestQualification } from "./highestQualification";
import { catalogDrName, honorificForPhd, honorificKey, isBlankHonorific } from "./phdHonorific";

describe("catalogDrName", () => {
  it("finds the college's own spelling of Dr", () => {
    expect(catalogDrName(["Mr.", "Mrs.", "Dr."])).toBe("Dr.");
    expect(catalogDrName(["Mr", "Mrs", "Dr"])).toBe("Dr");
    expect(catalogDrName(["dr", "Prof."])).toBe("dr");
  });
  it("prefers Dr. when a catalog lists both", () => {
    expect(catalogDrName(["Dr", "Dr."])).toBe("Dr.");
  });
  it("is null when the college has no Dr entry - nothing is invented", () => {
    expect(catalogDrName(["Mr.", "Mrs."])).toBeNull();
    expect(catalogDrName([])).toBeNull();
    expect(catalogDrName(["Doctor"])).toBeNull();
  });
  it("uses the same notion of 'the same honorific' as the Honorific Catalog", () => {
    for (const v of ["Dr.", "dr", "DR", " Dr ", "D.r"]) expect(honorificKey(v)).toBe(catalogKey(v));
  });
});

describe("honorificForPhd", () => {
  const catalog = ["Mr.", "Mrs.", "Dr."];
  it("fills a blank honorific for a Ph.D", () => {
    for (const blank of [undefined, null, "", "   "]) expect(honorificForPhd({ isPhd: true, honorific: blank }, catalog), String(blank)).toBe("Dr.");
  });
  it("never replaces an honorific somebody chose", () => {
    for (const chosen of ["Mr.", "Prof.", "Mrs", "Dr", "Dr."]) expect(honorificForPhd({ isPhd: true, honorific: chosen }, catalog), chosen).toBeNull();
  });
  it("does nothing for anyone who is not a Ph.D", () => {
    expect(honorificForPhd({ isPhd: false, honorific: "" }, catalog)).toBeNull();
  });
  it("does nothing when the college has no Dr entry", () => {
    expect(honorificForPhd({ isPhd: true, honorific: "" }, ["Mr.", "Mrs."])).toBeNull();
  });
  it("answers in the college's spelling", () => {
    expect(honorificForPhd({ isPhd: true, honorific: "" }, ["Mr", "Dr"])).toBe("Dr");
  });
});

describe("reading the qualification", () => {
  it("every spelling of Ph.D normalizes to the one category the rule keys on", () => {
    for (const q of ["Ph.D", "PhD", "ph.d.", "Ph.D (CSE)", "Doctor of Philosophy", "M.Tech, Ph.D"]) expect(normalizeHighestQualification(q), q).toBe("Ph.D");
  });
  it("other qualifications are not Ph.D", () => {
    for (const q of ["M.Tech", "M.Phil", "MBA", "PG(DHM)", ""]) expect(normalizeHighestQualification(q) === "Ph.D", q).toBe(false);
  });
  it("blank detection", () => {
    expect(isBlankHonorific(undefined)).toBe(true);
    expect(isBlankHonorific(" ")).toBe(true);
    expect(isBlankHonorific("Dr.")).toBe(false);
  });
});
