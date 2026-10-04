import { describe, it, expect } from "vitest";
import { rollInRange } from "@/lib/students/paginatedList";

describe("rollInRange", () => {
  it("matches everything (even a missing roll) when no range is set", () => {
    expect(rollInRange("24PA1A1241", {})).toBe(true);
    expect(rollInRange(undefined, { rollFrom: "", rollTo: "  " })).toBe(true);
  });

  it("is inclusive at both ends and ignores case", () => {
    const range = { rollFrom: "24pa1a1241", rollTo: "24PA1A1250" };
    expect(rollInRange("24PA1A1241", range)).toBe(true);
    expect(rollInRange("24pa1a1245", range)).toBe(true);
    expect(rollInRange("24PA1A1250", range)).toBe(true);
    expect(rollInRange("24PA1A1240", range)).toBe(false);
    expect(rollInRange("24PA1A1251", range)).toBe(false);
  });

  it("swaps a range typed the wrong way round", () => {
    expect(rollInRange("24PA1A1245", { rollFrom: "24PA1A1250", rollTo: "24PA1A1241" })).toBe(true);
  });

  it("supports an open-ended range", () => {
    expect(rollInRange("243", { rollFrom: "244" })).toBe(false);
    expect(rollInRange("250", { rollFrom: "244" })).toBe(true);
    expect(rollInRange("250", { rollTo: "249" })).toBe(false);
    expect(rollInRange("245", { rollTo: "249" })).toBe(true);
  });

  it("never matches a student with no roll number once a range is active", () => {
    expect(rollInRange("", { rollFrom: "A" })).toBe(false);
    expect(rollInRange(undefined, { rollTo: "Z" })).toBe(false);
    expect(rollInRange("   ", { rollFrom: "A", rollTo: "Z" })).toBe(false);
  });
});
