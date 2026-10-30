import { describe, expect, it } from "vitest";
import { checkMarksBreakdown } from "./marksBreakdown";

describe("internal marks breakdown", () => {
  it("components must add up to the internal max (inactive ones don't count)", () => {
    const ok = checkMarksBreakdown({ internalMaxMarks: 30, externalMaxMarks: 70, components: [{ name: " Mid ", maxMarks: 25 }, { name: "Quiz", maxMarks: 5 }, { name: "Assignment", maxMarks: 5, isActive: false }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.components.map((c) => [c.name, c.maxMarks, c.isActive])).toEqual([["Mid", 25, true], ["Quiz", 5, true], ["Assignment", 5, false]]);
    expect(checkMarksBreakdown({ internalMaxMarks: 30, externalMaxMarks: 70, components: [{ name: "Mid", maxMarks: 20 }] }))
      .toMatchObject({ ok: false, error: "Breakdown total must equal the Internal Maximum Marks (30). Current total: 20." });
    expect(checkMarksBreakdown({ internalMaxMarks: 30, externalMaxMarks: 70, components: [] }))
      .toMatchObject({ ok: false, error: "At least one internal marks component is required" });
  });
});
