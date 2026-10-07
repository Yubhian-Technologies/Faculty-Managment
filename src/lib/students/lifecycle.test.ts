import { describe, expect, it } from "vitest";
import { batchStartYear, isJuniorBatch, planDetain, planPlacement } from "./lifecycle";

const now = new Date("2026-10-07");
const regular = { status: "REGULAR" as const, year: 3, department: "CSE", section: "A", courseId: "c1" };
const detained = { ...regular, status: "DETAINED" as const };
const target = { name: "B", year: 3, department: "CSE", courseId: "c1", courseName: "BTech" };

describe("planDetain", () => {
  it("only flags the student - nothing is moved", () => {
    const p = planDetain(regular, { now, reason: "attendance" });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.update).toMatchObject({ status: "DETAINED", detainedFromYear: 3, detainedFromSection: "A", detainedReason: "attendance" });
      expect(p.update).not.toHaveProperty("section");
      expect(p.update).not.toHaveProperty("year");
    }
  });
  it("refuses graduated, discontinued and already-detained students", () => {
    expect(planDetain({ ...regular, status: "GRADUATED" }, { now }).ok).toBe(false);
    expect(planDetain({ ...regular, status: "DISCONTINUED" }, { now }).ok).toBe(false);
    expect(planDetain(detained, { now }).ok).toBe(false);
  });
});

describe("planPlacement", () => {
  it("puts a detained student into a same-year section and makes them regular again", () => {
    const p = planPlacement(detained, target, { now });
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.update).toMatchObject({ status: "REGULAR", year: 3, section: "B", labBatch: "" });
  });
  it("is only for detained students", () => {
    expect(planPlacement(regular, target, { now }).ok).toBe(false);
  });
  it("refuses a different year", () => {
    expect(planPlacement(detained, { ...target, year: 2 }, { now }).ok).toBe(false);
    expect(planPlacement(detained, { ...target, year: 4 }, { now }).ok).toBe(false);
  });
  it("refuses the section the student is already in", () => {
    expect(planPlacement(detained, { ...target, name: "A" }, { now }).ok).toBe(false);
  });
  it("only accepts a junior batch when both batches are known, and adopts its batch", () => {
    const s = { ...detained, batch: "2023-2027" };
    const ok = planPlacement(s, { ...target, batch: "2024-2028" }, { now });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.update.batch).toBe("2024-2028");
    expect(planPlacement(s, { ...target, batch: "2023-27" }, { now }).ok).toBe(false);
    expect(planPlacement(s, { ...target, batch: "2022-26" }, { now }).ok).toBe(false);
    expect(planPlacement(s, target, { now }).ok).toBe(true); // batch not recorded on the section
  });
  it("refuses a different programme", () => {
    expect(planPlacement(detained, target, { now, studentCatalogId: "btech", targetCatalogId: "mba" }).ok).toBe(false);
  });
});

describe("batches", () => {
  it("reads the start year of a batch", () => {
    expect(batchStartYear("2024-28")).toBe(2024);
    expect(batchStartYear("")).toBeNull();
    expect(isJuniorBatch(undefined, "2024-28")).toBe(true);
  });
});
