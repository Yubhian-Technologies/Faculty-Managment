import { describe, expect, it } from "vitest";
import { halfEndsNote, leavePartOn, partCovers } from "./leaveDayParts";
import { countWorkingDays } from "./dayCounter";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("1.5 / 2.5 day leave: half days at the ends", () => {
  it("counts a range with a half-day end as half that day", () => {
    const none = new Set<string>();
    // Thu 26/11 - Fri 27/11/2026
    expect(countWorkingDays(new Date(2026, 10, 26), new Date(2026, 10, 27), none)).toBe(2);
    expect(countWorkingDays(new Date(2026, 10, 26), new Date(2026, 10, 27), none, false, undefined, { lastDayHalf: "FN" })).toBe(1.5);
    expect(countWorkingDays(new Date(2026, 10, 26), new Date(2026, 10, 27), none, false, undefined, { firstDayHalf: "AN" })).toBe(1.5);
    expect(countWorkingDays(new Date(2026, 10, 25), new Date(2026, 10, 27), none, false, undefined, { firstDayHalf: "AN", lastDayHalf: "FN" })).toBe(2);
    // A Sunday end counts nothing either way (Sat 28 - Sun 29/11/2026).
    expect(countWorkingDays(new Date(2026, 10, 28), new Date(2026, 10, 29), none, false, undefined, { lastDayHalf: "FN" })).toBe(1);
    // One date: the ends are ignored (that is Half Day's job).
    expect(countWorkingDays(new Date(2026, 10, 26), new Date(2026, 10, 26), none, false, undefined, { lastDayHalf: "FN" })).toBe(1);
  });

  it("says which part of each day the leave takes", () => {
    const req = { fromDate: d("2026-11-26"), toDate: d("2026-11-27"), lastDayHalf: "FN" as const };
    expect(leavePartOn(req, "2026-11-25")).toBeNull();
    expect(leavePartOn(req, "2026-11-26")).toBe("FULL");
    expect(leavePartOn(req, "2026-11-27")).toBe("FN");
    expect(leavePartOn({ ...req, lastDayHalf: undefined, firstDayHalf: "AN" }, "2026-11-26")).toBe("AN");
    expect(leavePartOn({ fromDate: d("2026-11-26"), toDate: d("2026-11-26"), isHalfDay: true, halfDaySession: "AN" }, "2026-11-26")).toBe("AN");
    expect(leavePartOn({ fromDate: "2026-11-26", toDate: "2026-11-27", lastDayHalf: "FN" }, "2026-11-27")).toBe("FN");
  });

  it("splits the day at 1 PM: a period counts by its start", () => {
    expect(partCovers("FN", "12:30")).toBe(true);
    expect(partCovers("FN", "13:00")).toBe(false);
    expect(partCovers("AN", "13:00")).toBe(true);
    expect(partCovers("AN", "09:40")).toBe(false);
    expect(partCovers("FULL", "15:00")).toBe(true);
    expect(partCovers(null, "10:00")).toBe(false);
  });

  it("describes the half-day ends for approvers", () => {
    const fmt = (iso: string) => iso.split("-").reverse().join("/");
    expect(halfEndsNote({ fromDate: "2026-11-26", toDate: "2026-11-27", lastDayHalf: "FN" }, fmt)).toBe("27/11/2026 forenoon only");
    expect(halfEndsNote({ fromDate: "2026-11-26", toDate: "2026-11-28", firstDayHalf: "AN", lastDayHalf: "FN" }, fmt))
      .toBe("26/11/2026 afternoon only, 28/11/2026 forenoon only");
    expect(halfEndsNote({ fromDate: "2026-11-26", toDate: "2026-11-27" }, fmt)).toBe("");
  });
});
