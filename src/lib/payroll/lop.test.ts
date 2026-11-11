import { describe, expect, it } from "vitest";
import { employedInMonth, payDaysFor } from "./lop";
import { effectivePayDays, financialYear, moveRun } from "./run";

const base = { month: "2026-10", basis: "CALENDAR" as const, leaveLop: 0, absences: [], coveredDates: new Set<string>(), holidayDates: new Set<string>() };

describe("pay days", () => {
  it("full month, joiner, leaver", () => {
    expect(payDaysFor(base).payDays).toBe(31);
    expect(payDaysFor({ ...base, joiningDate: "2026-10-14" })).toMatchObject({ notEmployedDays: 13, payDays: 18 });
    expect(payDaysFor({ ...base, lastWorkingDate: "2026-10-20" })).toMatchObject({ notEmployedDays: 11, payDays: 20 });
    expect(payDaysFor({ ...base, month: "2026-02", basis: "FIXED_30", joiningDate: "2026-02-15" })).toMatchObject({ monthDays: 30, payDays: 16 });
  });
  it("absences count only on working days not covered by leave, and only while employed", () => {
    const r = payDaysFor({
      ...base, joiningDate: "2026-10-03",
      absences: [
        { date: "2026-10-02", half: false },   // before joining
        { date: "2026-10-04", half: false },   // Sunday
        { date: "2026-10-05", half: false },   // holiday
        { date: "2026-10-06", half: false },   // on approved leave
        { date: "2026-10-07", half: true },
        { date: "2026-10-08", half: false },
      ],
      holidayDates: new Set(["2026-10-05"]), coveredDates: new Set(["2026-10-06"]),
    });
    expect(r).toMatchObject({ attendanceLop: 1.5, absentDates: ["2026-10-07", "2026-10-08"], lop: 1.5, payDays: 29 - 1.5 });
  });
  it("leave LOP is rounded to the half day and never more than the days employed", () => {
    expect(payDaysFor({ ...base, leaveLop: 1.3333 }).lop).toBe(1.5);
    expect(payDaysFor({ ...base, leaveLop: 1.2 }).lop).toBe(1);
    expect(payDaysFor({ ...base, joiningDate: "2026-10-30", leaveLop: 5 })).toMatchObject({ lop: 2, payDays: 0 });
  });
  it("who belongs in a month", () => {
    expect(employedInMonth("2026-10", "2026-10-31")).toBe(true);
    expect(employedInMonth("2026-10", "2026-11-01")).toBe(false);
    expect(employedInMonth("2026-10", undefined, "2026-10-01")).toBe(true);
    expect(employedInMonth("2026-10", undefined, "2026-09-30")).toBe(false);
  });
});

describe("run rules", () => {
  const auto = { monthDays: 31, notEmployedDays: 13, leaveLop: 0, attendanceLop: 0, absentDates: [], lop: 2, payDays: 16 };
  it("override replaces automatic LOP; not credited is 0", () => {
    expect(effectivePayDays({ auto })).toBe(16);
    expect(effectivePayDays({ auto, lopOverride: { days: 0, reason: "r", byName: "", at: "" } })).toBe(18);
    expect(effectivePayDays({ auto, notCredited: { reason: "r", byName: "", at: "" } })).toBe(0);
  });
  it("status moves and who makes them", () => {
    const ok = { shortfalls: 0 };
    expect(moveRun("DRAFT", "SUBMIT", "OFFICE", ok)).toBe("SUBMITTED");
    expect(() => moveRun("DRAFT", "SUBMIT", "ACCOUNTS", ok)).toThrow(/College Office/);
    expect(() => moveRun("SUBMITTED", "APPROVE", "OFFICE", ok)).toThrow(/Accounts/);
    expect(moveRun("SUBMITTED", "APPROVE", "OFFICE", ok, true)).toBe("APPROVED");
    expect(() => moveRun("DRAFT", "SUBMIT", "OFFICE", { shortfalls: 2 })).toThrow(/above the salary/);
    expect(() => moveRun("RELEASED", "RETURN", "ACCOUNTS", ok)).toThrow(/released/);
    expect(moveRun("APPROVED", "REOPEN", "ACCOUNTS", ok)).toBe("SUBMITTED");
  });
  it("financial year", () => expect([financialYear("2026-04"), financialYear("2027-03"), financialYear("2026-03")]).toEqual(["2026-27", "2026-27", "2025-26"]));
});
