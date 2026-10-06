import { describe, expect, it } from "vitest";
import { facultyActiveOn, facultyActiveOnAny, labWindowId, normalizeWindows, type LabWindows } from "@/lib/students/labFacultyWindow";

const windows: LabWindows = new Map([
  [labWindowId("s1", "lab"), { facA: { from: "2026-10-01", to: "2026-10-15" }, facB: { from: "2026-10-16", to: "2026-11-30" } }],
]);

describe("normalizeWindows", () => {
  it("accepts alternating windows and drops empty ones", () => {
    const r = normalizeWindows({ a: { from: "2026-10-01", to: "2026-10-15" }, b: { from: "2026-10-16", to: "2026-11-30" }, c: { from: "", to: "" }, d: null });
    expect(r).toEqual({ ok: true, windows: { a: { from: "2026-10-01", to: "2026-10-15" }, b: { from: "2026-10-16", to: "2026-11-30" } } });
  });
  it("rejects overlapping faculty (even touching on one day)", () => {
    expect(normalizeWindows({ a: { from: "2026-10-01", to: "2026-10-15" }, b: { from: "2026-10-15", to: "2026-11-30" } }).ok).toBe(false);
  });
  it("rejects half-filled, reversed and impossible dates", () => {
    expect(normalizeWindows({ a: { from: "2026-10-01", to: "" } }).ok).toBe(false);
    expect(normalizeWindows({ a: { from: "2026-10-09", to: "2026-10-01" } }).ok).toBe(false);
    expect(normalizeWindows({ a: { from: "2026-02-30", to: "2026-03-05" } }).ok).toBe(false);
  });
});

describe("facultyActiveOn", () => {
  it("is inclusive at both ends and false outside", () => {
    expect(facultyActiveOn(windows, "s1", "lab", "facA", "2026-10-01")).toBe(true);
    expect(facultyActiveOn(windows, "s1", "lab", "facA", "2026-10-15")).toBe(true);
    expect(facultyActiveOn(windows, "s1", "lab", "facA", "2026-10-16")).toBe(false);
    expect(facultyActiveOn(windows, "s1", "lab", "facB", "2026-10-10")).toBe(false);
    expect(facultyActiveOn(windows, "s1", "lab", "facB", "2026-10-20")).toBe(true);
  });
  it("is always true for a faculty or lab with no dates", () => {
    expect(facultyActiveOn(windows, "s1", "lab", "facC", "2030-01-01")).toBe(true);
    expect(facultyActiveOn(windows, "s1", "other", "facA", "2030-01-01")).toBe(true);
    expect(facultyActiveOn(windows, "s2", "lab", "facA", "2030-01-01")).toBe(true);
    expect(facultyActiveOn(new Map(), "s1", "lab", "facA", "2030-01-01")).toBe(true);
  });
});

describe("facultyActiveOnAny", () => {
  it("is true when any listed date is inside, e.g. a week straddling the changeover", () => {
    const week = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    expect(facultyActiveOnAny(windows, "s1", "lab", "facA", week)).toBe(true);
    expect(facultyActiveOnAny(windows, "s1", "lab", "facB", week)).toBe(true);
    expect(facultyActiveOnAny(windows, "s1", "lab", "facA", ["2026-10-20", "2026-10-21"])).toBe(false);
  });
});
