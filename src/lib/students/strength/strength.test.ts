import { describe, expect, it } from "vitest";
import { buildStrengthCube, effectiveBranchName, type StrengthCatalog } from "./aggregate";
import { normStatus } from "./config";
import {
  buildReport,
  cellMatches,
  describeFilters,
  filterOptions,
  sanitizeFilters,
  summarize,
  totalFor,
} from "./query";
import type { StrengthFilters, StrengthRow } from "./types";

let seq = 0;
function student(over: Partial<StrengthRow> = {}): StrengthRow {
  seq += 1;
  return {
    id: `s${seq}`,
    name: `Student ${seq}`,
    rollNumber: `R${String(seq).padStart(5, "0")}`,
    department: "IT",
    course: "B.Tech",
    year: 2,
    section: "A",
    status: "REGULAR",
    batch: "2025-2029",
    ...over,
  };
}

function many(n: number, over: Partial<StrengthRow>): StrengthRow[] {
  return Array.from({ length: n }, () => student(over));
}

const F = (over: Partial<StrengthFilters> = {}): StrengthFilters => ({ status: "ENROLLED", ...over });

const EMPTY_CATALOG: StrengthCatalog = { courses: [], departments: [], sections: [] };

describe("effectiveBranchName", () => {
  it("uses the real branch for a shared-first-year student, the filing department otherwise", () => {
    expect(effectiveBranchName({ department: "Basic Science-Maths", secondaryDepartment: "CSE" })).toBe("CSE");
    expect(effectiveBranchName({ department: "CSE", secondaryDepartment: undefined })).toBe("CSE");
    expect(effectiveBranchName({ department: "CSE", secondaryDepartment: null })).toBe("CSE");
    expect(effectiveBranchName({ department: "CSE", secondaryDepartment: "   " })).toBe("CSE");
  });
});

describe("normStatus", () => {
  it("treats a missing status as REGULAR and normalizes case/spacing", () => {
    expect(normStatus(undefined)).toBe("REGULAR");
    expect(normStatus("")).toBe("REGULAR");
    expect(normStatus(" detained ")).toBe("DETAINED");
    expect(normStatus("Left College")).toBe("LEFT_COLLEGE");
  });
});

describe("buildStrengthCube - counting rules", () => {
  it("counts every student exactly once: sum of cells equals students scanned", () => {
    const rows = [
      ...many(5, { department: "IT", section: "A" }),
      ...many(4, { department: "IT", section: "B" }),
      ...many(3, { department: "CSE", section: "A", year: 3 }),
      ...many(2, { department: "CSE", section: "", year: 3 }),
      ...many(2, { status: "GRADUATED", year: 4 }),
    ];
    const { cells } = buildStrengthCube(rows, EMPTY_CATALOG);
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(rows.length);
  });

  it("never merges students who share a name - or even a roll number", () => {
    const rows = [
      student({ name: "Ravi Kumar", rollNumber: "21A01", section: "A" }),
      student({ name: "Ravi Kumar", rollNumber: "21A02", section: "A" }),
      student({ name: "Ravi Kumar", rollNumber: "21A02", section: "B" }), // same roll: data error, still 3 people
    ];
    const { cells, health } = buildStrengthCube(rows, EMPTY_CATALOG);
    expect(totalFor(cells, F())).toBe(3);
    expect(totalFor(cells, F({ section: "a" }))).toBe(2);
    expect(totalFor(cells, F({ section: "b" }))).toBe(1);
    // ...and the duplicate roll is surfaced, not silently absorbed.
    expect(health.duplicateRolls).toHaveLength(1);
    expect(health.duplicateRolls[0]).toMatchObject({ roll: "21A02", count: 2 });
  });

  it("detects duplicate roll numbers case- and space-insensitively", () => {
    const rows = [student({ rollNumber: "21a01 " }), student({ rollNumber: "21A01" })];
    expect(buildStrengthCube(rows, EMPTY_CATALOG).health.duplicateRolls).toHaveLength(1);
  });

  it("counts a student in exactly one section - moving section moves the count, never doubles it", () => {
    const mover = student({ id: "mover", section: "A" });
    const others = many(3, { section: "A" });
    const before = buildStrengthCube([mover, ...others], EMPTY_CATALOG).cells;
    expect(totalFor(before, F({ section: "a" }))).toBe(4);
    expect(totalFor(before, F({ section: "b" }))).toBe(0);

    const after = buildStrengthCube([{ ...mover, section: "B" }, ...others], EMPTY_CATALOG).cells;
    expect(totalFor(after, F({ section: "a" }))).toBe(3);
    expect(totalFor(after, F({ section: "b" }))).toBe(1);
    expect(totalFor(after, F())).toBe(4);
  });

  it("follows a student through department change and year promotion", () => {
    const s = student({ id: "x", department: "IT", year: 2 });
    const c1 = buildStrengthCube([s], EMPTY_CATALOG).cells;
    expect(totalFor(c1, F({ branch: "it", year: 2 }))).toBe(1);

    const moved = buildStrengthCube([{ ...s, department: "CSE", year: 3 }], EMPTY_CATALOG).cells;
    expect(totalFor(moved, F({ branch: "it" }))).toBe(0);
    expect(totalFor(moved, F({ branch: "cse", year: 3 }))).toBe(1);
  });

  it("applies the status rules: Regular + Detained count; Graduated / unknown do not", () => {
    const rows = [
      ...many(6, { status: "REGULAR" }),
      ...many(2, { status: "DETAINED" }),
      ...many(4, { status: "GRADUATED" }),
      ...many(1, { status: "DISCONTINUED" }),
      ...many(1, { status: "SOMETHING_NEW" }),
      student({ status: undefined }), // legacy doc without a status -> REGULAR
    ];
    const { cells, health } = buildStrengthCube(rows, EMPTY_CATALOG);
    expect(totalFor(cells, F())).toBe(9); // 6 + 2 + the status-less one
    expect(totalFor(cells, F({ status: "DETAINED" }))).toBe(2);
    expect(totalFor(cells, F({ status: "GRADUATED" }))).toBe(4);
    expect(totalFor(cells, F({ status: "ALL" }))).toBe(rows.length);
    expect(health.unrecognizedStatus).toBe(1); // SOMETHING_NEW; DISCONTINUED is a known, excluded status
  });

  it("reports an empty combination as exactly 0", () => {
    const { cells } = buildStrengthCube(many(3, { department: "IT", year: 2, section: "A" }), EMPTY_CATALOG);
    expect(totalFor(cells, F({ branch: "it", year: 2, section: "c" }))).toBe(0);
    expect(totalFor(cells, F({ branch: "mech" }))).toBe(0);
    expect(totalFor([], F())).toBe(0);
  });

  it("counts students with no section as their own bucket, separate from every real section", () => {
    const rows = [...many(3, { section: "A" }), ...many(2, { section: "" }), ...many(1, { section: undefined })];
    const { cells, health } = buildStrengthCube(rows, EMPTY_CATALOG);
    expect(totalFor(cells, F({ section: "" }))).toBe(3);
    expect(totalFor(cells, F({ section: "a" }))).toBe(3);
    expect(health.enrolledWithoutSection).toBe(3);
  });

  it("merges program spellings into one program and prefers the configured Course name", () => {
    const catalog: StrengthCatalog = {
      courses: [{ id: "c1", name: "Bachelor Of Technology", departmentId: "d1", durationYears: 4 }],
      departments: [{ id: "d1", name: "IT", code: "IT" }],
      sections: [],
    };
    const rows = [
      student({ course: "BACHELOR OF TECHNOLOGY" }),
      student({ course: "bachelor  of technology" }),
      student({ course: undefined, courseId: "c1" }),
    ];
    const { cells, meta } = buildStrengthCube(rows, catalog);
    expect(meta.programs.filter((p) => p.key !== "")).toHaveLength(1);
    expect(meta.programs[0].label).toBe("Bachelor Of Technology");
    expect(totalFor(cells, F({ program: "bachelor of technology" }))).toBe(3);
  });

  it("counts a shared-first-year student under their real branch, and moves them on promotion", () => {
    const fresher = student({ department: "Basic Science-Maths", secondaryDepartment: "CSE", year: 1, section: "BSM-CSE-A" });
    const cells1 = buildStrengthCube([fresher], EMPTY_CATALOG).cells;
    expect(totalFor(cells1, F({ branch: "cse", year: 1 }))).toBe(1);
    expect(totalFor(cells1, F({ branch: "basic science-maths" }))).toBe(0);

    // promotion clears secondaryDepartment and files them under CSE for good
    const promoted = { ...fresher, department: "CSE", secondaryDepartment: undefined, year: 2, section: "CSE-A" };
    const cells2 = buildStrengthCube([promoted], EMPTY_CATALOG).cells;
    expect(totalFor(cells2, F({ branch: "cse" }))).toBe(1);
    expect(totalFor(cells2, F({ branch: "cse", year: 1 }))).toBe(0);
  });

  it("supports departments with different numbers of sections, and different programs side by side", () => {
    const rows = [
      ...many(10, { department: "CSE", section: "A" }),
      ...many(10, { department: "CSE", section: "B" }),
      ...many(10, { department: "CSE", section: "C" }),
      ...many(7, { department: "CIVIL", section: "A" }),
      ...many(5, { department: "AMFS", course: "M.Tech", year: 1, section: "M1" }),
    ];
    const { cells, meta } = buildStrengthCube(rows, EMPTY_CATALOG);
    const report = buildReport(cells, meta, F());
    const cse = report.sections.filter((s) => s.branch === "cse");
    const civil = report.sections.filter((s) => s.branch === "civil");
    expect(cse.map((s) => s.count)).toEqual([10, 10, 10]);
    expect(civil.map((s) => s.count)).toEqual([7]);
    expect(totalFor(cells, F({ program: "m.tech" }))).toBe(5);
    expect(totalFor(cells, F({ program: "b.tech" }))).toBe(37);
  });
});

describe("buildReport - reconciliation", () => {
  const catalog: StrengthCatalog = {
    courses: [
      { id: "cb-it", name: "B.Tech", departmentId: "it", durationYears: 4 },
      { id: "cb-me", name: "B.Tech", departmentId: "me", durationYears: 4 },
    ],
    departments: [
      { id: "it", name: "Information Technology", code: "IT" },
      { id: "me", name: "Mechanical", code: "MECH" },
    ],
    sections: [
      { department: "Information Technology", courseId: "cb-it", name: "A", year: 2 },
      { department: "Information Technology", courseId: "cb-it", name: "B", year: 2 },
      { department: "Information Technology", courseId: "cb-it", name: "C", year: 2 }, // configured, still empty
    ],
  };
  const rows = [
    ...many(60, { department: "Information Technology", section: "A", year: 2 }),
    ...many(62, { department: "Information Technology", section: "B", year: 2 }),
    ...many(70, { department: "Information Technology", section: "A", year: 1 }),
    ...many(10, { department: "Mechanical", section: "A", year: 4 }),
    ...many(3, { department: "Mechanical", section: "", year: 4 }),
    ...many(9, { department: "Mechanical", section: "A", year: 4, status: "GRADUATED" }),
  ];
  const { cells, meta } = buildStrengthCube(rows, catalog);

  it("grand total = sum of program tables = sum of section rows = totalFor", () => {
    for (const filters of [F(), F({ status: "ALL" }), F({ branch: "information technology" }), F({ year: 2 }), F({ section: "a" })]) {
      const r = buildReport(cells, meta, filters);
      expect(r.total).toBe(totalFor(cells, filters));
      expect(r.matrices.reduce((n, m) => n + m.total, 0)).toBe(r.total);
      expect(r.sections.reduce((n, s) => n + s.count, 0)).toBe(r.total);
    }
  });

  it("builds the Department x Year table with row and column totals", () => {
    const m = buildReport(cells, meta, F()).matrices[0];
    expect(m.years).toEqual([1, 2, 3, 4]);
    const it = m.rows.find((r) => r.code === "IT")!;
    expect(it.byYear).toEqual({ 1: 70, 2: 122, 3: 0, 4: 0 });
    expect(it.total).toBe(192);
    const me = m.rows.find((r) => r.code === "MECH")!;
    expect(me.byYear[4]).toBe(13); // 10 + 3 unsectioned; the 9 graduates are excluded
    expect(m.byYear).toEqual({ 1: 70, 2: 122, 3: 0, 4: 13 });
    expect(m.total).toBe(205);
  });

  it("shows a configured section with no students as 0 (and not a phantom duplicate of a populated one)", () => {
    const secs = buildReport(cells, meta, F({ branch: "information technology", year: 2 })).sections;
    expect(secs.map((s) => [s.sectionLabel, s.count])).toEqual([
      ["A", 60],
      ["B", 62],
      ["C", 0],
    ]);
  });

  it("keeps a graduated-only section visible at 0 under the Enrolled rule", () => {
    const only = buildStrengthCube(
      many(4, { department: "Mechanical", section: "Z", year: 4, status: "GRADUATED" }),
      { ...catalog, sections: [{ department: "Mechanical", courseId: "cb-me", name: "Z", year: 4 }] }
    );
    const rep = buildReport(only.cells, only.meta, F());
    expect(rep.total).toBe(0);
    expect(rep.sections.map((s) => [s.sectionLabel, s.count])).toEqual([["Z", 0]]);
    expect(buildReport(only.cells, only.meta, F({ status: "GRADUATED" })).sections[0].count).toBe(4);
  });

  it("lists configured departments with no students only when asked", () => {
    const withEmpty = buildReport(cells, meta, F({ year: 3 }), { includeEmptyDepartments: true }).matrices[0];
    expect(withEmpty.rows.map((r) => [r.code, r.total])).toEqual([["IT", 0], ["MECH", 0]]);
    const without = buildReport(cells, meta, F({ year: 3 }));
    expect(without.matrices).toHaveLength(0);
  });
});

describe("filters", () => {
  const rows = [
    ...many(5, { department: "IT", section: "A", year: 2 }),
    ...many(5, { department: "IT", section: "B", year: 2 }),
    ...many(5, { department: "CSE", section: "A", year: 2 }),
    ...many(5, { department: "CSE", section: "C", year: 3 }),
    ...many(2, { department: "AMFS", course: "M.Tech", year: 1, section: "M1" }),
  ];
  const { cells, meta } = buildStrengthCube(rows, EMPTY_CATALOG);

  it("all filters combine (AND)", () => {
    expect(totalFor(cells, F({ program: "b.tech", branch: "it", year: 2, section: "a" }))).toBe(5);
    expect(totalFor(cells, F({ branch: "it" }))).toBe(10);
    expect(totalFor(cells, F({ branch: "cse", section: "a" }))).toBe(5);
    expect(totalFor(cells, F({ branch: "it", section: "c" }))).toBe(0);
  });

  it("cascades: the section list only offers sections that exist for the chosen department/year", () => {
    const o = filterOptions(cells, meta, F({ branch: "cse", year: 3 }));
    expect(o.sections.map((s) => s.label)).toEqual(["C"]);
    expect(filterOptions(cells, meta, F({ branch: "it" })).sections.map((s) => s.label)).toEqual(["A", "B"]);
    expect(filterOptions(cells, meta, F({ program: "m.tech" })).branches.map((b) => b.label)).toEqual(["AMFS"]);
  });

  it("does not let the status filter hide options", () => {
    const o = filterOptions(cells, meta, F({ status: "GRADUATED" }));
    expect(o.branches.length).toBe(3);
  });

  it("drops a selection that a parent filter change made invalid", () => {
    const stale = F({ branch: "cse", year: 3, section: "b" });
    const clean = sanitizeFilters(stale, filterOptions(cells, meta, stale));
    expect(clean.section).toBeUndefined();
    expect(clean.branch).toBe("cse");
    expect(clean.year).toBe(3);
  });

  it("describes the selection in plain language", () => {
    expect(describeFilters(F({ program: "b.tech", branch: "it", year: 2, section: "a" }), meta)).toBe("B.Tech · IT · II Year · Section A");
    expect(describeFilters(F(), meta)).toBe("Whole college");
  });

  it("summary cards ignore the narrowing filters but honor the status rule", () => {
    const s = summarize(cells, meta, "ENROLLED");
    expect(s.total).toBe(22);
    expect(s.byProgram.map((p) => [p.label, p.count])).toEqual([["B.Tech", 20], ["M.Tech", 2]]);
  });
});

describe("randomized cross-check against brute-force counting", () => {
  it("agrees with a naive filter over 3000 generated students and many filter combinations", () => {
    // deterministic LCG so a failure is reproducible
    let x = 12345;
    const rnd = (n: number) => {
      x = (x * 1664525 + 1013904223) % 4294967296;
      return x % n;
    };
    const depts = ["CSE", "IT", "ECE", "EEE", "MECH", "CIVIL", "AIDS", "CSBS", "AIML"];
    const sections = ["A", "B", "C", "D", ""];
    const statuses = ["REGULAR", "REGULAR", "REGULAR", "DETAINED", "GRADUATED", undefined];
    const rows: StrengthRow[] = Array.from({ length: 3000 }, () => {
      const isM = rnd(10) === 0;
      const dept = depts[rnd(depts.length)];
      const fresher = !isM && rnd(4) === 0;
      return student({
        department: fresher ? "Basic Science" : dept,
        secondaryDepartment: fresher ? dept : undefined,
        course: isM ? "M.Tech" : "B.Tech",
        year: isM ? 1 + rnd(2) : 1 + rnd(4),
        section: sections[rnd(sections.length)],
        status: statuses[rnd(statuses.length)],
        batch: `${2022 + rnd(4)}-${2026 + rnd(4)}`,
      });
    });
    const { cells, meta } = buildStrengthCube(rows, EMPTY_CATALOG);
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(3000);

    const naive = (f: StrengthFilters): number =>
      rows.filter((r) => {
        const branch = (r.secondaryDepartment || r.department || "").toLowerCase();
        const st = (r.status ?? "REGULAR").toUpperCase();
        const enrolled = st === "REGULAR" || st === "DETAINED";
        if (f.status === "ENROLLED" && !enrolled) return false;
        if (f.status !== "ENROLLED" && f.status !== "ALL" && st !== f.status) return false;
        if (f.program !== undefined && (r.course ?? "").toLowerCase() !== f.program) return false;
        if (f.branch !== undefined && branch !== f.branch) return false;
        if (f.year !== undefined && r.year !== f.year) return false;
        if (f.section !== undefined && (r.section ?? "").toLowerCase() !== f.section) return false;
        if (f.batch !== undefined && (r.batch ?? "").toLowerCase() !== f.batch) return false;
        return true;
      }).length;

    let checked = 0;
    for (const status of ["ENROLLED", "ALL", "DETAINED", "GRADUATED"]) {
      for (const program of [undefined, "b.tech", "m.tech"]) {
        for (const branch of [undefined, ...depts.map((d) => d.toLowerCase())]) {
          for (const year of [undefined, 1, 2, 3, 4]) {
            for (const section of [undefined, "a", "b", "c", "d", ""]) {
              const f: StrengthFilters = { status, program, branch, year, section };
              expect(totalFor(cells, f)).toBe(naive(f));
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(3600);

    // and the report always reconciles to the same number
    for (const f of [F(), F({ program: "b.tech" }), F({ branch: "cse", year: 2 }), F({ status: "ALL" })]) {
      const r = buildReport(cells, meta, f);
      expect(r.matrices.reduce((n, m) => n + m.total, 0)).toBe(naive(f));
      expect(r.sections.reduce((n, s) => n + s.count, 0)).toBe(naive(f));
    }
    // cellMatches is what totalFor uses; spot-check ignore semantics
    expect(cellMatches(cells[0], F({ year: 99 }), ["year"])).toBe(cellMatches(cells[0], F()));
  });
});

describe("the college's spreadsheet, regenerated from student rows", () => {
  // Numbers transcribed from the 2024-25 II-semester strength sheet.
  const btech: Record<string, [number, number, number, number]> = {
    CIVIL: [59, 64, 59, 58],
    EEE: [64, 72, 71, 141],
    MECH: [58, 68, 65, 126],
    ECE: [182, 214, 209, 218],
    CSE: [248, 282, 210, 215],
    IT: [256, 282, 213, 140],
    AIDS: [126, 143, 135, 143],
    CSBS: [66, 71, 67, 71],
    AIML: [120, 140, 137, 71],
  };
  const mtech: Record<string, [number, number]> = {
    AMFS: [12, 7],
    DECS: [12, 5],
    CSEG: [20, 20],
    ELPE: [12, 2],
    CSAM: [20, 0],
  };
  const rows: StrengthRow[] = [];
  for (const [dept, years] of Object.entries(btech)) {
    years.forEach((n, i) => rows.push(...many(n, { department: dept, course: "B.Tech", year: i + 1, section: i % 2 ? "A" : "B" })));
  }
  for (const [dept, years] of Object.entries(mtech)) {
    years.forEach((n, i) => rows.push(...many(n, { department: dept, course: "M.Tech", year: i + 1, section: "M" })));
  }
  const catalog: StrengthCatalog = {
    courses: [
      { id: "bt", name: "B.Tech", durationYears: 4 },
      { id: "mt", name: "M.Tech", durationYears: 2 },
    ],
    departments: [],
    sections: [],
  };
  const { cells, meta } = buildStrengthCube(rows, catalog);
  const report = buildReport(cells, meta, F());

  it("reproduces the B.Tech table row by row", () => {
    const m = report.matrices.find((x) => x.label === "B.Tech")!;
    expect(m.years).toEqual([1, 2, 3, 4]);
    for (const [dept, years] of Object.entries(btech)) {
      const row = m.rows.find((r) => r.label === dept)!;
      expect([row.byYear[1], row.byYear[2], row.byYear[3], row.byYear[4]]).toEqual(years);
      expect(row.total).toBe(years.reduce((a, b) => a + b, 0));
    }
    expect(m.rows.find((r) => r.label === "CIVIL")!.total).toBe(240);
    expect(m.rows.find((r) => r.label === "CSE")!.total).toBe(955);
    expect([m.byYear[1], m.byYear[2], m.byYear[3], m.byYear[4]]).toEqual([1179, 1336, 1166, 1183]);
    expect(m.total).toBe(4864);
  });

  it("reproduces the M.Tech table and the OVERALL STRENGTH", () => {
    const m = report.matrices.find((x) => x.label === "M.Tech")!;
    expect(m.years).toEqual([1, 2]);
    expect(m.rows.find((r) => r.label === "ELPE")!.total).toBe(14);
    expect(m.rows.find((r) => r.label === "CSAM")!.byYear).toEqual({ 1: 20, 2: 0 });
    expect([m.byYear[1], m.byYear[2]]).toEqual([76, 34]);
    expect(m.total).toBe(110);
    expect(report.total).toBe(4974);
  });

  it("answers the office's everyday questions directly", () => {
    expect(totalFor(cells, F({ branch: "it" }))).toBe(891); // "How many students are in IT?"
    expect(totalFor(cells, F({ branch: "it", year: 2 }))).toBe(282); // "...IT students in II Year?"
    expect(totalFor(cells, F({ program: "m.tech" }))).toBe(110);
    expect(summarize(cells, meta, "ENROLLED").total).toBe(4974);
  });
});

// ── A shared-first-year department, as VISHNU WOMEN'S UNIVERSITY configures it:
//    the branches are a CROSS-LISTING (secondaryDepartments), not
//    managedDepartments, and the department teaches year 1 alone. ──
describe("a cross-listing feeder's own filters", () => {
  const CATALOG = {
    courses: [{ id: "c1", name: "B.Tech", departmentId: "cse", durationYears: 4 }],
    departments: [
      { id: "bse", name: "BS English", code: "BSE", secondaryDepartments: ["CSE", "Cyber Security"], assignedYears: [1] },
      { id: "cse", name: "CSE", code: "CSE", assignedYears: [2, 3, 4] },
      { id: "cyb", name: "Cyber Security", code: "CYB", assignedYears: [2, 3, 4] },
    ],
    sections: [],
  };
  // Its 175 students are all filed under it with CSE as their real branch.
  const rows = Array.from({ length: 175 }, (_, i) => ({
    id: `s${i}`, department: "BS English", secondaryDepartment: "CSE",
    course: "B.Tech", year: 1, section: "A", status: "REGULAR",
  }));

  it("does not offer the feeder itself as a Department", () => {
    const { meta } = buildStrengthCube(rows, CATALOG);
    expect(meta.branches.find((b) => b.key === "bs english")?.isFeeder).toBe(true);
  });

  it("counts them under the branch they are headed for, not the feeder", () => {
    const { cells } = buildStrengthCube(rows, CATALOG);
    expect(totalFor(cells, F({ branch: "cse" }))).toBe(175);
    expect(totalFor(cells, F({ branch: "bs english" }))).toBe(0);
  });

  // The Year filter offered I-IV because the COURSE is four years long, though
  // this department teaches only the first.
  it("offers only the years the scope teaches", () => {
    const { cells, meta } = buildStrengthCube(rows, CATALOG);
    expect(filterOptions(cells, meta, F()).years).toEqual([1, 2, 3, 4]);
    expect(filterOptions(cells, { ...meta, scopeYears: [1] }, F()).years).toEqual([1]);
  });

  // The sections are filed under the feeder but belong to the branch they feed,
  // which is where their students are counted - so a branch pick must find them.
  it("lists a shared-first-year section under the branch it feeds", () => {
    const withSections = {
      ...CATALOG,
      sections: [
        { department: "BS English", courseId: "c1", name: "BSE-CSE-A", year: 1, secondaryDepartments: ["CSE"] },
        { department: "BS English", courseId: "c1", name: "BSE-CSE-B", year: 1, secondaryDepartments: ["CSE"] },
        { department: "BS English", courseId: "c1", name: "BSE-CS", year: 1, secondaryDepartments: ["Cyber Security"] },
      ],
    };
    const { cells, meta } = buildStrengthCube(rows, withSections);
    expect(filterOptions(cells, meta, F({ branch: "cse" })).sections.map((x) => x.label))
      .toEqual(expect.arrayContaining(["BSE-CSE-A", "BSE-CSE-B"]));
    expect(filterOptions(cells, meta, F({ branch: "cyber security" })).sections.map((x) => x.label))
      .toEqual(["BSE-CS"]);
  });

  // A plain section, with no branch to feed, still goes under its own department.
  it("leaves an ordinary section under its own department", () => {
    const plain = { ...CATALOG, sections: [{ department: "CSE", courseId: "c1", name: "CSE-A", year: 2 }] };
    const { cells, meta } = buildStrengthCube(rows, plain);
    expect(filterOptions(cells, meta, F({ branch: "cse", year: 2 })).sections.map((x) => x.label)).toEqual(["CSE-A"]);
  });

  // ...but never hides a year somebody is actually counted in.
  it("keeps a year that has students even when it is outside the configuration", () => {
    const strays = [...rows, { id: "x", department: "BS English", secondaryDepartment: "CSE", course: "B.Tech", year: 3, section: "A", status: "REGULAR" }];
    const { cells, meta } = buildStrengthCube(strays, CATALOG);
    expect(filterOptions(cells, { ...meta, scopeYears: [1] }, F()).years).toEqual([1, 3]);
  });
});
