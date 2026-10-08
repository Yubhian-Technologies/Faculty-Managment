import { describe, expect, it } from "vitest";
import type { TimetableSlot } from "@/types";
import { facultySpans } from "./facultySpans";

const slot = (p: number, merge: boolean, subjectId = "phy"): TimetableSlot =>
  ({ id: `${p}`, periodNumber: p, subjectId, mergeWithNext: merge || undefined, day: "TUE" }) as unknown as TimetableSlot;

describe("facultySpans", () => {
  const periods = [1, 2, 3, 4, 5, 6, 7];
  it("merges P5-P6 and cuts at the short break after P6", () => {
    const slots = [slot(5, true), slot(6, true), slot(7, false)];
    const { spans, skipped } = facultySpans(periods, (p) => slots.filter((s) => s.periodNumber === p), () => new Set([4, 6]));
    expect(spans.get(4)).toBe(2);
    expect([...skipped]).toEqual([5]);
  });
  it("does not merge unflagged neighbours", () => {
    const slots = [slot(1, false), slot(2, false)];
    expect(facultySpans(periods, (p) => slots.filter((s) => s.periodNumber === p), () => new Set()).spans.size).toBe(0);
  });
});
