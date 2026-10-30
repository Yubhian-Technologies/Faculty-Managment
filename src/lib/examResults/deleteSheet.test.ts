import { describe, expect, it } from "vitest";
import { dependentSheets } from "./deleteSheet";

const rec = (batchId: string, studentId: string, examType: "REGULAR" | "SUPPLEMENTARY" | "REVALUATION", examHeld: string, extra: { revaluesBatchId?: string; semester?: number } = {}) =>
  ({ batchId, studentId, courseKey: "btech", semester: extra.semester ?? 1, examType, examHeld, revaluesBatchId: extra.revaluesBatchId });

describe("deleting a published results sheet", () => {
  const regular = { id: "reg", examType: "REGULAR" as const, examHeld: "2026-03" };
  const own = [rec("reg", "s1", "REGULAR", "2026-03"), rec("reg", "s2", "REGULAR", "2026-03")];

  it("nothing later: free to delete", () => {
    expect(dependentSheets(regular, own, [...own, rec("other", "s1", "REGULAR", "2026-08", { semester: 2 })])).toEqual([]);
  });
  it("a later supplementary of the same semester rests on it", () => {
    expect(dependentSheets(regular, own, [rec("sup", "s2", "SUPPLEMENTARY", "2026-06")])).toEqual(["sup"]);
  });
  it("a revaluation of it rests on it", () => {
    expect(dependentSheets(regular, own, [rec("rv", "s1", "REVALUATION", "2026-03", { revaluesBatchId: "reg" })])).toEqual(["rv"]);
  });
  it("another student's or another semester's sittings don't count", () => {
    expect(dependentSheets(regular, own, [rec("sup", "s9", "SUPPLEMENTARY", "2026-06"), rec("sup2", "s1", "SUPPLEMENTARY", "2026-06", { semester: 2 })])).toEqual([]);
  });
  it("an earlier supplementary doesn't rest on a later one", () => {
    const sup = { id: "sup2", examType: "SUPPLEMENTARY" as const, examHeld: "2026-09" };
    expect(dependentSheets(sup, [rec("sup2", "s1", "SUPPLEMENTARY", "2026-09")], [rec("sup1", "s1", "SUPPLEMENTARY", "2026-06")])).toEqual([]);
  });
  it("a revaluation sheet has no dependents but its own re-grades", () => {
    const rv = { id: "rv", examType: "REVALUATION" as const, examHeld: "2026-03" };
    expect(dependentSheets(rv, [rec("rv", "s1", "REVALUATION", "2026-03", { revaluesBatchId: "reg" })], [rec("sup", "s1", "SUPPLEMENTARY", "2026-06")])).toEqual([]);
  });
});
