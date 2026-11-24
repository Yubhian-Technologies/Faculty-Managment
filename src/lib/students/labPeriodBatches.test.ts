import { describe, expect, it } from "vitest";
import { cleanPeriodChoices, sideBySideLabPeriods } from "./labPeriodBatches";
import { effectiveLabBatch, type LabBatchMode, type LabBatchModes } from "./labBatchMode";

const labs: { subjectId: string; subjectName: string; subjectCode: string; batchByPeriod?: Record<string, string> }[] = [
  { subjectId: "phy", subjectName: "Physics Lab", subjectCode: "PL", batchByPeriod: { MON_5: "Batch 1", THU_5: "Batch 2" } },
  { subjectId: "che", subjectName: "Chemistry Lab", subjectCode: "CL", batchByPeriod: { MON_5: "Batch 2" } },
];
const slots = [
  { day: "MON" as const, periodNumber: 5, subjectId: "phy" }, { day: "MON" as const, periodNumber: 5, subjectId: "che" },
  { day: "THU" as const, periodNumber: 5, subjectId: "phy" }, { day: "THU" as const, periodNumber: 5, subjectId: "che" },
  { day: "TUE" as const, periodNumber: 2, subjectId: "phy" }, // one lab alone - not side by side
  { day: "MON" as const, periodNumber: 1, subjectId: "maths" }, // not a lab
];

describe("sideBySideLabPeriods", () => {
  it("lists only periods with two labs, week order, with each lab's chosen batch", () => {
    const p = sideBySideLabPeriods(slots, labs);
    expect(p.map((x) => x.key)).toEqual(["MON_5", "THU_5"]);
    expect(p[0].labs.map((l) => [l.subjectId, l.batch])).toEqual([["che", "Batch 2"], ["phy", "Batch 1"]]);
    expect(p[1].labs.find((l) => l.subjectId === "che")?.batch).toBeNull();
  });
});

describe("cleanPeriodChoices", () => {
  const periods = sideBySideLabPeriods(slots, labs);
  const batches = ["Batch 1", "Batch 2"];
  it("accepts a choice and uses the saved label", () => {
    const r = cleanPeriodChoices({ THU_5: { phy: "batch 2", che: "Batch 1" } }, periods, batches);
    expect(r).toEqual({ ok: true, choices: { THU_5: { phy: "Batch 2", che: "Batch 1" } } });
  });
  it("refuses one batch for two labs in a period", () => {
    const r = cleanPeriodChoices({ MON_5: { phy: "Batch 1", che: "Batch 1" } }, periods, batches);
    expect(r.ok).toBe(false);
  });
  it("refuses an unknown batch, period or lab", () => {
    expect(cleanPeriodChoices({ MON_5: { phy: "Batch 9" } }, periods, batches).ok).toBe(false);
    expect(cleanPeriodChoices({ TUE_2: { phy: "Batch 1" } }, periods, batches).ok).toBe(false);
    expect(cleanPeriodChoices({ MON_5: { maths: "Batch 1" } }, periods, batches).ok).toBe(false);
  });
  it("blank clears", () => {
    expect(cleanPeriodChoices({ MON_5: { phy: "" } }, periods, batches)).toEqual({ ok: true, choices: { MON_5: { phy: null } } });
  });
});

describe("effectiveLabBatch with a period choice", () => {
  const modes: LabBatchModes = new Map<string, LabBatchMode>([
    ["s1_phy", { batchWise: true, batchByFaculty: { fA: "Batch 1" }, batchByPeriod: { THU_5: "Batch 2" } }],
    ["s1_che", { batchWise: false, batchByFaculty: {}, batchByPeriod: { MON_5: "Batch 2" } }],
  ]);
  it("the period's choice wins over the faculty batch, a pinned label and 'no batch'", () => {
    expect(effectiveLabBatch(undefined, modes, "s1", "phy", "fA", false, { day: "THU", periodNumber: 5 })).toBe("Batch 2");
    expect(effectiveLabBatch("Batch 1", modes, "s1", "phy", "fA", true, { day: "THU", periodNumber: 5 })).toBe("Batch 2");
    expect(effectiveLabBatch(undefined, modes, "s1", "che", "fB", false, { day: "MON", periodNumber: 5 })).toBe("Batch 2");
  });
  it("other periods behave as before", () => {
    expect(effectiveLabBatch(undefined, modes, "s1", "phy", "fA", false, { day: "MON", periodNumber: 5 })).toBe("Batch 1");
    expect(effectiveLabBatch(undefined, modes, "s1", "che", "fB", false, { day: "THU", periodNumber: 5 })).toBeUndefined();
  });
});
