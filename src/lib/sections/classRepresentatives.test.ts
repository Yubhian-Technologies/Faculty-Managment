import { describe, it, expect } from "vitest";
import { classRepresentativeCountOf, validateRepresentativePicks } from "./classRepresentatives";

describe("classRepresentativeCountOf", () => {
  it("defaults to 2 when the HOD hasn't set it", () => expect(classRepresentativeCountOf({})).toBe(2));
  it("uses the HOD's number, including 0", () => {
    expect(classRepresentativeCountOf({ classRepresentativeCount: 1 })).toBe(1);
    expect(classRepresentativeCountOf({ classRepresentativeCount: 0 })).toBe(0);
  });
  it("ignores a nonsense stored value", () => expect(classRepresentativeCountOf({ classRepresentativeCount: 5 })).toBe(2));
});

describe("validateRepresentativePicks", () => {
  it("accepts up to the count", () => {
    expect(validateRepresentativePicks(["a"], 2)).toBeNull();
    expect(validateRepresentativePicks([], 0)).toBeNull();
  });
  it("refuses more than the count, duplicates and bad input", () => {
    expect(validateRepresentativePicks(["a", "b"], 1)).toMatch(/1 Class Representative/);
    expect(validateRepresentativePicks(["a"], 0)).toMatch(/no Class Representatives/);
    expect(validateRepresentativePicks(["a", "a"], 2)).toMatch(/twice/);
    expect(validateRepresentativePicks("a", 2)).toMatch(/list/);
  });
});
