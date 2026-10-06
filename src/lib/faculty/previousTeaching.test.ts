import { describe, expect, it } from "vitest";
import {
  formatPassPercentage, mergePreviousTeachingAssignments, normalizePreviousTeachingAssignments, parseLoadedIds,
  previousTeachingProblem, readPreviousTeachingAssignments, resolvePreviousTeachingUpdate,
} from "./previousTeaching";
import type { PreviousTeachingAssignment } from "@/types";

let n = 0;
const makeId = () => `gen${++n}`;
const row = (over: Partial<PreviousTeachingAssignment> = {}): PreviousTeachingAssignment => ({
  id: "a", source: "INTERNAL", collegeName: "", academicYear: "2024-2025", course: "B.Tech", year: "2nd", semester: "I", subject: "DBMS", passPercentage: "85", ...over,
});

describe("normalizePreviousTeachingAssignments", () => {
  it("keeps every field as free text, trimmed", () => {
    const r = normalizePreviousTeachingAssignments([{ id: "x", source: "INTERNAL", academicYear: " 2024-2025 ", course: "B.Tech", year: "1st", semester: "I", subject: "  Data   Structures ", passPercentage: " 91.5% " }], makeId);
    expect(r).toEqual({ ok: true, value: [{ id: "x", source: "INTERNAL", collegeName: "", academicYear: "2024-2025", course: "B.Tech", year: "1st", semester: "I", subject: "Data Structures", passPercentage: "91.5%" }] });
  });

  it("accepts a number for a field typed as text (e.g. 85)", () => {
    const r = normalizePreviousTeachingAssignments([{ source: "INTERNAL", subject: "Maths", passPercentage: 85 }], makeId);
    expect(r.ok && r.value[0].passPercentage).toBe("85");
  });

  it("External keeps College Name; Internal never stores one", () => {
    const ext = normalizePreviousTeachingAssignments([{ source: "EXTERNAL", collegeName: " ABC College ", subject: "OS" }], makeId);
    expect(ext.ok && ext.value[0]).toMatchObject({ source: "EXTERNAL", collegeName: "ABC College" });
    const int = normalizePreviousTeachingAssignments([{ source: "INTERNAL", collegeName: "ABC College", subject: "OS" }], makeId);
    expect(int.ok && int.value[0].collegeName).toBe("");
  });

  it("External without a College Name is refused", () => {
    const r = normalizePreviousTeachingAssignments([{ source: "EXTERNAL", subject: "OS" }], makeId);
    expect(r.ok).toBe(false);
  });

  it("drops blank rows, gives a missing/duplicate id a new one, ignores junk entries", () => {
    const r = normalizePreviousTeachingAssignments([{ source: "INTERNAL" }, null, "x", { source: "INTERNAL", subject: "A" }, { id: "same", subject: "B" }, { id: "same", subject: "C" }], makeId);
    expect(r.ok && r.value.map((v) => v.subject)).toEqual(["A", "B", "C"]);
    expect(r.ok && new Set(r.value.map((v) => v.id)).size).toBe(3);
  });

  it("an unknown source falls back to Internal", () => {
    const r = normalizePreviousTeachingAssignments([{ source: "weird", subject: "A" }], makeId);
    expect(r.ok && r.value[0].source).toBe("INTERNAL");
  });

  it("rejects non-lists, over-long fields and too many rows", () => {
    expect(normalizePreviousTeachingAssignments("nope", makeId).ok).toBe(false);
    expect(normalizePreviousTeachingAssignments([{ subject: "x".repeat(201) }], makeId).ok).toBe(false);
    expect(normalizePreviousTeachingAssignments(Array.from({ length: 301 }, () => ({ subject: "A" })), makeId).ok).toBe(false);
  });

  it("an empty list is valid (clears them all)", () => {
    expect(normalizePreviousTeachingAssignments([], makeId)).toEqual({ ok: true, value: [] });
  });
});

describe("mergePreviousTeachingAssignments - nothing added by someone else is lost", () => {
  const stored = [row({ id: "1", subject: "S1" }), row({ id: "2", subject: "S2" })];

  it("without loadedIds the incoming list replaces the stored one", () => {
    expect(mergePreviousTeachingAssignments(stored, [row({ id: "9" })], undefined).map((r) => r.id)).toEqual(["9"]);
  });

  it("a row the editor never saw (added meanwhile) is kept", () => {
    const merged = mergePreviousTeachingAssignments(stored, [row({ id: "1", subject: "S1 edited" })], ["1"]);
    expect(merged.map((r) => r.id)).toEqual(["1", "2"]);
    expect(merged[0].subject).toBe("S1 edited");
  });

  it("a row the editor loaded and then removed is dropped", () => {
    const merged = mergePreviousTeachingAssignments(stored, [row({ id: "1" })], ["1", "2"]);
    expect(merged.map((r) => r.id)).toEqual(["1"]);
  });

  it("a brand-new row is added; nothing is duplicated", () => {
    const merged = mergePreviousTeachingAssignments(stored, [row({ id: "1" }), row({ id: "2" }), row({ id: "3" })], ["1", "2"]);
    expect(merged.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("an editor that loaded nothing clearing its list cannot erase rows it never saw", () => {
    expect(mergePreviousTeachingAssignments(stored, [], []).map((r) => r.id)).toEqual(["1", "2"]);
  });
});

describe("resolvePreviousTeachingUpdate", () => {
  it("is a no-op when the key is absent", () => {
    expect(resolvePreviousTeachingUpdate({}, { previousTeachingAssignments: [row()] }, makeId)).toEqual({ kind: "none" });
  });
  it("returns an error for a bad list and the merged list otherwise", () => {
    expect(resolvePreviousTeachingUpdate({ previousTeachingAssignments: [{ source: "EXTERNAL", subject: "x" }] }, undefined, makeId).kind).toBe("error");
    const ok = resolvePreviousTeachingUpdate(
      { previousTeachingAssignments: [{ id: "n", subject: "New" }], previousTeachingAssignmentsLoadedIds: ["1"] },
      { previousTeachingAssignments: [row({ id: "1" }), row({ id: "2" })] }, makeId,
    );
    expect(ok.kind === "set" && ok.value.map((r) => r.id)).toEqual(["n", "2"]);
  });
});

describe("helpers", () => {
  it("parseLoadedIds only accepts a list of strings", () => {
    expect(parseLoadedIds(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(parseLoadedIds("a")).toBeUndefined();
  });
  it("formatPassPercentage adds % to plain numbers only", () => {
    expect(formatPassPercentage("85")).toBe("85%");
    expect(formatPassPercentage("85.5")).toBe("85.5%");
    expect(formatPassPercentage("85%")).toBe("85%");
    expect(formatPassPercentage("Pass")).toBe("Pass");
    expect(formatPassPercentage("")).toBe("");
  });
  it("readPreviousTeachingAssignments tolerates missing / malformed stored data", () => {
    expect(readPreviousTeachingAssignments(undefined)).toEqual([]);
    expect(readPreviousTeachingAssignments({ previousTeachingAssignments: "x" })).toEqual([]);
    const r = readPreviousTeachingAssignments({ previousTeachingAssignments: [null, { subject: "A", source: "EXTERNAL", collegeName: "C" }] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ subject: "A", source: "EXTERNAL", collegeName: "C" });
  });
  it("previousTeachingProblem flags an External row with no college only", () => {
    expect(previousTeachingProblem([row({ source: "EXTERNAL", collegeName: " " })])).toMatch(/College Name/);
    expect(previousTeachingProblem([row({ source: "EXTERNAL", collegeName: "X" }), row()])).toBeNull();
    expect(previousTeachingProblem([row({ source: "EXTERNAL", collegeName: "", subject: "", academicYear: "", course: "", year: "", semester: "", passPercentage: "" })])).toBeNull();
  });
});
