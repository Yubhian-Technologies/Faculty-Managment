import { describe, expect, it } from "vitest";
import type { DocumentReference } from "firebase-admin/firestore";
import { loadSlotsForSectionAndFaculty } from "./slotQueries";

type Slot = { id: string; sectionId: string; facultyId: string };

function fakeCollege(slots: Slot[]) {
  const calls: string[] = [];
  const collection = {
    where: (field: keyof Slot, op: string, value: string | string[]) => ({
      get: async () => {
        calls.push(`${field} ${op} ${Array.isArray(value) ? value.length : value}`);
        const docs = slots
          .filter((s) => (op === "==" ? s[field] === value : (value as string[]).includes(s[field])))
          .map((s) => ({ id: s.id, data: () => s }));
        return { docs };
      },
    }),
  };
  return { ref: { collection: () => collection } as unknown as DocumentReference, calls };
}

describe("loadSlotsForSectionAndFaculty", () => {
  const slots: Slot[] = [
    { id: "1", sectionId: "A", facultyId: "f1" },
    { id: "2", sectionId: "B", facultyId: "f1" },
    { id: "3", sectionId: "B", facultyId: "f2" },
    { id: "4", sectionId: "C", facultyId: "f9" },
  ];

  it("returns the section's slots plus the faculty's slots elsewhere, each once", async () => {
    const { ref } = fakeCollege(slots);
    const out = await loadSlotsForSectionAndFaculty(ref, "A", ["f1", "f2"]);
    expect(out.map((d) => d.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("never touches unrelated sections and faculty", async () => {
    const { ref } = fakeCollege(slots);
    const out = await loadSlotsForSectionAndFaculty(ref, "A", ["f1"]);
    expect(out.map((d) => d.id)).not.toContain("4");
  });

  it("splits more than 30 faculty into separate in-queries and ignores blanks", async () => {
    const { ref, calls } = fakeCollege(slots);
    const many = Array.from({ length: 65 }, (_, i) => `x${i}`).concat(["", "f1"]);
    await loadSlotsForSectionAndFaculty(ref, "A", many);
    expect(calls.filter((c) => c.startsWith("facultyId in"))).toHaveLength(3);
  });
});
