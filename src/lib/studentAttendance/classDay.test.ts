import { describe, expect, it } from "vitest";
import { noClassReason } from "./classDay";

const base = { workingDays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"] as const, holidays: [], summerBreaks: [] };
const input = (dateISO: string, extra: object = {}) => ({ ...base, workingDays: [...base.workingDays], dateISO, ...extra });

describe("noClassReason", () => {
  it("allows a normal weekday", () => expect(noClassReason(input("2026-09-30"))).toBeNull()); // Wednesday
  it("blocks Sunday", () => expect(noClassReason(input("2026-09-27"))).toBe("Sunday"));
  it("blocks a day the college doesn't teach (Mon-Fri college on Saturday)", () =>
    expect(noClassReason(input("2026-09-26", { workingDays: ["MON", "TUE", "WED", "THU", "FRI"] }))).toBe("Not a working day"));
  it("blocks a declared holiday", () =>
    expect(noClassReason(input("2026-10-02", { holidays: [{ dateKey: "2026-10-02", name: "Gandhi Jayanti" }] }))).toBe("Holiday: Gandhi Jayanti"));
  it("blocks the summer break, inclusive at both ends", () => {
    const b = { summerBreaks: [{ fromKey: "2026-05-01", toKey: "2026-06-10" }] };
    expect(noClassReason(input("2026-05-01", b))).toBe("Summer break");
    expect(noClassReason(input("2026-06-10", b))).toBe("Summer break");
    expect(noClassReason(input("2026-06-11", b))).toBeNull();
  });
});
