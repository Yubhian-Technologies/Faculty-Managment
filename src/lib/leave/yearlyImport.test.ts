import { describe, expect, it } from "vitest";
import { YEARLY_IMPORT_COLUMNS, planYearlyRow } from "./yearlyImport";

describe("planYearlyRow", () => {
  it("turns month columns into one task per month, with the year's weekly offs and holidays", () => {
    const p = planYearlyRow({ year: "2024", weeklyOffs: "52", holidays: "24", clFeb: "1", clJun: "2", vcMar: "1" });
    expect(p).toEqual({
      ok: true, year: 2024, weeklyOffs: 52, holidays: 24,
      tasks: [{ code: "CL", month: 2, days: 1 }, { code: "CL", month: 6, days: 2 }, { code: "OD", month: 3, days: 1 }],
    });
  });
  it("records a Total with no months in January", () => {
    const p = planYearlyRow({ year: "2023", slTotal: "3" });
    expect(p).toEqual({ ok: true, year: 2023, tasks: [{ code: "SL", month: 1, days: 3 }] });
  });
  it("accepts months and a matching Total, rejects a mismatch", () => {
    expect(planYearlyRow({ year: "2024", clTotal: "3", clJan: "1", clFeb: "2" }).ok).toBe(true);
    const bad = planYearlyRow({ year: "2024", clTotal: "5", clJan: "1", clFeb: "2" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("add up to 3");
  });
  it("rejects a missing or malformed year", () => {
    expect(planYearlyRow({ clJan: "1" }).ok).toBe(false);
    expect(planYearlyRow({ year: "24" }).ok).toBe(false);
    expect(planYearlyRow({ year: "1800" }).ok).toBe(false);
  });
  it("rejects non-numeric and out-of-range counts", () => {
    expect(planYearlyRow({ year: "2024", holidays: "abc" }).ok).toBe(false);
    expect(planYearlyRow({ year: "2024", weeklyOffs: "400" }).ok).toBe(false);
    expect(planYearlyRow({ year: "2024", elMay: "x" }).ok).toBe(false);
    expect(planYearlyRow({ year: "2024", elMay: "-1" }).ok).toBe(false);
  });
  it("is fine with no leave at all (only weekly offs / holidays)", () => {
    expect(planYearlyRow({ year: "2022", weeklyOffs: "52", holidays: "20" })).toEqual({ ok: true, year: 2022, weeklyOffs: 52, holidays: 20, tasks: [] });
  });
});

describe("YEARLY_IMPORT_COLUMNS", () => {
  it("has unique keys and 4 types x (Total + 12 months)", () => {
    const keys = YEARLY_IMPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(5 + 4 * 13);
  });
});
