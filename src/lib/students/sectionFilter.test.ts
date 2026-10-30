import { describe, expect, it } from "vitest";
import { fetchMatchingStudentIds, fetchStudentsPage } from "./paginatedList";
import {
  keepSectionPick,
  normalizeSectionFilter,
  sectionFilterOptions,
  sectionMatchesFilter,
  UNASSIGNED_SECTION,
} from "./sectionFilter";

describe("sectionMatchesFilter", () => {
  it("passes everyone when no section is picked", () => {
    expect(sectionMatchesFilter("A", "")).toBe(true);
    expect(sectionMatchesFilter("", "")).toBe(true);
    expect(sectionMatchesFilter(undefined, "")).toBe(true);
  });

  it("matches a section name exactly", () => {
    expect(sectionMatchesFilter("A", "A")).toBe(true);
    expect(sectionMatchesFilter("B", "A")).toBe(false);
    expect(sectionMatchesFilter("", "A")).toBe(false);
    expect(sectionMatchesFilter(undefined, "A")).toBe(false);
  });

  it("treats a blank or missing section as unassigned, and a placed one as not", () => {
    expect(sectionMatchesFilter("", UNASSIGNED_SECTION)).toBe(true);
    expect(sectionMatchesFilter("  ", UNASSIGNED_SECTION)).toBe(true);
    expect(sectionMatchesFilter(undefined, UNASSIGNED_SECTION)).toBe(true);
    expect(sectionMatchesFilter(null, UNASSIGNED_SECTION)).toBe(true);
    expect(sectionMatchesFilter("A", UNASSIGNED_SECTION)).toBe(false);
  });
});

describe("normalizeSectionFilter", () => {
  it("reads 'all' / blank as no filter and keeps everything else", () => {
    expect(normalizeSectionFilter(null)).toBe("");
    expect(normalizeSectionFilter("all")).toBe("");
    expect(normalizeSectionFilter("  ")).toBe("");
    expect(normalizeSectionFilter(" A ")).toBe("A");
    expect(normalizeSectionFilter(UNASSIGNED_SECTION)).toBe(UNASSIGNED_SECTION);
  });
});

describe("sectionFilterOptions", () => {
  const sections = [
    { name: "A", department: "CSE", year: 1 },
    { name: "B", department: "CSE", year: 1 },
    { name: "A", department: "ECE", year: 2 },
    { name: "C", department: "ECE", year: 2 },
    { name: "A", department: "Basic Science", secondaryDepartments: ["CSE"], year: 1 },
    { name: "10", department: "IT", year: 3 },
    { name: "2", department: "IT", year: 3 },
    { name: " ", department: "IT", year: 3 },
    { department: "IT", year: 3 },
  ];

  it("offers each name once across the whole college, in natural order", () => {
    expect(sectionFilterOptions(sections, { departments: [], year: "all" })).toEqual(["2", "10", "A", "B", "C"]);
  });

  it("narrows by the picked department, counting a cross-listed section too", () => {
    expect(sectionFilterOptions(sections, { departments: ["ECE"], year: "all" })).toEqual(["A", "C"]);
    expect(sectionFilterOptions(sections, { departments: ["CSE"], year: "all" })).toEqual(["A", "B"]);
  });

  it("rolls a container department up to its sub-departments", () => {
    expect(sectionFilterOptions(sections, { departments: ["ECE", "IT"], year: "all" })).toEqual(["2", "10", "A", "C"]);
  });

  it("narrows by year", () => {
    expect(sectionFilterOptions(sections, { departments: [], year: "2" })).toEqual(["A", "C"]);
    expect(sectionFilterOptions(sections, { departments: ["CSE"], year: "1" })).toEqual(["A", "B"]);
  });

  it("never drops a section that is missing the field being compared", () => {
    const loose = [{ name: "X" }, { name: "Y", department: "CSE" }, { name: "Z", year: 3 }];
    expect(sectionFilterOptions(loose, { departments: ["ECE"], year: "all" })).toEqual(["X", "Z"]);
    expect(sectionFilterOptions(loose, { departments: [], year: "1" })).toEqual(["X", "Y"]);
  });
});

describe("keepSectionPick", () => {
  it("keeps a pick that is still offered, and the two fixed picks", () => {
    expect(keepSectionPick("A", ["A", "B"], true)).toBe("A");
    expect(keepSectionPick("all", [], true)).toBe("all");
    expect(keepSectionPick(UNASSIGNED_SECTION, [], true)).toBe(UNASSIGNED_SECTION);
  });

  it("drops a pick that is no longer offered - but only once the sections have loaded", () => {
    expect(keepSectionPick("Z", ["A", "B"], true)).toBe("all");
    expect(keepSectionPick("Z", [], false)).toBe("Z");
  });
});

// ── The list query ──────────────────────────────────────────────────────────
// A tiny in-memory stand-in for the students collection: just the calls
// paginatedList.ts makes (count, orderBy/offset/limit, where "==" / "in", get).

type Row = Record<string, unknown>;
function fakeStudents(rows: Row[]) {
  const docs = rows.map((r, i) => ({ id: String(r.id ?? `s${i}`), data: () => r }));
  const stats = { wheres: [] as string[], fullReads: 0 };
  const snap = (list: typeof docs) => ({ docs: list });
  const query = (list: typeof docs): Record<string, unknown> => ({
    where: (field: string, op: string, value: unknown) => {
      stats.wheres.push(`${field} ${op} ${JSON.stringify(value)}`);
      const next = list.filter((d) => {
        const v = d.data()[field];
        return op === "in" ? (value as unknown[]).includes(v) : v === value;
      });
      return query(next);
    },
    get: async () => {
      if (list === docs) stats.fullReads++;
      return snap(list);
    },
    count: () => ({ get: async () => ({ data: () => ({ count: list.length }) }) }),
    orderBy: () => ({
      offset: (n: number) => ({ limit: (m: number) => ({ get: async () => snap(list.slice(n, n + m)) }) }),
    }),
  });
  return { collection: query(docs) as unknown as FirebaseFirestore.CollectionReference, stats };
}

const roster: Row[] = [
  { id: "a1", name: "Asha", rollNumber: "R1", department: "CSE", year: 1, section: "A" },
  { id: "a2", name: "Bala", rollNumber: "R2", department: "CSE", year: 1, section: "B" },
  { id: "a3", name: "Chitra", rollNumber: "R3", department: "ECE", year: 1, section: "A" },
  { id: "a4", name: "Dev", rollNumber: "R4", department: "CSE", year: 2, section: "" },
  { id: "a5", name: "Esha", rollNumber: "R5", department: "CSE", year: 2 }, // no section field at all
  { id: "a6", name: "Farid", rollNumber: "R6", department: "CSE", year: 2, section: "A" },
];

const base = { page: 1, pageSize: 50, search: "", departments: [] as string[], course: "", year: null as number | null, studentType: "" };
const ids = (r: { students: { id: string }[] }) => r.students.map((s) => s.id).sort();

describe("the paged list with a section filter", () => {
  it("lists only that section's students, across every department when none is picked", async () => {
    const { collection } = fakeStudents(roster);
    const result = await fetchStudentsPage(collection, { ...base, section: "A" });
    expect(ids(result)).toEqual(["a1", "a3", "a6"]);
    expect(result.total).toBe(3);
  });

  it("narrows what the department / year filters picked instead of replacing them", async () => {
    const { collection } = fakeStudents(roster);
    expect(ids(await fetchStudentsPage(collection, { ...base, departments: ["CSE"], section: "A" }))).toEqual(["a1", "a6"]);
    expect(ids(await fetchStudentsPage(collection, { ...base, departments: ["CSE"], year: 1, section: "A" }))).toEqual(["a1"]);
  });

  it("finds every unassigned student - an empty section and a missing one alike", async () => {
    const { collection } = fakeStudents(roster);
    expect(ids(await fetchStudentsPage(collection, { ...base, section: UNASSIGNED_SECTION }))).toEqual(["a4", "a5"]);
  });

  it("changes nothing when no section is picked", async () => {
    const { collection } = fakeStudents(roster);
    const none = await fetchStudentsPage(collection, { ...base });
    const blank = await fetchStudentsPage(collection, { ...base, section: "" });
    expect(none.total).toBe(roster.length);
    expect(blank.total).toBe(roster.length);
  });

  it("pushes a lone section name down as an equality, but never a lone 'unassigned'", async () => {
    const named = fakeStudents(roster);
    await fetchStudentsPage(named.collection, { ...base, section: "A" });
    expect(named.stats.wheres).toEqual(['section == "A"']);
    expect(named.stats.fullReads).toBe(0);

    const unassigned = fakeStudents(roster);
    await fetchStudentsPage(unassigned.collection, { ...base, section: UNASSIGNED_SECTION });
    expect(unassigned.stats.wheres).toEqual([]);
  });

  it("keeps 'select all matching' in step with the list, so a bulk action never reaches beyond what is shown", async () => {
    const { collection } = fakeStudents(roster);
    for (const query of [
      { ...base, section: "A" },
      { ...base, departments: ["CSE"], section: "A" },
      { ...base, year: 2, section: UNASSIGNED_SECTION },
    ]) {
      const page = await fetchStudentsPage(collection, query);
      const matching = await fetchMatchingStudentIds(collection, query);
      expect(matching.sort()).toEqual(ids(page));
    }
  });
});

describe("the paged list order", () => {
  const mixed: Row[] = [
    { id: "u1", name: "Un", rollNumber: "R1", department: "CSE", year: 1, section: "" },
    { id: "b2", name: "B2", rollNumber: "R2", department: "CSE", year: 1, section: "B" },
    { id: "a2", name: "A2", rollNumber: "R10", department: "CSE", year: 1, section: "A" },
    { id: "a1", name: "A1", rollNumber: "r2", department: "CSE", year: 1, section: "A" },
    { id: "b1", name: "B1", rollNumber: "R1", department: "CSE", year: 1, section: "B" },
    { id: "nn", name: "", rollNumber: "R3", department: "CSE", year: 1, section: "A" },
  ];
  const order = (r: { students: { id: string }[] }) => r.students.map((s) => s.id);

  it("is Section then Regd. No - with or without a filter - and keeps every student", async () => {
    const { collection } = fakeStudents(mixed);
    const all = await fetchStudentsPage(collection, { ...base });
    expect(order(all)).toEqual(["a1", "nn", "a2", "b1", "b2", "u1"]);
    expect(all.total).toBe(mixed.length);
    const filtered = await fetchStudentsPage(collection, { ...base, departments: ["CSE"], year: 1 });
    expect(order(filtered)).toEqual(order(all));
  });

  it("pages through the same order without repeating or dropping anyone", async () => {
    const { collection } = fakeStudents(mixed);
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      seen.push(...order(await fetchStudentsPage(collection, { ...base, pageSize: 2, page })));
    }
    expect(seen).toEqual(["a1", "nn", "a2", "b1", "b2", "u1"]);
  });
});
