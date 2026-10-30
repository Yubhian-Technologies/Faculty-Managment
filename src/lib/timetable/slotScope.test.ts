import { describe, expect, it } from "vitest";
import { buildMidWindows, slotActiveOn } from "./slotScope";
import { effectiveLabBatch, labBatchSettingId, type LabBatchModes } from "@/lib/students/labBatchMode";
import { listExpectedPeriods } from "@/lib/studentAttendance/expectedPeriods";

// Semester starts 2026-07-01; Mid I 2026-08-24..28, Mid II 2026-10-12..16.
const windows = buildMidWindows("2026-07-01", [
  { midNumber: 2, fromDate: "2026-10-12", toDate: "2026-10-16" },
  { midNumber: 1, fromDate: "2026-08-24", toDate: "2026-08-28" },
]);

describe("buildMidWindows", () => {
  it("runs each mid's stretch from the previous mid's end (or semester start) to the day before it begins", () => {
    expect(windows[1]).toEqual({ from: "2026-07-01", to: "2026-08-23" });
    expect(windows[2]).toEqual({ from: "2026-08-29", to: "2026-10-11" });
  });

  it("uses the earliest start and latest end when a mid has several rows", () => {
    const w = buildMidWindows("2026-07-01", [
      { midNumber: 1, fromDate: "2026-08-26", toDate: "2026-08-28" },
      { midNumber: 1, fromDate: "2026-08-24", toDate: "2026-08-25" },
    ]);
    expect(w[1]).toEqual({ from: "2026-07-01", to: "2026-08-23" });
  });

  it("leaves the first window open at the start when the semester start is unknown", () => {
    expect(buildMidWindows(null, [{ midNumber: 1, fromDate: "2026-08-24", toDate: "2026-08-28" }])[1]).toEqual({ from: null, to: "2026-08-23" });
  });
});

describe("slotActiveOn", () => {
  it("is always on for a slot with no midScope", () => {
    expect(slotActiveOn({}, "2026-12-31", windows)).toBe(true);
  });

  it("is on only inside its mid's stretch, boundaries included", () => {
    expect(slotActiveOn({ midScope: 1 }, "2026-07-01", windows)).toBe(true);
    expect(slotActiveOn({ midScope: 1 }, "2026-08-23", windows)).toBe(true);
    expect(slotActiveOn({ midScope: 1 }, "2026-08-24", windows)).toBe(false);
    expect(slotActiveOn({ midScope: 2 }, "2026-08-28", windows)).toBe(false);
    expect(slotActiveOn({ midScope: 2 }, "2026-08-29", windows)).toBe(true);
    expect(slotActiveOn({ midScope: 2 }, "2026-10-11", windows)).toBe(true);
  });

  it("is closed after the last mid begins", () => {
    expect(slotActiveOn({ midScope: 2 }, "2026-10-12", windows)).toBe(false);
    expect(slotActiveOn({ midScope: 2 }, "2026-11-20", windows)).toBe(false);
  });

  it("stays open for a mid with no published dates (parked until the Exam Cell publishes them)", () => {
    expect(slotActiveOn({ midScope: 3 }, "2026-11-20", windows)).toBe(true);
    expect(slotActiveOn({ midScope: 1 }, "2026-08-30", {})).toBe(true);
  });
});

describe("effectiveLabBatch with a pinned batch", () => {
  const modes: LabBatchModes = new Map([[labBatchSettingId("s1", "lab1"), { batchWise: true, batchByFaculty: { f1: "Batch 1" } }]]);

  it("keeps the faculty's default batch for an ordinary slot", () => {
    expect(effectiveLabBatch("Batch 2", modes, "s1", "lab1", "f1")).toBe("Batch 1");
  });

  it("uses the slot's own batch when it is pinned, so one faculty can swap batches by day", () => {
    expect(effectiveLabBatch("Batch 2", modes, "s1", "lab1", "f1", true)).toBe("Batch 2");
  });

  it("falls back to the normal rule when a pinned slot has no batch", () => {
    expect(effectiveLabBatch(undefined, modes, "s1", "lab1", "f1", true)).toBe("Batch 1");
  });
});

describe("listExpectedPeriods with mid-scoped slots", () => {
  const calendar = { workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"], holidays: [], summerBreaks: [] } as Parameters<typeof listExpectedPeriods>[0]["calendar"];
  const slot = (assignmentId: string, midScope?: number) => ({ assignmentId, subjectId: "sub", day: "MON" as const, periodNumber: 1, ...(midScope ? { midScope } : {}) });
  const run = (from: string, to: string) => listExpectedPeriods({
    slots: [slot("f1", 1), slot("f2", 2)], from, to, calendar, now: new Date("2026-12-01T10:00:00Z"), midWindows: windows,
  }).map((p) => `${p.date}:${p.assignmentId}`);

  it("counts a Monday only for the faculty whose mid it falls in", () => {
    expect(run("2026-08-17", "2026-08-17")).toEqual(["2026-08-17:f1"]); // inside Mid I's stretch
    expect(run("2026-09-07", "2026-09-07")).toEqual(["2026-09-07:f2"]); // inside Mid II's stretch
  });

  it("counts neither once the last mid has begun", () => {
    expect(run("2026-10-19", "2026-10-19")).toEqual([]);
  });
});
