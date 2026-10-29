import { describe, expect, it } from "vitest";
import { compareDefaultFacultyOrder, internalExperienceYears, seatRank } from "./listOrder";

// Today is fixed by the dates below being far from it: a joining date earlier = more internal experience.
const person = (legalName: string, joiningDate: string | undefined, seatRoleCodes?: string[], extra: Record<string, unknown> = {}) => ({
  legalName, joiningDate, ...(seatRoleCodes ? { seatRoleCodes } : {}), ...extra,
});
const order = (rows: ReturnType<typeof person>[]) => [...rows].sort(compareDefaultFacultyOrder).map((r) => r.legalName);

describe("seatRank", () => {
  it("HOD first, Principal second, everyone else after", () => {
    expect(seatRank({ seatRoleCodes: ["HOD"] })).toBe(0);
    expect(seatRank({ seatRoleCodes: ["PRINCIPAL"] })).toBe(1);
    expect(seatRank({ seatRoleCodes: ["VICE_PRINCIPAL"] })).toBe(2);
    expect(seatRank({ seatRoleCodes: ["R_AND_D"] })).toBe(2);
    expect(seatRank({})).toBe(2);
  });
  it("someone holding both seats counts as the HOD", () => {
    expect(seatRank({ seatRoleCodes: ["PRINCIPAL", "HOD"] })).toBe(0);
  });
  it("tolerates rows with no or malformed seat data", () => {
    expect(seatRank({ seatRoleCodes: "HOD" })).toBe(2);
    expect(seatRank({ seatRoleCodes: null })).toBe(2);
  });
});

describe("internalExperienceYears", () => {
  it("counts only service here since joining - previous employers are not included", () => {
    const withPrevious = { joiningDate: "2015-01-01", academicProfile: { academicExperience: [{ institutionName: "X", fromDate: "2000-01-01", toDate: "2010-01-01" }] } };
    expect(internalExperienceYears(withPrevious)).toBe(internalExperienceYears({ joiningDate: "2015-01-01" }));
    expect(internalExperienceYears({ joiningDate: "2010-01-01" })).toBeGreaterThan(internalExperienceYears({ joiningDate: "2020-01-01" }));
  });
  it("is 0 with no joining date or a joining date in the future", () => {
    expect(internalExperienceYears({})).toBe(0);
    expect(internalExperienceYears({ joiningDate: "2999-01-01" })).toBe(0);
  });
});

describe("compareDefaultFacultyOrder", () => {
  it("HOD at the top, then the Principal, then by internal experience, highest first", () => {
    expect(order([
      person("NEWEST", "2024-06-01"),
      person("OLDEST", "2001-06-01"),
      person("PRINCIPAL", "2012-06-01", ["PRINCIPAL"]),
      person("MIDDLE", "2012-06-01"),
      person("HOD", "2020-06-01", ["HOD"]),
    ])).toEqual(["HOD", "PRINCIPAL", "OLDEST", "MIDDLE", "NEWEST"]);
  });

  it("orders by TOTAL experience, so a long career elsewhere counts", () => {
    const external = { academicProfile: { academicExperience: [{ institutionName: "X", fromDate: "1990-01-01", toDate: "2010-01-01" }] } };
    expect(order([person("LONG HERE", "2005-01-01"), person("LONG CAREER", "2015-01-01", undefined, external)])).toEqual(["LONG CAREER", "LONG HERE"]);
  });

  it("the HOD stays on top even with less service than everyone else", () => {
    expect(order([person("SENIOR", "1995-01-01"), person("HOD", "2025-01-01", ["HOD"])])[0]).toBe("HOD");
  });

  it("with no Principal in the list it is HOD, then the rest by internal experience", () => {
    expect(order([person("B", "2018-01-01"), person("A", "2008-01-01"), person("H", "2016-01-01", ["HOD"])])).toEqual(["H", "A", "B"]);
  });

  it("several HODs (a college-wide list) are each above everyone else, ordered by service among themselves", () => {
    expect(order([
      person("PLAIN OLD", "1999-01-01"),
      person("HOD NEW", "2015-01-01", ["HOD"]),
      person("HOD OLD", "2005-01-01", ["HOD"]),
    ])).toEqual(["HOD OLD", "HOD NEW", "PLAIN OLD"]);
  });

  it("people with no joining date go last, and equal service falls back to the name", () => {
    expect(order([person("NO DATE", undefined), person("B", "2010-01-01"), person("A", "2010-01-01")])).toEqual(["A", "B", "NO DATE"]);
  });

  it("orders by the display name, honorific included, when everything else is equal", () => {
    expect(order([person("ZED", "2010-01-01"), person("ADAM", "2010-01-01")])).toEqual(["ADAM", "ZED"]);
  });

  it("does not mutate its input and is stable across repeated sorts", () => {
    const rows = [person("B", "2010-01-01"), person("A", "2005-01-01", ["PRINCIPAL"])];
    const copy = JSON.stringify(rows);
    const once = order(rows);
    expect(JSON.stringify(rows)).toBe(copy);
    expect(order(rows.slice().reverse())).toEqual(once);
  });
});
