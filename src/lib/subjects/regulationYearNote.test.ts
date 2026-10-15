import { describe, expect, it } from "vitest";
import { regulationYearNote } from "./regulationYearNote";

// Session 2026-27: Year 1 = 2026 intake, Year 2 = 2025, Year 3 = 2024, Year 4 = 2023.
const BATCHES = { R20: "2020-2024,2021-2025", R23: "2023-2027,2024-2028", R26: "2026-2030", R27: "2027-2031" };

describe("regulationYearNote", () => {
  it("says a regulation whose batches already went through the year is past, not 'coming'", () => {
    const note = regulationYearNote(BATCHES, "R23", 1, 2026);
    expect(note).toContain("already passed Year 1");
    expect(note).not.toContain("reaches");
  });

  it("keeps the 'ready for when it reaches' message for a regulation that isn't there yet", () => {
    expect(regulationYearNote(BATCHES, "R27", 1, 2026)).toContain("will be ready for when a R27 batch reaches Year 1");
  });

  it("says nothing for the regulation taught in that year right now", () => {
    expect(regulationYearNote(BATCHES, "R26", 1, 2026)).toBe("");
    expect(regulationYearNote(BATCHES, "R23", 4, 2026)).toBe("");
  });

  it("says nothing when it can't tell: no batch years, unknown regulation, or batches either side of now", () => {
    expect(regulationYearNote({}, "R23", 1, 2026)).toBe("");
    expect(regulationYearNote(BATCHES, "R99", 1, 2026)).toBe("");
    expect(regulationYearNote({ RX: "2023-2027,2029-2033" }, "RX", 1, 2026)).toBe("");
  });
});
