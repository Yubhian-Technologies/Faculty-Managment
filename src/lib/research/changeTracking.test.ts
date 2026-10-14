import { describe, expect, it } from "vitest";
import { buildEditTrail, diffFields, displayValue, summarizeFieldChanges } from "./changeTracking";

const NOW = new Date("2026-10-13T10:00:00Z");

const approved = {
  status: "APPROVED",
  eventTitle: "CodeFest",
  venue: "Hall A",
  durationHours: 8,
  evaluators: [{ name: "Dr. Rao", organization: "IIT" }],
  remarks: "",
};

function trail(existing: Record<string, unknown>, incoming: Record<string, unknown>) {
  return buildEditTrail({
    existing, incoming, moduleSlug: "hackathons", editorUid: "u1", editorName: "Asha", now: NOW,
  });
}

describe("buildEditTrail", () => {
  it("reports exactly the fields that changed on an approved record, with labels", () => {
    const t = trail(approved, { eventTitle: "CodeFest 2", venue: "Hall A", durationHours: 10 });
    expect(t.reopened).toBe(true);
    expect(t.changes.map((c) => [c.key, c.before, c.after])).toEqual([
      ["eventTitle", "CodeFest", "CodeFest 2"],
      ["durationHours", "8", "10"],
    ]);
    expect((t.updates.pendingChanges as { changedByName: string }).changedByName).toBe("Asha");
    expect(t.updates.verifiedSnapshot).toMatchObject({ eventTitle: "CodeFest", venue: "Hall A" });
  });

  it("keeps comparing against the verified version across several edits", () => {
    const first = trail(approved, { venue: "Hall B" });
    const afterFirst = { ...approved, status: "PENDING", venue: "Hall B", ...first.updates };
    const second = trail(afterFirst, { venue: "Hall C", remarks: "added" });
    expect(second.changes.map((c) => [c.key, c.before, c.after])).toEqual([
      ["venue", "Hall A", "Hall C"],
      ["remarks", "", "added"],
    ]);
    // The baseline never drifts to the first edit's values.
    expect(second.updates.verifiedSnapshot).toMatchObject({ venue: "Hall A" });
  });

  it("shows no change when an edit puts the verified values back", () => {
    const first = trail(approved, { venue: "Hall B" });
    const afterFirst = { ...approved, status: "PENDING", venue: "Hall B", ...first.updates };
    const second = trail(afterFirst, { venue: "Hall A" });
    expect(second.changes).toEqual([]);
  });

  it("keeps the trail through a rejection (status no longer APPROVED)", () => {
    const first = trail(approved, { venue: "Hall B" });
    const rejected = { ...approved, status: "REJECTED", venue: "Hall B", ...first.updates };
    const again = trail(rejected, { venue: "Hall D" });
    expect(again.reopened).toBe(false);
    expect(again.changes).toHaveLength(1);
    expect(again.changes[0]).toMatchObject({ before: "Hall A", after: "Hall D" });
  });

  it("ignores routing/review bookkeeping and never reports it as a change", () => {
    const t = trail(approved, { venue: "Hall B", status: "PENDING", updatedAt: NOW, reviewDepartment: "CSE" });
    expect(t.changes.map((c) => c.key)).toEqual(["venue"]);
  });

  it("does not invent a change for a field that did not exist when it was verified", () => {
    const first = trail(approved, { venue: "Hall B" });
    const later = { ...approved, status: "PENDING", venue: "Hall B", ...first.updates };
    const second = trail(later, { venue: "Hall B", sponsorName: "ACME" });
    expect(second.changes.map((c) => [c.key, c.before, c.after])).toEqual([
      ["venue", "Hall A", "Hall B"],
      ["sponsorName", "", "ACME"],
    ]);
  });

  it("has no trail for a record that was never approved", () => {
    const t = trail({ ...approved, status: "PENDING" }, { venue: "Hall Z" });
    expect(t).toEqual({ updates: {}, changes: [], reopened: false });
  });

  it("treats null, empty string and empty list as the same nothing", () => {
    const t = trail({ ...approved, remarks: null, evaluators: [] }, { remarks: "", evaluators: [] });
    expect(t.changes).toEqual([]);
  });

  it("describes a changed list so a reviewer can read it", () => {
    const t = trail(approved, { evaluators: [{ name: "Dr. Rao", organization: "IIT" }, { name: "Prof. Sen", organization: "NIT" }] });
    expect(t.changes[0].before).toContain("Dr. Rao");
    expect(t.changes[0].before).not.toContain("Prof. Sen");
    expect(t.changes[0].after).toContain("Prof. Sen");
    expect(t.changes[0].after).not.toMatch(/\[object|\{"/);
  });
});

describe("helpers", () => {
  it("renders values without JSON noise", () => {
    expect(displayValue(true)).toBe("Yes");
    expect(displayValue(null)).toBe("");
    expect(displayValue({ a: "", b: 2 })).toBe("B: 2");
  });

  it("summarizes for a notification", () => {
    const changes = diffFields({ a: 1, b: 1, c: 1, d: 1 }, { a: 2, b: 2, c: 2, d: 2 }, "none");
    expect(summarizeFieldChanges(changes)).toBe("A, B, C and 1 more");
    expect(summarizeFieldChanges([])).toContain("no field values differ");
  });
});
