import { describe, expect, it } from "vitest";
import { joiningDatesFromRegister } from "./joiningFromRegister";

const grid = (dates: string[], rows: Record<string, ("PRESENT" | "ABSENT" | null)[]>) => ({
  dates, students: Object.entries(rows).map(([roll, marks]) => ({ roll, marks })),
});
const P = "PRESENT" as const, A = "ABSENT" as const;

describe("Date of Joining from an attendance register", () => {
  it("a row blank on the first class days and marked later gives its first marked date", () => {
    const g = grid(["2026-08-01", "2026-08-02", "2026-08-17", "2026-08-18"], {
      ONTIME: [P, A, P, P],
      LATE: [null, null, P, A],
    });
    expect(joiningDatesFromRegister(g)).toEqual([{ roll: "LATE", date: "2026-08-17", blankClassDays: 2 }]);
  });

  it("nothing for a row marked from the first date, blank throughout, or blank only in the middle", () => {
    const g = grid(["2026-08-01", "2026-08-02", "2026-08-03"], {
      ONTIME: [P, null, P],
      EMPTY: [null, null, null],
    });
    expect(joiningDatesFromRegister(g)).toEqual([]);
  });

  it("nothing when no class was held on the blank dates (nobody marked)", () => {
    const g = grid(["2026-08-15", "2026-08-17"], { A1: [null, P], A2: [null, A] });
    expect(joiningDatesFromRegister(g)).toEqual([]);
  });

  it("counts only class days among the blank ones", () => {
    const g = grid(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"], {
      ONTIME: [P, null, P, P],
      LATE: [null, null, null, P],
    });
    expect(joiningDatesFromRegister(g)).toEqual([{ roll: "LATE", date: "2026-08-04", blankClassDays: 2 }]);
  });
});
