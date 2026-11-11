import { describe, expect, it } from "vitest";
import { computeLine } from "./calc";
import { PayrollRuleError, cleanPayrollSettings, defaultPayrollSettings, monthDays, pfRuleFor, revisionFor, roundTo, settingsForMonth, slabAmount } from "./rules";
import sheet from "./__fixtures__/vwu-oct-2026.json";

// The golden test is the College Office's October 2026 VWU pay sheet (362 rows, names and Emp Codes
// left out). Each row: s = section (T teaching / N non-teaching), d = pay days, ga = Gross_Actual,
// a = fixed monthly amounts (full-month rows: as printed; part-month rows: amounts that give exactly
// the printed earned figures), x = deductions that don't apply (no PF), it / adv = IT and advance as
// printed, e = printed [E.B, AGP, DA, HRA, OA, SA, G.SAL, PF, PT, ESI, SWF, Total Ded, Net].

type Row = { s: "T" | "N"; d: number; ga: number; a: Record<string, number> | null; x: string[]; it: number; adv: number; e: number[] };
const rows = sheet as Row[];
const settings = defaultPayrollSettings();
const PARTS = ["EB", "AGP", "DA", "HRA", "OA", "SA"];

const run = (r: Row) => computeLine({ settings, amounts: r.a ?? { EB: r.ga }, exempt: r.x, monthDays: 31, payDays: r.d, tds: r.it, advance: r.adv });

describe("October 2026 VWU pay sheet - every row", () => {
  it("has all 362 rows", () => expect(rows).toHaveLength(362));

  it.each(rows.map((r, i) => [i + 1, r] as const))("row %i matches the sheet", (_n, r) => {
    const got = run(r);
    const [eb, agp, da, hra, oa, sa, gsal, pf, pt, esi, swf, ded, net] = r.e;
    expect(PARTS.map((p) => got.earned[p])).toEqual([eb, agp, da, hra, oa, sa]);
    expect([got.gross, got.deductions.PF, got.deductions.PT, got.deductions.ESI, got.deductions.SWF, got.deductions.IT, got.deductions.ADV, got.totalDeductions, got.net])
      .toEqual([gsal, pf, pt, esi, swf, gsal ? r.it : 0, gsal ? r.adv : 0, ded, net]);
    expect(got.grossActual).toBe(r.ga);
    expect(got.shortfall).toBe(0);
  });

  it("section subtotals and the report total match", () => {
    const total = (list: Row[]) => list.map(run).reduce((t, g) => ({ gross: t.gross + g.gross, ded: t.ded + g.totalDeductions, net: t.net + g.net }), { gross: 0, ded: 0, net: 0 });
    expect(total(rows.filter((r) => r.s === "T"))).toEqual({ gross: 21020367, ded: 1537657, net: 19482710 });
    expect(total(rows.filter((r) => r.s === "N"))).toEqual({ gross: 3976681, ded: 329284, net: 3647397 });
    expect(total(rows)).toEqual({ gross: 24997048, ded: 1866941, net: 23130107 });
    expect(rows.reduce((a, r) => a + run(r).deductions.ADV, 0)).toBe(124417);
  });
});

describe("salary rules", () => {
  const base = { settings, monthDays: 31, exempt: [] as string[] };

  it("prorates each part and adds the rounded parts (not the rounded gross)", () => {
    const g = computeLine({ ...base, amounts: { EB: 19763, AGP: 6001, DA: 28339, HRA: 2576, OA: 19321 }, payDays: 20.5 });
    expect(g.gross).toBe(50257);
    expect(Math.round((76000 * 20.5) / 31)).toBe(50258);
  });

  it("caps PF at 3,000 and skips it when the person has no PF", () => {
    expect(computeLine({ ...base, amounts: { EB: 50000 }, payDays: 31 }).deductions.PF).toBe(3000);
    expect(computeLine({ ...base, amounts: { EB: 16550, AGP: 6000, DA: 2255, HRA: 2255, OA: 540 }, payDays: 31 }).deductions.PF).toBe(2977);
    expect(computeLine({ ...base, amounts: { EB: 50000 }, exempt: ["PF"], payDays: 31 }).deductions.PF).toBe(0);
  });

  it("ESI: 0.75% of the PF-wage parts, rounded up, judged on the full monthly wage", () => {
    expect(computeLine({ ...base, amounts: { EB: 7500, OA: 5750 }, payDays: 31 }).deductions.ESI).toBe(57);
    // Full wage 21,000 is in; 21,001 is out - whatever the gross.
    expect(computeLine({ ...base, amounts: { EB: 21000, OA: 9000 }, payDays: 31 }).deductions.ESI).toBe(158);
    expect(computeLine({ ...base, amounts: { EB: 21001 }, payDays: 31 }).deductions.ESI).toBe(0);
    // A short month doesn't bring a 33,826 wage into ESI.
    expect(computeLine({ ...base, amounts: { EB: 33826 }, payDays: 12 }).deductions.ESI).toBe(0);
  });

  it("PT slab on the earned gross", () => {
    const pt = settings.deductions.find((d) => d.kind === "SLAB")!;
    if (pt.kind !== "SLAB") throw new Error();
    expect([15000, 15001, 20000, 20001].map((v) => slabAmount(pt.slabs, v))).toEqual([0, 150, 150, 200]);
  });

  it("no pay days -> every column 0 and the advance waits", () => {
    const g = computeLine({ ...base, amounts: { EB: 80000 }, payDays: 0, tds: 500, advance: 2000 });
    expect([g.gross, g.totalDeductions, g.net, g.advanceDeferred, g.grossActual]).toEqual([0, 0, 0, 2000, 80000]);
  });

  it("never lets the net go below 0: the advance is cut first, the rest is a shortfall", () => {
    const g = computeLine({ ...base, amounts: { EB: 1000 }, payDays: 31, advance: 5000 });
    expect(g.net).toBe(0);
    expect(g.deductions.ADV).toBe(1000 - 120 - 8 - 30);
    expect(g.advanceDeferred).toBe(5000 - g.deductions.ADV);
    const h = computeLine({ ...base, amounts: { EB: 1000 }, payDays: 31, tds: 5000 });
    expect(h.shortfall).toBe(120 + 8 + 30 + 5000 - 1000);
  });

  it("arrears of a PF part count for PF; other one-offs don't", () => {
    const a = computeLine({ ...base, amounts: { EB: 10000 }, payDays: 31, oneOffs: [{ label: "Arrears", amount: 1000, componentId: "EB" }] });
    const b = computeLine({ ...base, amounts: { EB: 10000 }, payDays: 31, oneOffs: [{ label: "Bonus", amount: 1000 }] });
    expect([a.gross, a.deductions.PF, b.gross, b.deductions.PF]).toEqual([11000, 1320, 11000, 1200]);
  });

  it("month days, rounding and revisions", () => {
    expect([monthDays("2026-10"), monthDays("2026-02"), monthDays("2028-02"), monthDays("2026-10", "FIXED_30")]).toEqual([31, 28, 29, 30]);
    expect([roundTo(13711, 100), roundTo(13750, 100), roundTo(13749.9, 100), roundTo(0.1 + 0.2 + 99.2, 1)]).toEqual([13700, 13800, 13700, 100]);
    const rev = (effectiveFrom: string) => ({ effectiveFrom, amounts: {}, exempt: [], byName: "", byUid: "", at: "" });
    const list = [rev("2026-11"), rev("2026-04")];
    expect(revisionFor(list, "2026-03")).toBeNull();
    expect(revisionFor(list, "2026-10")?.effectiveFrom).toBe("2026-04");
    expect(revisionFor(list, "2026-11")?.effectiveFrom).toBe("2026-11");
  });
});

describe("settings checks", () => {
  const ok = defaultPayrollSettings();
  it("accepts the defaults and a new part", () => {
    const next = cleanPayrollSettings({ ...ok, earnings: [...ok.earnings, { id: "CCA", label: "CCA", prorate: true }] }, ok);
    expect(next.earnings.map((e) => e.id)).toContain("CCA");
  });
  it("refuses removing or re-typing a part already used, duplicates, bad slabs", () => {
    expect(() => cleanPayrollSettings({ ...ok, earnings: ok.earnings.slice(1) }, ok)).toThrow(PayrollRuleError);
    expect(() => cleanPayrollSettings({ ...ok, deductions: ok.deductions.map((d) => (d.id === "SWF" ? { kind: "MANUAL", id: "SWF", label: "SWF" } : d)) }, ok)).toThrow(/type/);
    expect(() => cleanPayrollSettings({ ...ok, earnings: [...ok.earnings, { id: "EB", label: "Dup" }] }, ok)).toThrow(/twice/);
    expect(() => cleanPayrollSettings({ ...ok, deductions: [{ kind: "SLAB", id: "PT", label: "PT", slabs: [{ upTo: 20000, amount: 150 }, { upTo: 15000, amount: 0 }, { upTo: null, amount: 200 }] }] }, null)).toThrow(/go up/);
  });
  it("retiring keeps the id", () => {
    const next = cleanPayrollSettings({ ...ok, earnings: ok.earnings.map((e) => (e.id === "SA" ? { ...e, active: false } : e)) }, ok);
    expect(next.earnings.find((e) => e.id === "SA")?.active).toBe(false);
  });
});

describe("PF rule by month (wage ceiling 15,000 -> 25,000 from Oct 2026)", () => {
  const withChange = () => {
    const s = defaultPayrollSettings();
    const pf = s.deductions.find((d) => d.kind === "PF")!;
    return cleanPayrollSettings({ ...s, deductions: s.deductions.map((d) => (d === pf ? { ...pf, percent: 12, wageCeiling: 15000, epsCeiling: 15000, changes: [{ from: "2026-10", percent: 12, wageCeiling: 25000, epsCeiling: 15000 }] } : d)) }, null);
  };
  it("each month uses the rule in force: Sep 1,800, Oct and later 3,000", () => {
    const s = { ...withChange(), version: 1 } as never as ReturnType<typeof defaultPayrollSettings>;
    const amounts = { EB: 37400, AGP: 9000, DA: 27840, HRA: 4640, OA: 1120 };   // PF wage 74,240 (sheet row VWU0690)
    const pfIn = (month: string) => computeLine({ settings: settingsForMonth(s, month), amounts, exempt: [], monthDays: 30, payDays: 30 }).deductions.PF;
    expect(pfIn("2026-09")).toBe(1800);
    expect(pfIn("2026-10")).toBe(3000);
    expect(pfIn("2027-03")).toBe(3000);
    // Under the ceiling the rule doesn't matter: 12% of 24,192 = 2,903.
    expect(computeLine({ settings: settingsForMonth(s, "2026-11"), amounts: { EB: 15600, AGP: 6000, DA: 2592 }, exempt: [], monthDays: 30, payDays: 30 }).deductions.PF).toBe(2903);
  });
  it("saved settings with only a cap read as a ceiling; changes are checked", () => {
    const s = defaultPayrollSettings();
    const legacy = s.deductions.map((d) => (d.kind === "PF" ? { kind: "PF", id: d.id, label: d.label, active: true, percent: 12, cap: 3000 } : d));
    const pf = cleanPayrollSettings({ ...s, deductions: legacy }, null).deductions.find((d) => d.kind === "PF")!;
    expect(pf).toMatchObject({ percent: 12, wageCeiling: 25000, epsCeiling: 15000, cap: 3000 });
    const bad = (changes: unknown[]) => () => cleanPayrollSettings({ ...s, deductions: s.deductions.map((d) => (d.kind === "PF" ? { ...d, changes } : d)) }, null);
    expect(bad([{ percent: 12, wageCeiling: 25000 }])).toThrow(/month it starts/);
    expect(bad([{ from: "2026-10", percent: 12, wageCeiling: 25000 }, { from: "2026-10", percent: 10, wageCeiling: 25000 }])).toThrow(/two rule changes/);
    expect(pfRuleFor(withChange().deductions.find((d) => d.kind === "PF") as never, "2026-09")).toEqual({ percent: 12, wageCeiling: 15000, epsCeiling: 15000, cap: 1800 });
  });
});
