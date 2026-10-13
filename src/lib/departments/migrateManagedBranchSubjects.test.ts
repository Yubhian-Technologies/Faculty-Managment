import { describe, expect, it } from "vitest";
import { planSubjectAssignmentMoves, planStragglerSectionRenames } from "@/lib/departments/migrateManagedBranchSubjects";

// The one behavior most likely to regress silently: a row already present
// under the branch's own deterministic id must be kept, not overwritten -
// the manager's copy is discarded instead, never cloned on top of it.

describe("planSubjectAssignmentMoves", () => {
  const rows = [
    { id: "s1_bs_1", subjectId: "s1", semester: 1, year: 1 },
    { id: "s2_bs_1", subjectId: "s2", semester: 1, year: 1 },
    { id: "s3_bs_2", subjectId: "s3", semester: 2, year: 2 },
  ];

  it("clones a row with no existing branch copy", () => {
    const plan = planSubjectAssignmentMoves(rows, "eee", new Set(), null);
    expect(plan.toCreate.map((r) => r.id)).toEqual(["s1_bs_1", "s2_bs_1", "s3_bs_2"]);
    expect(plan.toDiscard).toEqual([]);
  });

  it("discards (never overwrites) a row the branch already has under its own deterministic id", () => {
    // s2_eee_1 already exists under EEE - s2's manager-side row must be
    // discarded, not cloned on top of it.
    const plan = planSubjectAssignmentMoves(rows, "eee", new Set(["s2_eee_1"]), null);
    expect(plan.toCreate.map((r) => r.id)).toEqual(["s1_bs_1", "s3_bs_2"]);
    expect(plan.toDiscard.map((r) => r.id)).toEqual(["s2_bs_1"]);
  });

  it("skips a row outside the requested years without creating or discarding it", () => {
    const plan = planSubjectAssignmentMoves(rows, "eee", new Set(), new Set([1]));
    expect(plan.toCreate.map((r) => r.id)).toEqual(["s1_bs_1", "s2_bs_1"]);
    expect(plan.toDiscard).toEqual([]);
    expect(plan.toSkip.map((r) => r.id)).toEqual(["s3_bs_2"]);
  });

  it("a row with no year set is never skipped by a year filter", () => {
    const plan = planSubjectAssignmentMoves(
      [{ id: "s4_bs_1", subjectId: "s4", semester: 1 }],
      "eee",
      new Set(),
      new Set([1])
    );
    expect(plan.toCreate.map((r) => r.id)).toEqual(["s4_bs_1"]);
    expect(plan.toSkip).toEqual([]);
  });
});

describe("planStragglerSectionRenames", () => {
  const sections = [
    { id: "sec1", name: "BSE-CE-A", year: 1 },
    { id: "sec2", name: "BSE-CE-B", year: 1 },
    { id: "sec3", name: "CE-A", year: 2 }, // already the branch's own convention - no manager prefix
    { id: "sec4", name: "OTHER-DEPT-A", year: 1 }, // doesn't start with the manager's code at all
  ];

  it("trims a manager-prefixed section to the branch's own convention", () => {
    const plan = planStragglerSectionRenames(sections, "BSE", "CE", new Set(), null);
    expect(plan).toEqual([
      { sectionId: "sec1", oldName: "BSE-CE-A", newName: "CE-A", year: 1 },
      { sectionId: "sec2", oldName: "BSE-CE-B", newName: "CE-B", year: 1 },
    ]);
  });

  it("never touches a section already in the branch's own convention or outside the manager's prefix", () => {
    const plan = planStragglerSectionRenames(
      [{ id: "sec3", name: "CE-A", year: 2 }, { id: "sec4", name: "OTHER-DEPT-A", year: 1 }],
      "BSE", "CE", new Set(), null
    );
    expect(plan).toEqual([]);
  });

  it("leaves a candidate untouched when it collides with a section the branch already owns", () => {
    const plan = planStragglerSectionRenames(
      [{ id: "sec1", name: "BSE-CE-A", year: 1 }],
      "BSE", "CE", new Set(["CE-A|1"]), null
    );
    expect(plan).toEqual([]);
  });

  it("never claims the same new name twice when two stragglers would collide with each other", () => {
    const plan = planStragglerSectionRenames(
      [
        { id: "sec1", name: "BSE-CE-A", year: 1 },
        { id: "sec2", name: "BSE-CE-A", year: 1 }, // duplicate name, shouldn't happen but must not double-claim
      ],
      "BSE", "CE", new Set(), null
    );
    expect(plan).toEqual([{ sectionId: "sec1", oldName: "BSE-CE-A", newName: "CE-A", year: 1 }]);
  });

  it("skips a section outside the requested years", () => {
    const plan = planStragglerSectionRenames(sections, "BSE", "CE", new Set(), new Set([2]));
    expect(plan).toEqual([]);
  });

  it("is a no-op without both a manager code and a branch code", () => {
    expect(planStragglerSectionRenames(sections, "", "CE", new Set(), null)).toEqual([]);
    expect(planStragglerSectionRenames(sections, "BSE", "", new Set(), null)).toEqual([]);
  });
});
