import { describe, expect, it } from "vitest";
import { bloomLevelsOf, cleanBloomLevels, DEFAULT_BLOOM_LEVELS } from "./bloom";
import { bloomNeeds, unitStatus } from "./rules";
import { cleanTemplate, defaultSequenceFor } from "@/lib/midPaper/rules";
import type { MidQuestion } from "@/types";

describe("the college's Bloom's levels", () => {
  it("missing = the old default (L2-L4, 3 each); a saved list is read in L1..L6 order", () => {
    expect(bloomLevelsOf(undefined)).toEqual(DEFAULT_BLOOM_LEVELS);
    expect(bloomLevelsOf([{ id: "L5", name: "Evaluate", min: 1 }, { id: "L1", name: "", min: 2 }]).map((l) => `${l.id}:${l.name}:${l.min}`)).toEqual(["L1:Remember:2", "L5:Evaluate:1"]);
  });
  it("the Exam Cell's edit: names required, minimums 0-10 adding up to at most a unit's 10 questions", () => {
    expect(cleanBloomLevels([{ id: "L1", name: "Recall", min: 2 }, { id: "L6", name: "Create", min: 1 }])).toEqual({ value: [{ id: "L1", name: "Recall", min: 2 }, { id: "L6", name: "Create", min: 1 }], errors: [] });
    expect(cleanBloomLevels([]).errors).toContain("Pick at least one Bloom's level");
    expect(cleanBloomLevels([{ id: "L2", name: " ", min: 0 }]).errors).toContain("L2 needs a name");
    expect(cleanBloomLevels([{ id: "L2", name: "A", min: 6 }, { id: "L3", name: "B", min: 5 }]).errors).toContain("The minimums add up to more than the 10 questions of a unit");
  });
  it("a bank unit is complete when each of ITS levels reaches its minimum", () => {
    const levels = [{ id: "L1" as const, name: "Remember", min: 2 }, { id: "L5" as const, name: "Evaluate", min: 1 }];
    const q = (slot: number, bloom: string) => ({ unit: 1, state: "COMPLETE", parts: [{ bloom }] }) as unknown as MidQuestion;
    const qs = Array.from({ length: 10 }, (_, i) => q(i + 1, i < 2 ? "L1" : i === 2 ? "L5" : "L1"));
    expect(unitStatus(qs, 1, undefined, levels).complete).toBe(true);
    const short = qs.map((x) => ({ ...x, parts: [{ bloom: "L1" }] })) as unknown as MidQuestion[];
    expect(unitStatus(short, 1, undefined, levels).complete).toBe(false);
    expect(bloomNeeds(unitStatus(short, 1, undefined, levels).bloom, levels).find((b) => b.level === "L5")).toMatchObject({ count: 0, need: 1, min: 1 });
  });
  it("the paper template's level sequences use the college's levels", () => {
    expect(defaultSequenceFor("L2", ["L2", "L3", "L4"])).toEqual(["L2", "L3", "L3", "L4", "L4", "L2"]);
    expect(defaultSequenceFor("L1", ["L1", "L2"])).toEqual(["L1", "L2", "L1", "L2", "L1", "L2"]);
    const t = cleanTemplate({ sequences: { L1: ["L1", "L2", "L1", "L2", "L1", "L2"], L2: ["L2", "L1", "L2", "L1", "L2", "L1"] }, units: { "1": [1, 1, 1, 1, 1, 1] } }, ["L1", "L2"]);
    expect(t.errors).toEqual([]);
    expect(cleanTemplate({ sequences: { L1: ["L1", "L4", "L1", "L2", "L1", "L2"], L2: ["L2", "L1", "L2", "L1", "L2", "L1"] }, units: { "1": [1, 1, 1, 1, 1, 1] } }, ["L1", "L2"]).errors[0]).toContain("Starting at L1");
  });
});
