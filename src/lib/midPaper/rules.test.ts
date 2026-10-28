import { describe, expect, it } from "vitest";
import type { BloomLevel } from "@/types";
import { cleanTemplate, DEFAULT_SEQUENCES, defaultUnits, paperSlots, pickPaper, questionLevel } from "./rules";

const q = (id: string, unit: number, ...levels: BloomLevel[]) => ({ id, unit, state: "COMPLETE" as const, parts: levels.map((bloom) => ({ text: id, cos: ["CO1"], bloom })) });

describe("mid question paper", () => {
  it("template: a sequence per starting level, units spread equally", () => {
    const ok = cleanTemplate({ sequences: DEFAULT_SEQUENCES, units: { "2": defaultUnits(2), "3": defaultUnits(3) } });
    expect(ok.errors).toEqual([]);
    expect(defaultUnits(3)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(cleanTemplate({ sequences: { ...DEFAULT_SEQUENCES, L3: ["L2", "L3", "L3", "L4", "L4", "L2"] }, units: { "2": defaultUnits(2) } }).errors).toEqual(["Starting at L3: Question 1 must be L3"]);
    expect(cleanTemplate({ sequences: DEFAULT_SEQUENCES, units: { "2": [1, 1, 1, 1, 2, 2] } }).errors[0]).toContain("same number of questions (now 4 / 2)");
  });

  it("a question's level is the one all its parts share", () => {
    expect(questionLevel(q("a", 1, "L2", "L2"))).toBe("L2");
    expect(questionLevel(q("a", 1, "L2", "L3"))).toBeNull();
  });

  it("slots follow the template for the Mid's real units; picks are distinct, of the right unit + level", () => {
    const { slots } = paperSlots([3, 4], { sequences: DEFAULT_SEQUENCES, units: { "2": defaultUnits(2) } }, "L2");
    expect(slots.map((s) => `${s.unit}${s.level}`)).toEqual(["3L2", "3L3", "4L3", "4L4", "3L4", "4L2"]);
    const bank = [q("a", 3, "L2"), q("b", 3, "L3"), q("c", 4, "L3"), q("d", 4, "L4", "L4"), q("e", 3, "L4"), q("f", 4, "L2"), q("g", 3, "L2")];
    const r = pickPaper(bank, slots, () => 0);
    expect(r.shortages).toEqual([]);
    expect(r.picked.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(r.candidates[1].map((x) => x.id)).toEqual(["a", "g"]);
    expect(pickPaper(bank.filter((x) => x.id !== "e"), slots).shortages).toEqual(["Unit 3 has 0 complete L4 questions with every part at L4; the paper needs 1"]);
  });
});
