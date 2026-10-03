import { describe, expect, it } from "vitest";
import { buildStrengthCube, type StrengthCatalog } from "./aggregate";
import { buildReport, courseYearSummary, describeScope, summarize, totalCardLabel, totalFor } from "./query";
import type { StrengthFilters, StrengthRow } from "./types";

let n = 0;
const many = (count: number, over: Partial<StrengthRow>): StrengthRow[] =>
  Array.from({ length: count }, () => ({ id: `c${++n}`, department: "DS", course: "B.Tech", year: 1, section: "A", status: "REGULAR", batch: "2026-2030", ...over }));
const F = (over: Partial<StrengthFilters> = {}): StrengthFilters => ({ status: "ENROLLED", ...over });

// B.Tech is offered by AI, CE, CS, DS; M.Tech by CS and AMFS (CS runs both). CE has nobody yet.
const depts = ["AI", "CE", "CS", "DS", "AMFS"].map((c) => ({ id: c, name: c, code: c, isActive: true }));
const catalog: StrengthCatalog = {
  courses: [
    ...["AI", "CE", "CS", "DS"].map((d) => ({ id: `bt-${d}`, name: "B.Tech", departmentId: d, durationYears: 4 })),
    ...["CS", "AMFS"].map((d) => ({ id: `mt-${d}`, name: "M.Tech", departmentId: d, durationYears: 2 })),
    { id: "ph", name: "Ph.D", departmentId: "AMFS", durationYears: 3 }, // configured, nobody enrolled
  ],
  departments: depts,
  sections: [],
};
const rows = [
  ...many(44, { department: "DS", year: 1, section: "DS-A" }),
  ...many(2, { department: "DS", year: 2, section: "DS-A" }),
  ...many(9, { department: "DS", year: 4, status: "GRADUATED" }),
  ...many(2, { department: "AI", year: 2 }),
  ...many(1, { department: "AI", year: 4 }),
  ...many(3, { department: "CS", year: 2 }),
  ...many(3, { department: "CS", year: 4, status: "DETAINED" }),
  ...many(3, { department: "CS", course: "M.Tech", year: 1 }),
  ...many(1, { department: "AMFS", course: "M.Tech", year: 2 }),
];
const { cells, meta } = buildStrengthCube(rows, catalog);
const summary = (f: StrengthFilters = F()) => courseYearSummary(buildReport(cells, meta, f, { includeEmptyDepartments: true }), meta);
const sum = (xs: { count: number }[]) => xs.reduce((a, x) => a + x.count, 0);
const flat = (cs: ReturnType<typeof summary>) => cs.map((c) => [c.label, c.count, c.years.map((y) => `${y.label}:${y.count}`).join(" ")]);

// Enrolled B.Tech: DS 46 (44+2; 9 graduates excluded) + AI 3 + CS 6 (3 + 3 detained) = 55 (I 44, II 2+2+3 = 7, IV 1+3 = 4). M.Tech: 3 + 1 = 4. Total 59.

describe("courseYearSummary - each course, one after another, with its years", () => {
  it("lists every course with its total and its year-wise counts", () => {
    expect(flat(summary())).toEqual([
      ["B.Tech", 55, "I Year:44 II Year:7 III Year:0 IV Year:4"],
      ["M.Tech", 4, "I Year:3 II Year:1"], // M.Tech is a 2-year course
      ["Ph.D", 0, "I Year:0 II Year:0 III Year:0"], // configured, nobody enrolled: an exact 0, still listed
    ]);
  });

  it("the years of every course add up to that course's total, and the courses to the big number", () => {
    const s = summary();
    for (const c of s) expect(sum(c.years)).toBe(c.count);
    expect(sum(s)).toBe(totalFor(cells, F()));
  });

  it("keeps B.Tech and M.Tech separate (CS students in each course are not mixed)", () => {
    const s = summary(F({ branch: "cs" }));
    expect(flat(s)).toEqual([
      ["B.Tech", 6, "I Year:0 II Year:3 III Year:0 IV Year:3"],
      ["M.Tech", 3, "I Year:3 II Year:0"],
    ]);
  });

  it("carries the program key so a click can filter to the course", () => {
    expect(summary().map((c) => c.key)).toEqual(["b.tech", "m.tech", "ph.d"]);
  });
});

describe("it follows the filters", () => {
  it("Program = B.Tech: only B.Tech", () => {
    expect(flat(summary(F({ program: "b.tech" })))).toEqual([["B.Tech", 55, "I Year:44 II Year:7 III Year:0 IV Year:4"]]);
  });

  it("Department = DS: only the courses that offer DS, counted for DS alone", () => {
    expect(flat(summary(F({ branch: "ds" })))).toEqual([["B.Tech", 46, "I Year:44 II Year:2 III Year:0 IV Year:0"]]);
  });

  it("Program = B.Tech + Department = DS keeps the single course", () => {
    expect(flat(summary(F({ program: "b.tech", branch: "ds" })))).toEqual([["B.Tech", 46, "I Year:44 II Year:2 III Year:0 IV Year:0"]]);
  });

  it("Year = I: every course shows only that year", () => {
    expect(flat(summary(F({ year: 1 })))).toEqual([
      ["B.Tech", 44, "I Year:44"],
      ["M.Tech", 3, "I Year:3"],
      ["Ph.D", 0, "I Year:0"],
    ]);
  });

  it("a year past a course's length drops that course (no III Year M.Tech)", () => {
    expect(summary(F({ year: 3 })).map((c) => c.label)).toEqual(["B.Tech", "Ph.D"]);
  });

  it("Section filter narrows the counts", () => {
    expect(flat(summary(F({ program: "b.tech", section: "ds-a" })))).toEqual([["B.Tech", 46, "I Year:44 II Year:2 III Year:0 IV Year:0"]]);
  });

  it("honors the status rule", () => {
    expect(flat(summary(F({ status: "GRADUATED", program: "b.tech" })))).toEqual([["B.Tech", 9, "I Year:0 II Year:0 III Year:0 IV Year:9"]]);
    expect(flat(summary(F({ status: "DETAINED", program: "b.tech" })))).toEqual([["B.Tech", 3, "I Year:0 II Year:0 III Year:0 IV Year:3"]]);
  });

  it("an empty combination is an exact 0, not a missing course", () => {
    const s = summary(F({ program: "b.tech", branch: "ds", year: 3 }));
    expect(flat(s)).toEqual([["B.Tech", 0, "III Year:0"]]);
  });
});

describe("agrees with brute-force counting of the raw student rows", () => {
  const enrolled = (r: StrengthRow) => r.status === "REGULAR" || r.status === "DETAINED";
  const naive = (f: StrengthFilters, pick: (r: StrengthRow) => boolean) =>
    rows.filter((r) => {
      const st = (r.status ?? "REGULAR").toUpperCase();
      if (f.status === "ENROLLED" ? !enrolled(r) : f.status !== "ALL" && st !== f.status) return false;
      if (f.program !== undefined && (r.course ?? "").toLowerCase() !== f.program) return false;
      if (f.branch !== undefined && (r.department ?? "").toLowerCase() !== f.branch) return false;
      if (f.year !== undefined && r.year !== f.year) return false;
      if (f.section !== undefined && (r.section ?? "").toLowerCase() !== f.section) return false;
      return pick(r);
    }).length;

  it("every course total and every year count matches over many filter combinations", () => {
    let checked = 0;
    for (const status of ["ENROLLED", "ALL", "DETAINED", "GRADUATED"]) {
      for (const program of [undefined, "b.tech", "m.tech"]) {
        for (const branch of [undefined, "ds", "cs", "ai", "amfs", "ce"]) {
          for (const year of [undefined, 1, 2, 3, 4]) {
            for (const section of [undefined, "ds-a", "a"]) {
              const f: StrengthFilters = { status, program, branch, year, section };
              for (const c of summary(f)) {
                const key = c.label.toLowerCase();
                expect(c.count, `${JSON.stringify(f)} ${c.label}`).toBe(naive(f, (r) => (r.course ?? "").toLowerCase() === key));
                expect(sum(c.years)).toBe(c.count);
                for (const y of c.years) expect(y.count).toBe(naive(f, (r) => (r.course ?? "").toLowerCase() === key && r.year === y.year));
                checked += 1;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("scope + wording helpers", () => {
  it("describeScope spells out every dimension, marking the ones not narrowed as All", () => {
    expect(describeScope(F(), meta).map((p) => [p.label, p.value, p.all])).toEqual([
      ["Course", "All courses", true], ["Department", "All departments", true], ["Year", "All years", true], ["Section", "All sections", true],
    ]);
    const parts = describeScope(F({ program: "b.tech", branch: "ds", year: 1, section: "ds-a" }), meta);
    expect(parts.map((p) => `${p.label}: ${p.value}`)).toEqual(["Course: B.Tech", "Department: DS", "Year: I Year", "Section: Section DS-A"]);
  });

  it("totalCardLabel names the status rule and the scope", () => {
    expect(totalCardLabel("ENROLLED", meta, false)).toBe("Total college students");
    expect(totalCardLabel("ENROLLED", meta, true)).toBe("Total students (your department)");
    expect(totalCardLabel("ALL", meta, false)).toBe("Total students in college (all statuses)");
  });

  it("summary carries only the total and the per-program totals", () => {
    const s = summarize(cells, meta, "ENROLLED");
    expect(Object.keys(s).sort()).toEqual(["byProgram", "total"]);
    expect(s.total).toBe(59);
    expect(s.byProgram.map((p) => [p.label, p.count])).toEqual([["B.Tech", 55], ["M.Tech", 4]]);
  });
});
