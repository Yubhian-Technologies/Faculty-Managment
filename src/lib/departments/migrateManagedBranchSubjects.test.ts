import { describe, expect, it } from "vitest";
import { planSubjectAssignmentMoves } from "@/lib/departments/migrateManagedBranchSubjects";

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
