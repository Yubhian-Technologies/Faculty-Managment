import { describe, expect, it } from "vitest";
import { FieldValue } from "firebase-admin/firestore";
import { syncTrainingEntryCoConductors } from "./syncTrainingEntryCoConductors";
import type { TrainingEntry } from "@/types";

// Minimal Firestore double: facultyMembers docs keyed by id, a transaction that
// supports getAll + update (dot-path keys set on the doc's own data object).
function fakeDb(docs: Record<string, Record<string, unknown>>) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const ref = (id: string) => ({ id });
  const db = {
    collection: () => ({
      doc: () => ({ collection: () => ({ doc: (id: string) => ref(id) }) }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        getAll: async (...refs: { id: string }[]) =>
          refs.map((r) => ({ exists: r.id in docs, data: () => docs[r.id] })),
        update: (r: { id: string }, data: Record<string, unknown>) => updates.push({ id: r.id, data }),
      };
      await fn(tx);
    },
  };
  return { db: db as unknown as FirebaseFirestore.Firestore, updates };
}

const master: TrainingEntry = {
  id: "e1",
  type: "FDP",
  titleOfTheProgram: "FDP on ML",
  nameOfTheFacultyCoordinator: "",
  participatedOrConducted: "CONDUCTED",
  coConductingFaculty: [{ order: 2, facultyId: "f2", name: "B", department: "CSE" }],
};

describe("syncTrainingEntryCoConductors", () => {
  it("writes the new-key list to a co-conductor and deletes the legacy list key", async () => {
    // f2's doc is still un-migrated: legacy list name + legacy entry keys.
    const { db, updates } = fakeDb({
      f2: { academicProfile: { trainingEntries: [{ id: "keep", type: "WORKSHOP", title: "Old", organizer: "X", role: "PARTICIPATED" }] } },
    });
    await syncTrainingEntryCoConductors(db, "c1", "f1", "Owner A", undefined, [master]);

    expect(updates).toHaveLength(1);
    const { id, data } = updates[0];
    expect(id).toBe("f2");
    const list = data["academicProfile.fdpsWorkshopsMoocsCertifications"] as TrainingEntry[];
    // the co-conductor's existing (legacy-shaped) entry is lifted, not lost
    expect(list[0]).toMatchObject({ id: "keep", titleOfTheProgram: "Old", nameOfTheFacultyCoordinator: "X", participatedOrConducted: "PARTICIPATED" });
    // the synced copy carries the coordinator's name and is flagged
    expect(list[1]).toMatchObject({
      id: "e1", titleOfTheProgram: "FDP on ML", nameOfTheFacultyCoordinator: "Owner A",
      ownerFacultyId: "f1", ownerFacultyName: "Owner A", isCoConductedCopy: true,
    });
    expect(list.some((e) => "title" in e || "organizer" in e || "coConductors" in e)).toBe(false);
    // a doc never holds both the new list and its legacy twin
    expect(data["academicProfile.trainingEntries"]).toEqual(FieldValue.delete());
  });

  it("accepts a legacy-shaped previous list and removes the entry from a dropped co-conductor", async () => {
    const legacyPrev = [{
      id: "e1", type: "FDP", title: "FDP on ML", organizer: "Owner A", role: "CONDUCTED",
      coConductors: [{ order: 2, facultyId: "f3", name: "C", department: "CSE" }],
    }] as unknown as TrainingEntry[];
    const { db, updates } = fakeDb({
      f3: { academicProfile: { fdpsWorkshopsMoocsCertifications: [{ id: "e1", type: "FDP", titleOfTheProgram: "FDP on ML", nameOfTheFacultyCoordinator: "Owner A" }] } },
      f2: { academicProfile: {} },
    });
    await syncTrainingEntryCoConductors(db, "c1", "f1", "Owner A", legacyPrev, [master]);

    const byId = Object.fromEntries(updates.map((u) => [u.id, u.data]));
    expect(byId.f3["academicProfile.fdpsWorkshopsMoocsCertifications"]).toEqual([]);
    expect((byId.f2["academicProfile.fdpsWorkshopsMoocsCertifications"] as TrainingEntry[])[0].id).toBe("e1");
  });

  it("does nothing when no entry involves a co-conductor", async () => {
    const { db, updates } = fakeDb({});
    await syncTrainingEntryCoConductors(db, "c1", "f1", "Owner A", [], [{ ...master, coConductingFaculty: [] }]);
    expect(updates).toHaveLength(0);
  });
});
