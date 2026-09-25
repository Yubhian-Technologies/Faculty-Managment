import { describe, expect, it } from "vitest";
import { activeComponentIds, countEntered, examConfigId, isEntryComplete, subjectTypeToExamType } from "./internalExamMarks";
import type { ExamConfigComponent, ExamConfiguration, InternalExamMarkEntry } from "@/types";

// Only the pure half of this module is covered here. resolveExamTypeForSubject
// and resolveExamConfigForBatch both read Firestore, and this repo has no
// Admin-SDK test harness, so they are left to the manual checklist.

const component = (id: string, maxMarks: number, isActive = true): ExamConfigComponent =>
  ({ id, name: id.toUpperCase(), maxMarks, order: 0, isActive });

// Only `components` is read by the functions under test.
const config = (components: ExamConfigComponent[]) => ({ components }) as ExamConfiguration;

const entry = (componentMarks: Record<string, number | null>): InternalExamMarkEntry =>
  ({ studentId: "s1", rollNumber: "22A1", name: "A Student", componentMarks });

describe("examConfigId", () => {
  it("keys a configuration by course, year and exam type", () => {
    expect(examConfigId("crs1", 2, "THEORY")).toBe("crs1_year2_THEORY");
    expect(examConfigId("crs1", 2, "LAB")).toBe("crs1_year2_LAB");
  });

  // Theory and Lab are always two separate documents, never merged - the id is
  // what keeps them apart.
  it("gives Theory and Lab of the same course-year different ids", () => {
    expect(examConfigId("crs1", 3, "THEORY")).not.toBe(examConfigId("crs1", 3, "LAB"));
  });
});

describe("subjectTypeToExamType", () => {
  it("treats PRACTICAL as Lab", () => {
    expect(subjectTypeToExamType("PRACTICAL")).toBe("LAB");
  });

  // Exam Cell configures two buckets, not one per SubjectType.
  it("puts every other subject type in the Theory bucket", () => {
    expect(subjectTypeToExamType("THEORY")).toBe("THEORY");
    expect(subjectTypeToExamType("TUTORIAL")).toBe("THEORY");
    expect(subjectTypeToExamType("PROJECT")).toBe("THEORY");
  });

  it("falls back to Theory for a subject with no type recorded", () => {
    expect(subjectTypeToExamType(undefined)).toBe("THEORY");
  });
});

describe("activeComponentIds", () => {
  it("keeps only the active components, in order", () => {
    expect(activeComponentIds(config([component("mid1", 15), component("mid2", 15, false), component("assign", 10)])))
      .toEqual(["mid1", "assign"]);
  });

  // DIVERGENCE, not a fix: this reads `c.isActive` as truthy, so a component
  // with the flag missing counts as INACTIVE here - while the write path
  // (api/college/exam-configurations/route.ts:162) sums `c.isActive !== false`,
  // where a missing flag counts as ACTIVE. The POST normalises the flag on
  // save (:196), so this can only bite a document written before that existed.
  // Asserted so the difference is visible rather than discovered.
  it("treats a component with no isActive flag as inactive", () => {
    const legacy = { id: "old", name: "OLD", maxMarks: 10, order: 0 } as unknown as ExamConfigComponent;
    expect(activeComponentIds(config([component("mid1", 15), legacy]))).toEqual(["mid1"]);
  });
});

describe("isEntryComplete", () => {
  const ids = ["mid1", "assign"];

  it("is complete once every active component has a value", () => {
    expect(isEntryComplete(entry({ mid1: 12, assign: 8 }), ids)).toBe(true);
  });

  it("is incomplete while any active component is missing", () => {
    expect(isEntryComplete(entry({ mid1: 12 }), ids)).toBe(false);
    expect(isEntryComplete(entry({ mid1: 12, assign: null }), ids)).toBe(false);
  });

  // Zero is a real mark, not "not entered" - the check is `!= null`, so this
  // must stay true if anyone rewrites it as a falsy test.
  it("counts a zero as entered", () => {
    expect(isEntryComplete(entry({ mid1: 0, assign: 0 }), ids)).toBe(true);
  });

  it("ignores marks for components that are no longer active", () => {
    expect(isEntryComplete(entry({ mid1: 12, assign: 8, dropped: 5 }), ids)).toBe(true);
  });

  // BUG (documented, not fixed): an ExamConfiguration whose components are all
  // deactivated makes every entry permanently incomplete, so enteredCount can
  // never reach totalStudents and the faculty's Submit button stays disabled
  // forever. There is no PATCH/DELETE for examConfigurations either, so the
  // deadlock cannot be cleared from the UI. Needs Exam Cell's call on what the
  // right answer is - "no components" arguably means nothing to enter.
  it("reports every entry incomplete when no component is active", () => {
    expect(isEntryComplete(entry({ mid1: 12 }), [])).toBe(false);
    expect(isEntryComplete(entry({}), [])).toBe(false);
  });
});

describe("countEntered", () => {
  const cfg = config([component("mid1", 15), component("mid2", 15, false), component("assign", 10)]);

  it("counts only the fully-entered students", () => {
    const entries = [
      entry({ mid1: 12, assign: 8 }),   // complete
      entry({ mid1: 12 }),              // missing assign
      entry({ mid1: 0, assign: 0 }),    // complete - zeros count
      entry({}),                        // nothing entered
    ];
    expect(countEntered(entries, cfg)).toBe(2);
  });

  it("does not require marks for a deactivated component", () => {
    // mid2 is inactive, so leaving it out must not hold the entry back.
    expect(countEntered([entry({ mid1: 12, assign: 8 })], cfg)).toBe(1);
  });

  it("is zero for an empty roster", () => {
    expect(countEntered([], cfg)).toBe(0);
  });

  // Same deadlock as above, seen through the count the UI actually shows.
  it("is zero for every student when no component is active", () => {
    expect(countEntered([entry({ mid1: 12 }), entry({ mid1: 9 })], config([component("mid1", 15, false)]))).toBe(0);
  });
});
