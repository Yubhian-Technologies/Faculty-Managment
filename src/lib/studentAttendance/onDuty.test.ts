import { describe, expect, it } from "vitest";
import { applyOnDutyToEntries, coversPeriod, mergeMarkUpdates, presentCountOf, releaseEntry } from "./onDuty";
import type { StudentAttendanceEntry } from "@/types";

const e = (studentId: string, status: StudentAttendanceEntry["status"], extra: Partial<StudentAttendanceEntry> = {}): StudentAttendanceEntry =>
  ({ studentId, rollNumber: studentId.toUpperCase(), name: studentId, status, ...extra });

describe("coversPeriod", () => {
  it("is true for an ALL source or a listed period, false otherwise", () => {
    expect(coversPeriod({ s1: "ALL" }, 4)).toBe(true);
    expect(coversPeriod({ s1: [2, 3] }, 3)).toBe(true);
    expect(coversPeriod({ s1: [2, 3] }, 4)).toBe(false);
    expect(coversPeriod({}, 1)).toBe(false);
    expect(coversPeriod(undefined, 1)).toBe(false);
  });
  it("unions several sources, so one ending doesn't uncover what another covers", () => {
    expect(coversPeriod({ a: [1], b: [5] }, 5)).toBe(true);
  });
  it("a session with no period number is covered only by an ALL source", () => {
    expect(coversPeriod({ a: [1] }, undefined)).toBe(false);
    expect(coversPeriod({ a: "ALL" }, undefined)).toBe(true);
  });
});

describe("applyOnDutyToEntries", () => {
  const day = { byStudent: { a: { s1: "ALL" as const }, b: { s1: [2] }, c: {} } };
  it("marks covered students ON_DUTY and remembers what they held", () => {
    const out = applyOnDutyToEntries([e("a", null), e("b", "ABSENT"), e("c", "PRESENT"), e("d", "PRESENT")], day, 2);
    expect(out.map((x) => [x.studentId, x.status, x.previousStatus])).toEqual([
      ["a", "ON_DUTY", null], ["b", "ON_DUTY", "ABSENT"], ["c", "PRESENT", undefined], ["d", "PRESENT", undefined],
    ]);
  });
  it("leaves a student alone in a period their coverage doesn't include", () => {
    expect(applyOnDutyToEntries([e("b", "PRESENT")], day, 3)[0].status).toBe("PRESENT");
  });
  it("is idempotent and does not overwrite the remembered mark", () => {
    const once = applyOnDutyToEntries([e("b", "ABSENT")], day, 2);
    const twice = applyOnDutyToEntries(once, day, 2);
    expect(twice[0]).toEqual(once[0]);
    expect(twice[0].previousStatus).toBe("ABSENT");
  });
  it("returns the same array when nobody is on duty", () => {
    const list = [e("a", null)];
    expect(applyOnDutyToEntries(list, null, 1)).toBe(list);
  });
});

describe("releaseEntry", () => {
  it("restores the previous mark", () => {
    expect(releaseEntry(e("a", "ON_DUTY", { previousStatus: "PRESENT" }), true)).toMatchObject({ status: "PRESENT" });
    expect(releaseEntry(e("a", "ON_DUTY", { previousStatus: "ABSENT" }), false)).toMatchObject({ status: "ABSENT" });
  });
  it("an entry that was never marked goes back to unmarked in a draft, but to ABSENT once submitted", () => {
    expect(releaseEntry(e("a", "ON_DUTY", { previousStatus: null }), false).status).toBeNull();
    expect(releaseEntry(e("a", "ON_DUTY", { previousStatus: null }), true).status).toBe("ABSENT");
    expect(releaseEntry(e("a", "ON_DUTY"), true).status).toBe("ABSENT");
  });
  it("drops the bookkeeping field and ignores entries that aren't on duty", () => {
    expect("previousStatus" in releaseEntry(e("a", "ON_DUTY", { previousStatus: "PRESENT" }), true)).toBe(false);
    const plain = e("a", "PRESENT");
    expect(releaseEntry(plain, true)).toBe(plain);
  });
});

describe("presentCountOf", () => {
  it("counts only PRESENT (on-duty is not present)", () => {
    expect(presentCountOf([e("a", "PRESENT"), e("b", "ON_DUTY"), e("c", "ABSENT"), e("d", null)])).toBe(1);
  });
});

describe("mergeMarkUpdates (ON_DUTY is locked)", () => {
  const entries = [e("a", "ON_DUTY", { previousStatus: "ABSENT" }), e("b", null), e("c", "PRESENT"), e("d", "ABSENT")];
  it("changes the students it is told to, except anyone on duty", () => {
    const out = mergeMarkUpdates(entries, new Map([["a", "PRESENT" as const], ["b", "PRESENT" as const], ["c", null]]));
    expect(out.map((x) => x.status)).toEqual(["ON_DUTY", "PRESENT", null, "ABSENT"]);
    expect(out[0]).toBe(entries[0]); // the locked entry is returned untouched, bookkeeping intact
  });
  it("cannot clear or flip an on-duty mark either way", () => {
    for (const status of ["PRESENT", "ABSENT", null] as const) {
      expect(mergeMarkUpdates(entries, new Map([["a", status]]))[0].status).toBe("ON_DUTY");
    }
  });
  it("leaves unmentioned students alone", () => {
    expect(mergeMarkUpdates(entries, new Map()).map((x) => x.status)).toEqual(["ON_DUTY", null, "PRESENT", "ABSENT"]);
  });
});
