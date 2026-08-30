import { describe, expect, it } from "vitest";
import {
  buildDistributionPlan,
  validateDistributionPlan,
  validateStudentNames,
  type DistributionSection,
  type DistributionStudent,
} from "./distributionPlan";

function student(id: string, name: string, section = ""): DistributionStudent {
  return { id, name, section };
}

function section(id: string, name: string): DistributionSection {
  return { id, name };
}

describe("buildDistributionPlan", () => {
  const students = [
    student("1", "Adams Ravi"),
    student("2", "Baker Nikhil"),
    student("3", "Carter Neha"),
    student("4", "Davis Meera"),
    student("5", "Evans Kiran"),
    student("6", "Francis Rahul"),
  ];
  const sections = [section("a", "BSP-IT-A"), section("b", "BSP-IT-B"), section("c", "BSP-IT-C")];

  it("deals contiguous alphabetical blocks to sections in name order", () => {
    const plan = buildDistributionPlan(students, sections);
    expect(plan.perSection.map((s) => s.studentIds)).toEqual([
      ["1", "2"], // Adams, Baker -> A
      ["3", "4"], // Carter, Davis -> B
      ["5", "6"], // Evans, Francis -> C
    ]);
  });

  it("gives the same result regardless of the order sections are passed in (checkbox click order)", () => {
    const clickOrders = [
      [sections[0], sections[1], sections[2]],
      [sections[2], sections[0], sections[1]],
      [sections[1], sections[2], sections[0]],
      [sections[2], sections[1], sections[0]],
    ];
    const results = clickOrders.map((order) => buildDistributionPlan(students, order).perSection);
    for (const result of results.slice(1)) {
      expect(result).toEqual(results[0]);
    }
  });

  it("gives the same result regardless of student fetch order", () => {
    const shuffled = [students[3], students[0], students[5], students[1], students[4], students[2]];
    const a = buildDistributionPlan(students, sections).perSection;
    const b = buildDistributionPlan(shuffled, sections).perSection;
    expect(b).toEqual(a);
  });

  it("only produces moves for students whose section actually changes", () => {
    const already = [
      student("1", "Adams Ravi", "BSP-IT-A"),
      student("2", "Baker Nikhil", "BSP-IT-A"),
      student("3", "Carter Neha", "BSP-IT-B"),
      student("4", "Davis Meera", "BSP-IT-B"),
      student("5", "Evans Kiran", "BSP-IT-C"),
      student("6", "Francis Rahul", "BSP-IT-C"),
    ];
    const plan = buildDistributionPlan(already, sections);
    expect(plan.moves).toEqual([]);
    expect(plan.movedCount).toBe(0);
    expect(plan.totalStudents).toBe(6);
  });

  it("is idempotent: re-planning a plan's own output produces zero further moves", () => {
    const plan = buildDistributionPlan(students, sections);
    const afterMove = students.map((s) => {
      const placed = plan.perSection.find((sec) => sec.studentIds.includes(s.id));
      return { ...s, section: placed?.sectionName ?? s.section };
    });
    const secondPlan = buildDistributionPlan(afterMove, sections);
    expect(secondPlan.moves).toEqual([]);
  });

  it("redistributes an existing full cohort, moving some already-placed students, when new students are added", () => {
    // 30/30/30 already placed, evenly.
    const existing: DistributionStudent[] = [];
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (let i = 0; i < 90; i++) {
      const bucket = i < 30 ? "BSP-IT-A" : i < 60 ? "BSP-IT-B" : "BSP-IT-C";
      existing.push(student(`e${i}`, `${letters[i % 26]}surname Student${i}`, bucket));
    }
    // 100 more, unassigned.
    const fresh: DistributionStudent[] = [];
    for (let i = 0; i < 100; i++) {
      fresh.push(student(`f${i}`, `${letters[(i + 3) % 26]}surname NewStudent${i}`, ""));
    }
    const plan = buildDistributionPlan([...existing, ...fresh], sections);
    expect(plan.totalStudents).toBe(190);
    const finalSizes = plan.perSection.map((s) => s.studentIds.length);
    expect(finalSizes.reduce((a, b) => a + b, 0)).toBe(190);
    expect(Math.max(...finalSizes) - Math.min(...finalSizes)).toBeLessThanOrEqual(1);
    // Some of the originally-placed 90 must have moved, since 190/3 != 30/30/30.
    const movedExistingCount = plan.moves.filter((m) => m.studentId.startsWith("e")).length;
    expect(movedExistingCount).toBeGreaterThan(0);
  });

  it("handles more sections than students without fabricating anyone", () => {
    const plan = buildDistributionPlan([student("1", "Adams Ravi"), student("2", "Baker Nikhil")], sections);
    expect(plan.perSection.map((s) => s.studentIds.length)).toEqual([1, 1, 0]);
    expect(plan.totalStudents).toBe(2);
  });

  it("handles a single section by giving it everyone", () => {
    const plan = buildDistributionPlan(students, [sections[0]]);
    expect(plan.perSection).toHaveLength(1);
    expect(plan.perSection[0].studentIds).toHaveLength(6);
  });
});

describe("validateStudentNames", () => {
  it("flags empty and whitespace-only names, keeps the rest valid", () => {
    const input = [
      student("1", "Adams Ravi"),
      student("2", ""),
      student("3", "   "),
      student("4", "Baker Nikhil"),
    ];
    const { valid, invalid } = validateStudentNames(input);
    expect(valid.map((s) => s.id)).toEqual(["1", "4"]);
    expect(invalid.map((s) => s.id)).toEqual(["2", "3"]);
  });

  it("treats undefined name as invalid", () => {
    const { invalid } = validateStudentNames([{ id: "1", name: undefined }]);
    expect(invalid).toHaveLength(1);
  });
});

describe("validateDistributionPlan", () => {
  const students = [student("1", "Adams Ravi"), student("2", "Baker Nikhil"), student("3", "Carter Neha")];
  const sections = [section("a", "A"), section("b", "B")];

  it("passes for a correctly built plan", () => {
    const plan = buildDistributionPlan(students, sections);
    expect(() =>
      validateDistributionPlan(plan, new Set(students.map((s) => s.id)), new Set(sections.map((s) => s.id)))
    ).not.toThrow();
  });

  it("throws if the assigned count doesn't match the cohort", () => {
    const plan = buildDistributionPlan(students, sections);
    expect(() =>
      validateDistributionPlan(plan, new Set(["1", "2"]), new Set(sections.map((s) => s.id)))
    ).toThrow();
  });

  it("throws if a plan targets a section outside the selected set", () => {
    const plan = buildDistributionPlan(students, sections);
    expect(() =>
      validateDistributionPlan(plan, new Set(students.map((s) => s.id)), new Set(["a"]))
    ).toThrow();
  });

  it("throws if section sizes differ by more than one", () => {
    const unbalanced = {
      perSection: [
        { sectionId: "a", sectionName: "A", studentIds: ["1", "2", "3"] },
        { sectionId: "b", sectionName: "B", studentIds: [] },
      ],
      moves: [],
      totalStudents: 3,
      movedCount: 0,
    };
    expect(() =>
      validateDistributionPlan(unbalanced, new Set(["1", "2", "3"]), new Set(["a", "b"]))
    ).toThrow();
  });
});
