import { describe, expect, it } from "vitest";
import { compareCurriculum, subjectGroupRank } from "./curriculumOrder";
import { groupAllocationByType } from "@/lib/timetable/timetableHeader";

describe("subject order shared by the timetable list and the attendance report", () => {
  it("groups like the timetable: Theory, Practical, Co-Curricular", () => {
    expect(subjectGroupRank({ type: "THEORY" })).toBeLessThan(subjectGroupRank({ type: "PRACTICAL" }));
    expect(subjectGroupRank({ type: "THEORY", isNonTeachingLoad: true })).toBeGreaterThan(subjectGroupRank({ type: "PRACTICAL" }));
    expect(subjectGroupRank({ name: "Applied Chemistry Lab" })).toBe(subjectGroupRank({ type: "PRACTICAL" }));
    expect(subjectGroupRank({ name: "Applied Chemistry" })).toBe(subjectGroupRank({ type: "THEORY" }));
  });

  it("matches the timetable's own grouping for every kind", () => {
    const entries = [
      { name: "Counseling", isNonTeachingLoad: true, subjectType: "THEORY" },
      { name: "PPS Lab", subjectType: "PRACTICAL" },
      { name: "Engineering Drawing", subjectType: "THEORY" },
      { name: "Idea Lab" },
    ].map((e) => ({ code: "", shortCode: "", faculty: "", labBatches: [], hoursPerWeek: 1, ...e })) as Parameters<typeof groupAllocationByType>[0];
    const timetable = groupAllocationByType(entries).flatMap((g) => g.entries.map((x) => x.name));
    const report = [...entries].sort((a, b) =>
      subjectGroupRank({ type: a.subjectType, isNonTeachingLoad: a.isNonTeachingLoad, name: a.name })
      - subjectGroupRank({ type: b.subjectType, isNonTeachingLoad: b.isNonTeachingLoad, name: b.name })).map((x) => x.name);
    expect(report).toEqual(timetable);
  });

  it("curriculum position first, then code", () => {
    const list = [{ serial: 3, code: "A" }, { serial: 1, code: "Z" }, { code: "B" }, { serial: 2, code: "C" }];
    expect([...list].sort(compareCurriculum).map((x) => x.code)).toEqual(["Z", "C", "A", "B"]);
  });
});
