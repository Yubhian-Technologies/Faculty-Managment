import { describe, expect, it } from "vitest";
import { neutraliseFormula, toCSV } from "./csv";

describe("CSV formula neutralising", () => {
  it("prefixes cells that would run as a formula", () => {
    for (const bad of ["=HYPERLINK(\"http://x\")", "@SUM(A1)", "+cmd|' /C calc'!A0", "-cmd|x"]) {
      expect(neutraliseFormula(bad)).toBe(`'${bad}`);
    }
  });

  it("leaves ordinary values alone", () => {
    for (const ok of ["Ravi Kumar", "", "123", "-5", "-5.5", "+91 98765 43210", "+91", "(555) 1234", "2026-10-03", "a=b", "O'Neil"]) {
      expect(neutraliseFormula(ok)).toBe(ok);
    }
  });

  it("applies to every cell of a CSV, and still quotes as before", () => {
    expect(toCSV([["=1+2", "plain, comma"]])).toBe("'=1+2,\"plain, comma\"");
  });
});
