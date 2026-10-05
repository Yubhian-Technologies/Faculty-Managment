import { describe, expect, it } from "vitest";
import { facultyIdsOf, planDraftFacultyIds } from "../../../scripts/lib/draftFacultyIds.mjs";
import { draftFacultyIds } from "./draftAccess";

describe("facultyIdsOf", () => {
  it("returns the distinct, sorted faculty of a slot list", () => {
    expect(facultyIdsOf([{ facultyId: "f2" }, { facultyId: "f1" }, { facultyId: "f2" }])).toEqual(["f1", "f2"]);
  });
  it("ignores malformed entries instead of crashing", () => {
    expect(facultyIdsOf([null, 5, {}, { facultyId: "" }, { facultyId: 9 }, { facultyId: "f1" }])).toEqual(["f1"]);
    expect(facultyIdsOf(undefined)).toEqual([]);
    expect(facultyIdsOf("nope")).toEqual([]);
  });
  it("agrees with the writer used by the draft route", () => {
    const slots = [{ facultyId: "b" }, { facultyId: "a" }, { facultyId: "b" }];
    expect([...draftFacultyIds(slots)].sort()).toEqual(facultyIdsOf(slots));
  });
});

describe("planDraftFacultyIds", () => {
  const draft = (id: string, slots: unknown, facultyIds?: unknown) => ({ id, data: { slots, ...(facultyIds !== undefined ? { facultyIds } : {}) } });

  it("stamps drafts that have no facultyIds, and records what was there before", () => {
    const plan = planDraftFacultyIds([draft("d1", [{ facultyId: "f1" }])]);
    expect(plan.updates).toEqual([{ id: "d1", facultyIds: ["f1"], previous: null }]);
    expect(plan.alreadyCorrect).toBe(0);
  });

  it("leaves a correct draft alone, whatever the order of its ids", () => {
    const plan = planDraftFacultyIds([draft("d1", [{ facultyId: "f1" }, { facultyId: "f2" }], ["f2", "f1"])]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.alreadyCorrect).toBe(1);
  });

  it("repairs a draft whose facultyIds drifted from its slots", () => {
    const plan = planDraftFacultyIds([draft("d1", [{ facultyId: "f1" }, { facultyId: "f3" }], ["f1"])]);
    expect(plan.updates).toEqual([{ id: "d1", facultyIds: ["f1", "f3"], previous: ["f1"] }]);
  });

  it("an empty draft gets an empty list (so it is indexed, not 'missing')", () => {
    expect(planDraftFacultyIds([draft("d1", [])]).updates).toEqual([{ id: "d1", facultyIds: [], previous: null }]);
    expect(planDraftFacultyIds([draft("d1", [], [])]).updates).toHaveLength(0);
  });

  it("is idempotent: applying the plan and re-planning finds nothing to do", () => {
    const before = [draft("d1", [{ facultyId: "f1" }]), draft("d2", [{ facultyId: "f2" }], ["old"]), draft("d3", [])];
    const plan = planDraftFacultyIds(before);
    const after = before.map((d) => {
      const u = plan.updates.find((x) => x.id === d.id);
      return u ? { id: d.id, data: { ...d.data, facultyIds: u.facultyIds } } : d;
    });
    expect(planDraftFacultyIds(after).updates).toHaveLength(0);
  });

  it("never plans a change to anything but facultyIds", () => {
    const plan = planDraftFacultyIds([draft("d1", [{ facultyId: "f1" }])]);
    expect(Object.keys(plan.updates[0]).sort()).toEqual(["facultyIds", "id", "previous"]);
  });
});
