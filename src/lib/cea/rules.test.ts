import { describe, expect, it } from "vitest";
import { CeaRuleError, cleanCeaPlan, cleanCeaSettings, defaultCeaSettings, planChanges, scaleCea, WRITTEN } from "./rules";

const settings = defaultCeaSettings("cat1", "B.Tech", "R26");
const units = [1, 2, 3, 4, 5].map((n) => ({ unit: n, title: `Unit ${n}` }));
const plan = (over: Record<number, { typeId?: string; when?: string }> = {}) =>
  units.map((u) => ({ unit: u.unit, typeId: "ASSIGNMENT", when: "CLASS", ...over[u.unit] }));

describe("CEA settings", () => {
  it("needs a real regulation (not ALL) and keeps the written type", () => {
    expect(() => cleanCeaSettings({ ...settings, regulation: "ALL" })).toThrow(/regulation/);
    const s = cleanCeaSettings({ ...settings, types: [{ label: "Quiz" }, { label: "Quiz " }].slice(0, 1) });
    expect(s.types.map((t) => t.id)).toEqual([WRITTEN, "QUIZ"]);
    expect(() => cleanCeaSettings({ ...settings, types: [{ label: "Quiz" }, { label: "Quiz" }] })).toThrow(/twice/);
    expect(() => cleanCeaSettings({ ...settings, unitMarks: 0 })).toThrow(/per unit/);
  });
});

describe("CEA plan", () => {
  it("every unit once; a with-Mid unit is a written test; one unit per Mid; only Mids the college runs", () => {
    const ok = cleanCeaPlan(plan({ 2: { when: "MID1", typeId: "QUIZ" }, 4: { when: "MID2" } }), units, settings, 2);
    expect(ok.map((u) => [u.unit, u.typeId, u.when])).toEqual([[1, "ASSIGNMENT", "CLASS"], [2, WRITTEN, "MID1"], [3, "ASSIGNMENT", "CLASS"], [4, WRITTEN, "MID2"], [5, "ASSIGNMENT", "CLASS"]]);
    expect(() => cleanCeaPlan(plan().slice(0, 4), units, settings, 2)).toThrow(/missing: unit 5/);
    expect(() => cleanCeaPlan(plan({ 1: { when: "MID1" }, 2: { when: "MID1" } }), units, settings, 2)).toThrow(/Only one unit/);
    expect(() => cleanCeaPlan(plan({ 1: { when: "MID3" } }), units, settings, 2)).toThrow(CeaRuleError);
    expect(() => cleanCeaPlan(plan({ 1: { typeId: "DANCE" } }), units, settings, 2)).toThrow(/type/);
    expect(() => cleanCeaPlan([...plan(), { unit: 6, typeId: "QUIZ", when: "CLASS" }], units, settings, 2)).toThrow(/isn't in the syllabus/);
  });
  it("history text and scaling (sum, then scale)", () => {
    const a = cleanCeaPlan(plan(), units, settings, 2), b = cleanCeaPlan(plan({ 3: { when: "MID1" } }), units, settings, 2);
    expect(planChanges(a, b, (id) => id)).toBe("Unit 3: ASSIGNMENT In class -> WRITTEN With Mid 1");
    expect(planChanges([], b, (id) => id)).toBe("Plan made");
    expect(scaleCea([10, 8, 9, 7, 8], 10, 30)).toBe(25);      // 42 / 50 x 30 = 25.2
    expect(scaleCea([10, null, 9, 7, 8], 10, 30)).toBe(20);   // 34 / 50 x 30 = 20.4
    expect(scaleCea([10, 10, 10, 10, 5], 10, 50)).toBe(45);   // same max: as entered
    expect(scaleCea([null, null], 10, 30)).toBeNull();
  });
});
