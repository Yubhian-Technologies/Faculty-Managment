import { describe, expect, it } from "vitest";
import { effectiveLabBatch, labBatchSettingId, type LabBatchMode, type LabBatchModes } from "@/lib/students/labBatchMode";

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
