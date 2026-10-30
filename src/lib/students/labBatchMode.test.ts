import { describe, expect, it } from "vitest";
import { effectiveLabBatch, labBatchSettingId, loadLabBatchModes, withoutBatch, type LabBatchMode, type LabBatchModes } from "@/lib/students/labBatchMode";
import { FakeFirestore } from "@/lib/testing/fakeFirestore.testutil";

const modes: LabBatchModes = new Map<string, LabBatchMode>([
  [labBatchSettingId("s1", "physLab"), { batchWise: false, batchByFaculty: {} }],
  [labBatchSettingId("s1", "chemLab"), { batchWise: true, batchByFaculty: { facA: "Batch 1", facB: "Batch 2" } }],
  [labBatchSettingId("s1", "bioLab"), { batchWise: true, batchByFaculty: {} }],
]);

describe("effectiveLabBatch", () => {
  it("drops the batch for a lab set to no batch", () => {
    expect(effectiveLabBatch("Batch 1", modes, "s1", "physLab", "facA")).toBeUndefined();
  });
  it("gives each faculty of a batch-wise lab their own batch, whatever the period says", () => {
    expect(effectiveLabBatch("Batch 2", modes, "s1", "chemLab", "facA")).toBe("Batch 1");
    expect(effectiveLabBatch(undefined, modes, "s1", "chemLab", "facB")).toBe("Batch 2");
  });
  it("falls back to the period's own label for a faculty with no batch of their own", () => {
    expect(effectiveLabBatch("Batch 2", modes, "s1", "chemLab", "facC")).toBe("Batch 2");
    expect(effectiveLabBatch("Batch 1", modes, "s1", "bioLab", "facA")).toBe("Batch 1");
    expect(effectiveLabBatch(undefined, modes, "s1", "bioLab", "facA")).toBeUndefined();
  });
  it("keeps the period's batch when the lab has no setting (unchanged behaviour)", () => {
    expect(effectiveLabBatch("Batch 2", modes, "s1", "other", "facA")).toBe("Batch 2");
    expect(effectiveLabBatch("Batch 2", new Map(), "s1", "physLab", "facA")).toBe("Batch 2");
    expect(effectiveLabBatch(undefined, new Map(), "s1", "physLab", "facA")).toBeUndefined();
  });
  it("is scoped to the section", () => {
    expect(effectiveLabBatch("Batch 1", modes, "s2", "physLab", "facA")).toBe("Batch 1");
    expect(effectiveLabBatch(undefined, modes, "s2", "chemLab", "facA")).toBeUndefined();
  });
});

describe("withoutBatch", () => {
  const map = { facA: "Batch 1", facB: "Batch 2", facC: " batch 1 " };
  it("drops every faculty on the deleted batch, case/whitespace-insensitively", () => {
    expect(withoutBatch(map, "BATCH 1")).toEqual({ facB: "Batch 2" });
  });
  it("returns the same object when nobody was on it", () => {
    expect(withoutBatch(map, "Batch 9")).toBe(map);
  });
});

// Edge case 1: one period, two labs/batches, two faculty. Each faculty's
// TimetableSlot carries its own labBatch - these tests confirm the two
// faculty resolve to two DIFFERENT batches (so each rosters only their own
// half of the section, see sectionRoster.ts) under every configuration the
// section's faculty incharge can set via SectionLabBatchSetting, exercised
// end-to-end through loadLabBatchModes (the Firestore-reading half the tests
// above don't touch - they hand effectiveLabBatch an already-built map).
const C = "colleges/c1";

describe("effectiveLabBatch + loadLabBatchModes - split lab roster isolation", () => {
  it("with no setting at all, each faculty keeps their own slot's batch label", async () => {
    const db = new FakeFirestore();
    const loaded = await loadLabBatchModes(db as unknown as FirebaseFirestore.Firestore, "c1", [
      { sectionId: "sec1", subjectId: "lab1" },
    ]);
    expect(effectiveLabBatch("A", loaded, "sec1", "lab1", "facA")).toBe("A");
    expect(effectiveLabBatch("B", loaded, "sec1", "lab1", "facB")).toBe("B");
  });

  it("batch-wise setting: two faculty each get their OWN mapped batch, even if the slot's own label disagrees", async () => {
    const db = new FakeFirestore({
      [`${C}/sectionLabBatchSettings/${labBatchSettingId("sec1", "lab1")}`]: {
        batchWise: true,
        batchByFaculty: { facA: "Batch 1", facB: "Batch 2" },
      },
    });
    const loaded = await loadLabBatchModes(db as unknown as FirebaseFirestore.Firestore, "c1", [
      { sectionId: "sec1", subjectId: "lab1" },
    ]);
    expect(effectiveLabBatch("stale-label", loaded, "sec1", "lab1", "facA")).toBe("Batch 1");
    expect(effectiveLabBatch("stale-label", loaded, "sec1", "lab1", "facB")).toBe("Batch 2");
    // Never the same batch for the two faculty - that would merge their rosters.
    expect(effectiveLabBatch("x", loaded, "sec1", "lab1", "facA")).not.toBe(
      effectiveLabBatch("x", loaded, "sec1", "lab1", "facB")
    );
  });

  it("batch-wise setting with a faculty not yet mapped falls back to the slot's own label", async () => {
    const db = new FakeFirestore({
      [`${C}/sectionLabBatchSettings/${labBatchSettingId("sec1", "lab1")}`]: {
        batchWise: true,
        batchByFaculty: { facA: "Batch 1" },
      },
    });
    const loaded = await loadLabBatchModes(db as unknown as FirebaseFirestore.Firestore, "c1", [
      { sectionId: "sec1", subjectId: "lab1" },
    ]);
    expect(effectiveLabBatch("C", loaded, "sec1", "lab1", "facB")).toBe("C");
  });

  it("'no batch' mode collapses BOTH faculty to the whole section (undefined), never a merged roster bug", async () => {
    const db = new FakeFirestore({
      [`${C}/sectionLabBatchSettings/${labBatchSettingId("sec1", "lab1")}`]: { batchWise: false, batchByFaculty: {} },
    });
    const loaded = await loadLabBatchModes(db as unknown as FirebaseFirestore.Firestore, "c1", [
      { sectionId: "sec1", subjectId: "lab1" },
    ]);
    expect(effectiveLabBatch("A", loaded, "sec1", "lab1", "facA")).toBeUndefined();
    expect(effectiveLabBatch("B", loaded, "sec1", "lab1", "facB")).toBeUndefined();
  });
});
