import { describe, expect, it } from "vitest";
import { compareSectionsByName, compareStudentsBySurname, evenSplit, surnameKey } from "./evenSplit";

describe("evenSplit", () => {
  const sizes = (buckets: unknown[][]) => buckets.map((b) => b.length);

  it.each([
    [1, 1, [1]],
    [1, 3, [1, 0, 0]],
    [2, 3, [1, 1, 0]],
    [4, 3, [2, 1, 1]],
    [5, 3, [2, 2, 1]],
    [6, 3, [2, 2, 2]],
    [7, 3, [3, 2, 2]],
    [8, 3, [3, 3, 2]],
    [10, 3, [4, 3, 3]],
    [11, 3, [4, 4, 3]],
    [13, 4, [4, 3, 3, 3]],
    [100, 3, [34, 33, 33]],
  ])("splits %i items over %i buckets as %j", (n, k, expected) => {
    const items = Array.from({ length: n }, (_, i) => i);
    expect(sizes(evenSplit(items, k))).toEqual(expected);
  });

  it("returns no buckets for zero or negative bucket count", () => {
    expect(evenSplit([1, 2, 3], 0)).toEqual([]);
    expect(evenSplit([1, 2, 3], -1)).toEqual([]);
  });

  it("puts every item somewhere, in order, with more buckets than items", () => {
    const buckets = evenSplit([1, 2], 3);
    expect(sizes(buckets)).toEqual([1, 1, 0]);
    expect(buckets.flat()).toEqual([1, 2]);
  });

  it("preserves input order within and across buckets", () => {
    const items = ["a", "b", "c", "d", "e"];
    const buckets = evenSplit(items, 2);
    expect(buckets.flat()).toEqual(items);
  });
});

describe("surnameKey", () => {
  it("takes the first word, lowercased", () => {
    expect(surnameKey("Reddy Arjun")).toBe("reddy");
    expect(surnameKey("  Kumar   Rahul  ")).toBe("kumar");
  });

  it("falls back to empty string for blank/undefined names", () => {
    expect(surnameKey("")).toBe("");
    expect(surnameKey("   ")).toBe("");
    expect(surnameKey(undefined)).toBe("");
  });

  it("uses the whole name when there's only one word", () => {
    expect(surnameKey("Kethan")).toBe("kethan");
  });
});

describe("compareStudentsBySurname", () => {
  it("orders by surname first", () => {
    const a = { id: "1", name: "Adams Ravi" };
    const b = { id: "2", name: "Baker Nikhil" };
    expect(compareStudentsBySurname(a, b)).toBeLessThan(0);
    expect(compareStudentsBySurname(b, a)).toBeGreaterThan(0);
  });

  it("falls back to full name, then id, for same surname", () => {
    const a = { id: "z", name: "Kumar Arjun" };
    const b = { id: "a", name: "Kumar Rahul" };
    // "Kumar Arjun" < "Kumar Rahul" by full-name compare, despite id z > a.
    expect(compareStudentsBySurname(a, b)).toBeLessThan(0);

    const c = { id: "z", name: "Kumar Rahul" };
    const d = { id: "a", name: "Kumar Rahul" };
    // identical name -> id tiebreak.
    expect(compareStudentsBySurname(c, d)).toBeGreaterThan(0);
    expect(compareStudentsBySurname(d, c)).toBeLessThan(0);
  });

  it("is deterministic and stable regardless of input order", () => {
    const students = [
      { id: "3", name: "Kumar Rahul" },
      { id: "1", name: "Kumar Rahul" },
      { id: "2", name: "Kumar Arjun" },
      { id: "4", name: "Adams Ravi" },
    ];
    const sortedOnce = [...students].sort(compareStudentsBySurname).map((s) => s.id);
    const sortedAgain = [...students].reverse().sort(compareStudentsBySurname).map((s) => s.id);
    expect(sortedOnce).toEqual(sortedAgain);
    expect(sortedOnce).toEqual(["4", "2", "1", "3"]);
  });
});

describe("compareSectionsByName", () => {
  it("sorts natural-numeric, not lexicographic", () => {
    const sections = [{ name: "Section 10" }, { name: "Section 2" }, { name: "Section 1" }];
    expect(sections.sort(compareSectionsByName).map((s) => s.name)).toEqual(["Section 1", "Section 2", "Section 10"]);
  });

  it("sorts plain letters alphabetically", () => {
    const sections = [{ name: "C" }, { name: "A" }, { name: "B" }];
    expect(sections.sort(compareSectionsByName).map((s) => s.name)).toEqual(["A", "B", "C"]);
  });

  it("gives the same order regardless of input order", () => {
    const a = [{ name: "C" }, { name: "A" }, { name: "B" }].sort(compareSectionsByName).map((s) => s.name);
    const b = [{ name: "B" }, { name: "C" }, { name: "A" }].sort(compareSectionsByName).map((s) => s.name);
    expect(a).toEqual(b);
  });
});
