import { describe, expect, it } from "vitest";
import { studentEditWindowOpen } from "./editWindow";

const timing = {
  semesters: [
    { semester: 1, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 11, 20) },
    { semester: 2, startDate: new Date(2027, 0, 5), endDate: new Date(2027, 4, 30) },
  ],
} as never;

describe("studentEditWindowOpen", () => {
  it("keeps the old rule: this month, up to the 25th", () => {
    expect(studentEditWindowOpen(new Date(2026, 9, 3), null, new Date(2026, 9, 20))).toBe(true);
    expect(studentEditWindowOpen(new Date(2026, 9, 3), null, new Date(2026, 9, 26))).toBe(false);
  });
  it("opens the whole semester: an August date is editable in October, and after the 25th", () => {
    expect(studentEditWindowOpen(new Date(2026, 7, 12), timing, new Date(2026, 9, 27))).toBe(true);
  });
  it("closes once the record's semester is over", () => {
    expect(studentEditWindowOpen(new Date(2026, 7, 12), timing, new Date(2027, 1, 10))).toBe(false);
  });
  it("is closed with no semesters configured (month rule only) or for a date between semesters", () => {
    expect(studentEditWindowOpen(new Date(2026, 7, 12), null, new Date(2026, 9, 27))).toBe(false);
    expect(studentEditWindowOpen(new Date(2026, 11, 28), timing, new Date(2026, 11, 22))).toBe(true); // month rule: before the 25th
    expect(studentEditWindowOpen(new Date(2026, 11, 28), timing, new Date(2026, 11, 29))).toBe(false); // gap date, after the 25th
    expect(studentEditWindowOpen(new Date(2026, 11, 28), timing, new Date(2027, 1, 10))).toBe(false); // gap date
  });
});
