import { describe, expect, it } from "vitest";
import { outcomeSwitches } from "./outcomeSwitches";
import { questionErrors } from "./validateQuestion";
import { unitStatus } from "./rules";
import { setupIssues } from "./setup";
import { cleanOutcomes } from "./outcomes";
import { pickPaper } from "@/lib/midPaper/rules";
import type { MidBankRules, MidQuestion } from "@/types";

const OFF = { cos: false, poMapping: false, bloom: false };
const part = (over: Partial<MidQuestion["parts"][number]> = {}) => ({ text: "Explain X", cos: [], bloom: "" as const, marks: 10, ...over });

describe("outcome switches", () => {
  it("missing = all on; PO mapping needs COs", () => {
    expect(outcomeSwitches(undefined)).toEqual({ cos: true, poMapping: true, bloom: true });
    expect(outcomeSwitches({ cos: false, poMapping: true })).toEqual({ cos: false, poMapping: false, bloom: true });
  });

  it("a complete question needs a CO / Bloom level only when the college uses them", () => {
    expect(Object.keys(questionErrors([part()], "SINGLE", 10))).toEqual(["parts.0.cos", "parts.0.bloom"]);
    expect(questionErrors([part()], "SINGLE", 10, OFF)).toEqual({});
    expect(Object.keys(questionErrors([part()], "SINGLE", 10, { cos: false, poMapping: false, bloom: true }))).toEqual(["parts.0.bloom"]);
  });

  it("a unit is complete at 10 questions with no Bloom quota when Bloom is off", () => {
    const qs = Array.from({ length: 10 }, () => ({ unit: 1, state: "COMPLETE" as const, parts: [part()] }));
    expect(unitStatus(qs, 1).complete).toBe(false);
    expect(unitStatus(qs, 1, OFF).complete).toBe(true);
  });

  it("setup needs only units without COs, and no mapping without PO mapping", () => {
    const rules = { mids: { "1": [1] }, marks: 10 } as unknown as MidBankRules;
    const outcomes = { units: [{ no: 1, title: "U1" }], cos: [{ id: "CO1", statement: "x" }], mapping: {} };
    expect(setupIssues({ courseName: "B.Tech" }, 1, rules, outcomes).issues.map((i) => i.code)).toEqual(["MAPPING_MISSING"]);
    expect(setupIssues({ courseName: "B.Tech" }, 1, rules, outcomes, null, { cos: true, poMapping: false, bloom: true }).issues).toEqual([]);
    expect(cleanOutcomes({ units: [{ title: "U1" }], cos: [] }).errors).toContain("Add at least one Course Outcome");
    expect(cleanOutcomes({ units: [{ title: "U1" }], cos: [] }, OFF).errors).toEqual([]);
  });

  it("without Bloom the paper is picked by unit only", () => {
    const qs = Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, unit: 1, state: "COMPLETE" as const, parts: [part()] }));
    const slots = [{ no: 1, unit: 1, level: "L2" as const }, { no: 2, unit: 1, level: "L3" as const }];
    expect(pickPaper(qs, slots).shortages.length).toBeGreaterThan(0);
    const r = pickPaper(qs, slots, () => 0, false);
    expect(r.shortages).toEqual([]);
    expect(new Set(r.picked.map((q) => q.id)).size).toBe(2);
  });
});
