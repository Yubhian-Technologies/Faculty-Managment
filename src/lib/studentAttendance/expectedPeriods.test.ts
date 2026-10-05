import { describe, expect, it } from "vitest";
import {
  buildNotPostedIndex, dayNameOf, eachDate, listExpectedPeriods, notPostedOf, postedKeysOf, type Calendar, type ExpectedSlot,
} from "./expectedPeriods";
import { withNotPosted } from "./heldDenominator";

const calendar: Calendar = { workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"], holidays: [], summerBreaks: [] };
// "now": Thursday 2026-10-08, 15:00 IST (09:30 UTC).
const NOW = new Date(Date.UTC(2026, 9, 8, 9, 30, 0));
const slot = (over: Partial<ExpectedSlot> = {}): ExpectedSlot => ({
  assignmentId: "a1", subjectId: "maths", day: "MON", periodNumber: 1, endTime: "09:50", activeFromISO: null, ...over,
});

describe("dates", () => {
  it("eachDate is inclusive and crosses month ends", () => {
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(eachDate("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
  });
  it("dayNameOf is Monday-based with no Sunday", () => {
    expect(dayNameOf("2026-10-05")).toBe("MON");
    expect(dayNameOf("2026-10-10")).toBe("SAT");
    expect(dayNameOf("2026-10-11")).toBeNull();
  });
});

describe("listExpectedPeriods", () => {
  it("lists one period per matching weekday in range, as of now", () => {
    // Mondays between Oct 1 and Oct 8: Oct 5 only (Oct 12 is the future).
    const out = listExpectedPeriods({ slots: [slot()], from: "2026-10-01", to: "2026-10-31", calendar, now: NOW });
    expect(out.map((p) => p.date)).toEqual(["2026-10-05"]);
    expect(out[0]).toMatchObject({ key: "a1_2026-10-05_1", subjectId: "maths", periodNumber: 1 });
  });

  it("never lists the future", () => {
    expect(listExpectedPeriods({ slots: [slot({ day: "FRI" })], from: "2026-10-01", to: "2026-12-31", calendar, now: NOW }).map((p) => p.date))
      .toEqual(["2026-10-02"]); // Oct 9 (Fri) is tomorrow
  });

  it("skips holidays, summer breaks and non-working days", () => {
    const cal: Calendar = {
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
      holidays: [{ dateKey: "2026-10-05", name: "Festival" }],
      summerBreaks: [],
    };
    expect(listExpectedPeriods({ slots: [slot()], from: "2026-10-01", to: "2026-10-08", calendar: cal, now: NOW })).toEqual([]);
    const sat = listExpectedPeriods({ slots: [slot({ day: "SAT" })], from: "2026-10-01", to: "2026-10-08", calendar: cal, now: NOW });
    expect(sat).toEqual([]); // SAT not a working day in this calendar
    const summer: Calendar = { ...calendar, summerBreaks: [{ fromKey: "2026-10-01", toKey: "2026-10-31" }] };
    expect(listExpectedPeriods({ slots: [slot()], from: "2026-10-01", to: "2026-10-08", calendar: summer, now: NOW })).toEqual([]);
  });

  it("counts today's period only once it has ended", () => {
    const thu = (endTime: string) => listExpectedPeriods({ slots: [slot({ day: "THU", endTime })], from: "2026-10-08", to: "2026-10-08", calendar, now: NOW });
    expect(thu("14:00")).toHaveLength(1); // ended at 14:00, now is 15:00
    expect(thu("16:00")).toHaveLength(0); // still to come
    expect(listExpectedPeriods({ slots: [slot({ day: "THU", endTime: null })], from: "2026-10-08", to: "2026-10-08", calendar, now: NOW })).toHaveLength(0);
  });

  it("a slot counts only from the day it was published (no retroactive missed classes)", () => {
    const out = listExpectedPeriods({ slots: [slot({ activeFromISO: "2026-10-06" })], from: "2026-10-01", to: "2026-10-08", calendar, now: NOW });
    expect(out).toEqual([]); // the only Monday, Oct 5, predates publication
  });

  it("a multi-period day lists each period separately", () => {
    const slots = [slot({ periodNumber: 1 }), slot({ periodNumber: 2, endTime: "10:40" }), slot({ assignmentId: "a2", subjectId: "physics", periodNumber: 3, endTime: "11:30" })];
    expect(listExpectedPeriods({ slots, from: "2026-10-05", to: "2026-10-05", calendar, now: NOW })).toHaveLength(3);
  });
});

describe("notPostedOf / postedKeysOf", () => {
  const expected = listExpectedPeriods({ slots: [slot({ day: "MON" }), slot({ assignmentId: "a2", subjectId: "physics", day: "MON", periodNumber: 2, endTime: "10:40" })], from: "2026-10-05", to: "2026-10-05", calendar, now: NOW });

  it("a period with a submitted session is posted; the rest are not posted", () => {
    const posted = postedKeysOf([{ assignmentId: "a1", date: "2026-10-05", periodNumber: 1 }]);
    expect(notPostedOf(expected, posted).map((p) => p.assignmentId)).toEqual(["a2"]);
  });

  it("a legacy session with no period number covers every period of that assignment on that date", () => {
    const posted = postedKeysOf([{ assignmentId: "a2", date: "2026-10-05", periodNumber: null }]);
    expect(notPostedOf(expected, posted).map((p) => p.assignmentId)).toEqual(["a1"]);
  });

  it("an excused period is not counted", () => {
    expect(notPostedOf(expected, new Set(), new Set(["a1_2026-10-05_1"])).map((p) => p.assignmentId)).toEqual(["a2"]);
  });

  it("everything posted -> nothing not posted", () => {
    const posted = postedKeysOf(expected.map((p) => ({ assignmentId: p.assignmentId, date: p.date, periodNumber: p.periodNumber })));
    expect(notPostedOf(expected, posted)).toEqual([]);
  });
});

describe("buildNotPostedIndex - split labs only count against their own batch", () => {
  const periods = [
    { key: "k1", date: "2026-10-05", periodNumber: 1, assignmentId: "a1", subjectId: "maths" },
    { key: "k2", date: "2026-10-05", periodNumber: 2, assignmentId: "a2", subjectId: "chem-lab", labBatch: "Batch 1" },
    { key: "k3", date: "2026-10-05", periodNumber: 2, assignmentId: "a3", subjectId: "phy-lab", labBatch: "Batch 2" },
  ];
  const index = buildNotPostedIndex(periods);

  it("a student in Batch 1 owes the shared period and Batch 1's lab only", () => {
    expect(Object.fromEntries(index.forStudent({ labBatch: " batch 1 " }))).toEqual({ maths: 1, "chem-lab": 1 });
  });
  it("a student in Batch 2 owes the shared period and Batch 2's lab only", () => {
    expect(Object.fromEntries(index.forStudent({ labBatch: "Batch 2" }))).toEqual({ maths: 1, "phy-lab": 1 });
  });
  it("a student with no batch owes only the shared periods (excluded from every split lab, as in the roster rule)", () => {
    expect(Object.fromEntries(index.forStudent({}))).toEqual({ maths: 1 });
  });
  it("counts the total", () => expect(index.total).toBe(3));
});

describe("withNotPosted", () => {
  it("adds not-posted periods to held without touching attended", () => {
    expect(withNotPosted({ held: 8, attended: 6 }, 2)).toEqual({ held: 10, attended: 6, percentage: 60 });
  });
  it("is the original numbers when nothing is not-posted", () => {
    expect(withNotPosted({ held: 8, attended: 6 }, 0)).toEqual({ held: 8, attended: 6, percentage: 75 });
  });
  it("a student with no tally at all still gets a held count (and a real 0%) once classes were missed", () => {
    expect(withNotPosted(undefined, 3)).toEqual({ held: 3, attended: 0, percentage: 0 });
    expect(withNotPosted(undefined, 0)).toEqual({ held: 0, attended: 0, percentage: null });
  });
});
