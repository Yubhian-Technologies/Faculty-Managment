import { beforeAll, describe, expect, it } from "vitest";
import { fakeStudentsCollection, type FakeStudent } from "@/lib/students/fakeStudentsCollection.testutil";
import { countStudentsInSection, countStudentsOfDepartment } from "@/lib/students/countStudents";
import { fetchGraduatesByIds, fetchGraduatesPage } from "@/lib/students/paginatedList";
import { compareGraduates, graduateFacets } from "@/lib/students/graduates";
import { signStudentId, verifySignedStudentId } from "@/lib/students/signedIds";
import {
  classifyHodStudent,
  fetchHodMeta,
  fetchHodStudentsByIds,
  fetchHodStudentsMatching,
  fetchHodStudentsPage,
  isHodOnDemandRequest,
  type HodListFilters,
  type HodStudentsContext,
} from "@/lib/students/hodPagedList";
import type { Course, StudentRecord } from "@/types";
import type { HodDepartmentScope } from "@/lib/departments/scope";
import type { DepartmentYearRow } from "@/lib/departments/managedBranches";

const stu = (id: string, data: Record<string, unknown>): FakeStudent => ({ id, data });

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

// ── count() instead of reading documents ────────────────────────────────────
describe("countStudentsOfDepartment", () => {
  const students = [
    stu("s1", { department: "CSE" }),
    stu("s2", { department: "BS-Maths", secondaryDepartment: "CSE" }),
    // Matches BOTH fields - must be counted once, not twice.
    stu("s3", { department: "CSE", secondaryDepartment: "CSE" }),
    stu("s4", { department: "ECE" }),
  ];

  it("counts the union of department and secondaryDepartment, a double match once", async () => {
    const { collection } = fakeStudentsCollection(students);
    expect(await countStudentsOfDepartment(collection, "CSE")).toBe(3);
    expect(await countStudentsOfDepartment(collection, "ECE")).toBe(1);
    expect(await countStudentsOfDepartment(collection, "MECH")).toBe(0);
  });

  it("reads no student documents - only count aggregations", async () => {
    const { collection, stats } = fakeStudentsCollection(students);
    await countStudentsOfDepartment(collection, "CSE");
    expect(stats.docsRead).toBe(0);
    expect(stats.countCalls).toBe(3);
  });
});

describe("countStudentsInSection", () => {
  const students = [
    stu("a", { department: "CSE", section: "A", year: 2, courseId: "c1" }),
    stu("b", { department: "CSE", section: "A", year: 2, courseId: "c1" }),
    stu("c", { department: "CSE", section: "A", year: 3, courseId: "c1" }), // other year
    stu("d", { department: "CSE", section: "A", year: 2, courseId: "c2" }), // other course
    stu("e", { department: "CSE", section: "B", year: 2, courseId: "c1" }), // other section
    stu("f", { department: "BS-Maths", secondaryDepartment: "CSE", section: "A", year: 2, courseId: "c1" }),
    stu("g", { department: "CSE", secondaryDepartment: "CSE", section: "A", year: 2, courseId: "c1" }),
  ];

  it("counts exactly the roster the section's filters select, a double match once", async () => {
    const { collection } = fakeStudentsCollection(students);
    expect(await countStudentsInSection(collection, { department: "CSE", sectionName: "A", year: 2, courseId: "c1" })).toBe(4);
  });

  it("leaves year and course unconstrained when not given", async () => {
    const { collection } = fakeStudentsCollection(students);
    // a, b, c, d, f, g in section A (e is section B).
    expect(await countStudentsInSection(collection, { department: "CSE", sectionName: "A" })).toBe(6);
  });
});

// ── signed ids ──────────────────────────────────────────────────────────────
describe("signed student ids", () => {
  it("round-trips for the binding it was issued to", () => {
    const token = signStudentId("college|uid|primary|", "abc123");
    expect(verifySignedStudentId("college|uid|primary|", token)).toBe("abc123");
  });

  it("is rejected for another user, college or view", () => {
    const token = signStudentId("college|uid|primary|", "abc123");
    expect(verifySignedStudentId("college|other|primary|", token)).toBeNull();
    expect(verifySignedStudentId("elsewhere|uid|primary|", token)).toBeNull();
    expect(verifySignedStudentId("college|uid|secondary|BS", token)).toBeNull();
  });

  it("is rejected when the id or signature is tampered with", () => {
    const token = signStudentId("b", "abc123");
    const [, exp, sig] = token.split(".");
    expect(verifySignedStudentId("b", `other.${exp}.${sig}`)).toBeNull();
    // Always a DIFFERENT last character (a fixed "x" would equal the real one 1 time in 64).
    const flipped = sig.endsWith("x") ? "y" : "x";
    expect(verifySignedStudentId("b", `abc123.${exp}.${sig.slice(0, -1)}${flipped}`)).toBeNull();
    expect(verifySignedStudentId("b", "abc123")).toBeNull();
    expect(verifySignedStudentId("b", "../../x.9999999999999.sig")).toBeNull();
  });

  it("expires", () => {
    const token = signStudentId("b", "abc123", 0);
    expect(verifySignedStudentId("b", token, 60_000)).toBe("abc123");
    expect(verifySignedStudentId("b", token, 3 * 60 * 60 * 1000)).toBeNull();
  });
});

// ── Graduated students ──────────────────────────────────────────────────────
describe("graduates", () => {
  const grads: FakeStudent[] = [
    stu("g1", { status: "GRADUATED", name: "Bala", rollNumber: "B2", department: "CSE", graduationCourseName: "B.Tech", graduationBatch: "2021-2025" }),
    stu("g2", { status: "GRADUATED", name: "Anu", rollNumber: "A1", department: "ECE", graduationCourseName: "B.Tech", graduationBatch: "2022-2026" }),
    stu("g3", { status: "GRADUATED", name: "Chitra", rollNumber: "C1", department: "CSE" }),
    stu("r1", { status: "REGULAR", name: "Regular", rollNumber: "R1", department: "CSE" }),
    stu("r2", { status: "DETAINED", name: "Detained", rollNumber: "R2", department: "CSE" }),
  ];
  const q = { page: 1, pageSize: 20, search: "", course: "", batch: "" };

  it("reads only graduates, not the whole roster", async () => {
    const { collection, stats } = fakeStudentsCollection(grads);
    const result = await fetchGraduatesPage(collection, q);
    expect(stats.docsRead).toBe(3);
    expect(result.overallTotal).toBe(3);
    expect(result.students.every((s) => s.status === "GRADUATED")).toBe(true);
  });

  it("orders by course, newest batch first, then roll - unspecified last", async () => {
    const { collection } = fakeStudentsCollection(grads);
    const result = await fetchGraduatesPage(collection, q);
    expect(result.students.map((s) => s.id)).toEqual(["g2", "g1", "g3"]);
    expect(result.orderedIds).toEqual(["g2", "g1", "g3"]);
  });

  it("returns facets over every graduate even when filtered", async () => {
    const { collection } = fakeStudentsCollection(grads);
    const result = await fetchGraduatesPage(collection, { ...q, course: "B.Tech" });
    expect(result.total).toBe(2);
    expect(result.facets.courses).toEqual(["B.Tech", "Unspecified programme"]);
    expect(result.facets.batches).toContain("Unspecified batch");
    expect(result.facets.batches).toContain("2022-2026");
  });

  it("filters by batch (including the Unspecified bucket) and searches name, roll and department", async () => {
    const { collection } = fakeStudentsCollection(grads);
    expect((await fetchGraduatesPage(collection, { ...q, batch: "Unspecified batch" })).students.map((s) => s.id)).toEqual(["g3"]);
    expect((await fetchGraduatesPage(collection, { ...q, search: "a1" })).students.map((s) => s.id)).toEqual(["g2"]);
    expect((await fetchGraduatesPage(collection, { ...q, search: "ece" })).students.map((s) => s.id)).toEqual(["g2"]);
  });

  it("pages and clamps an out-of-range page to the last one", async () => {
    const { collection } = fakeStudentsCollection(grads);
    const second = await fetchGraduatesPage(collection, { ...q, pageSize: 2, page: 2 });
    expect(second.students.map((s) => s.id)).toEqual(["g3"]);
    expect(second.totalPages).toBe(2);
    const beyond = await fetchGraduatesPage(collection, { ...q, pageSize: 2, page: 9 });
    expect(beyond.page).toBe(2);
    expect(beyond.students.map((s) => s.id)).toEqual(["g3"]);
  });

  it("fetches later pages by id: only those documents, in the order asked, graduates only", async () => {
    const { collection, stats } = fakeStudentsCollection(grads);
    const rows = await fetchGraduatesByIds(collection, ["g3", "r1", "missing", "g1"]);
    expect(rows.map((s) => s.id)).toEqual(["g3", "g1"]);
    expect(stats.docsRead).toBe(3); // g3, r1 and g1 exist - the missing id reads nothing
  });

  it("compareGraduates / graduateFacets follow the labels the view shows", () => {
    expect(compareGraduates({ graduationCourseName: "B.Tech" }, {})).toBeLessThan(0);
    expect(graduateFacets([{ graduationBatch: "2020-2024" }, { graduationBatch: "2022-2026" }, {}]).batches).toEqual([
      "Unspecified batch", "2022-2026", "2020-2024",
    ]);
  });
});

// ── HOD Students ────────────────────────────────────────────────────────────
function hodContext(over: {
  own: string[];
  child?: string[];
  managed?: string[];
  departments?: DepartmentYearRow[];
  courses?: Course[];
}): HodStudentsContext {
  const child = over.child ?? [];
  const managed = over.managed ?? [];
  const departments = over.departments ?? [];
  const deptIdByName = new Map<string, string>();
  for (const d of departments) if (d.name) deptIdByName.set(d.name, d.id);
  return {
    scope: {
      departmentName: over.own[0] ?? "",
      departmentId: null,
      ownDepartmentNames: over.own,
      ownDepartmentIds: [],
      childDepartmentNames: child,
      childDepartmentIds: [],
      managedDepartmentNames: managed,
      managedDepartmentIds: [],
    } as unknown as HodDepartmentScope,
    departments,
    courses: over.courses ?? [],
    deptIdByName,
    ownedDeptNames: [...child, ...managed],
    secondaryTargets: Array.from(new Set([...over.own, ...child])),
  };
}

const primaryFilters: HodListFilters = {
  level: "primary",
  freshmanDept: "",
  departmentNames: null,
  course: "",
  year: null,
  unassignedOnly: false,
};

describe("classifyHodStudent", () => {
  // BS-English manages CIVIL's shared first year (year 1); CIVIL's own HOD has years 2-4.
  const departments: DepartmentYearRow[] = [
    { id: "bs", name: "BS-English", managedDepartments: ["CIVIL"], assignedYears: [1] },
    { id: "civil", name: "CIVIL", assignedYears: [2, 3, 4] },
  ];
  const student = (data: Record<string, unknown>) => data as unknown as Omit<StudentRecord, "id">;

  it("gives a manager the managed branch's shared year only", () => {
    const ctx = hodContext({ own: ["BS-English"], managed: ["CIVIL"], departments });
    expect(classifyHodStudent(student({ department: "CIVIL", year: 1 }), ctx)).toBe("primary");
    expect(classifyHodStudent(student({ department: "CIVIL", year: 2 }), ctx)).toBeNull();
  });

  it("gives the branch's own HOD every year except the one its manager runs", () => {
    const ctx = hodContext({ own: ["CIVIL"], departments });
    expect(classifyHodStudent(student({ department: "CIVIL", year: 3 }), ctx)).toBe("primary");
    expect(classifyHodStudent(student({ department: "CIVIL", year: 1 }), ctx)).toBeNull();
  });

  it("treats a sub-department as owned outright and a cross-listed student as view-only", () => {
    const ctx = hodContext({ own: ["CSE"], child: ["Cyber"] });
    expect(classifyHodStudent(student({ department: "Cyber", year: 4 }), ctx)).toBe("primary");
    expect(classifyHodStudent(student({ department: "BS-Maths", secondaryDepartment: "CSE", year: 1 }), ctx)).toBe("secondary");
    expect(classifyHodStudent(student({ department: "ECE", year: 2 }), ctx)).toBeNull();
  });
});

describe("HOD paged list", () => {
  const roster: FakeStudent[] = [
    stu("s1", { department: "CSE", year: 2, section: "A", rollNumber: "R2", name: "Bala", course: "B.Tech" }),
    stu("s2", { department: "CSE", year: 2, section: "", rollNumber: "R1", name: "Anu", course: "B.Tech" }),
    stu("s3", { department: "CSE", year: 3, section: "B", rollNumber: "R3", name: "Chitra", course: "B.Tech" }),
    stu("e1", { department: "ECE", year: 2, section: "A", rollNumber: "E1", name: "Other", course: "B.Tech" }),
    stu("i1", { department: "BS-Maths", secondaryDepartment: "CSE", year: 1, section: "", rollNumber: "I1", name: "Incoming" }),
  ];
  const ctx = hodContext({ own: ["CSE"] });
  const binding = "college|uid|primary|";
  const opts = { page: 1, pageSize: 20, search: "", binding };

  it("lists only this HOD's own students, in roll order, with totals", async () => {
    const { collection } = fakeStudentsCollection(roster);
    const page = await fetchHodStudentsPage(collection, ctx, primaryFilters, opts);
    expect(page.students.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
    expect(page.total).toBe(3);
    expect(page.unassignedTotal).toBe(1);
    expect(page.students.every((s) => s.accessLevel === "primary")).toBe(true);
  });

  it("pushes year, unassigned and department filters down to the query", async () => {
    const all = fakeStudentsCollection(roster);
    await fetchHodStudentsPage(all.collection, ctx, primaryFilters, opts);
    expect(all.stats.docsRead).toBe(3);

    const byYear = fakeStudentsCollection(roster);
    await fetchHodStudentsPage(byYear.collection, ctx, { ...primaryFilters, year: 2 }, opts);
    expect(byYear.stats.docsRead).toBe(2);

    const unassigned = fakeStudentsCollection(roster);
    const result = await fetchHodStudentsPage(unassigned.collection, ctx, { ...primaryFilters, unassignedOnly: true }, opts);
    expect(unassigned.stats.docsRead).toBe(1);
    expect(result.students.map((s) => s.id)).toEqual(["s2"]);

    // A department filter naming a department this HOD doesn't head reads nothing.
    const other = fakeStudentsCollection(roster);
    const none = await fetchHodStudentsPage(other.collection, ctx, { ...primaryFilters, departmentNames: ["ECE"] }, opts);
    expect(other.stats.docsRead).toBe(0);
    expect(none.total).toBe(0);
  });

  // A shared-first-year department holds one cohort per branch at once; the
  // Core Department filter picks one of them. Keyed on secondaryDepartment, so
  // a student with none recorded never matches a narrowed filter.
  it("narrows to one Core Department when asked", async () => {
    const shared = [
      stu("a", { department: "BS-Maths", secondaryDepartment: "CSE", year: 1, rollNumber: "A1", name: "Asha" }),
      stu("b", { department: "BS-Maths", secondaryDepartment: "CSBS", year: 1, rollNumber: "A2", name: "Bhanu" }),
      stu("c", { department: "BS-Maths", secondaryDepartment: "CSE", year: 1, rollNumber: "A3", name: "Chetan" }),
      stu("d", { department: "BS-Maths", year: 1, rollNumber: "A4", name: "Divya" }),
    ];
    const sharedCtx = hodContext({ own: ["BS-Maths"] });
    const { collection } = fakeStudentsCollection(shared);
    const page = await fetchHodStudentsPage(collection, sharedCtx, { ...primaryFilters, coreDepartment: "CSE" }, opts);
    expect(page.students.map((s) => s.id)).toEqual(["a", "c"]);
    expect(page.total).toBe(2);

    const all = fakeStudentsCollection(shared);
    const unfiltered = await fetchHodStudentsPage(all.collection, sharedCtx, primaryFilters, opts);
    expect(unfiltered.total).toBe(4);
  });

  it("never reads the cross-listed students for the editable roster", async () => {
    const { collection } = fakeStudentsCollection(roster);
    const page = await fetchHodStudentsPage(collection, ctx, primaryFilters, opts);
    expect(page.students.map((s) => s.id)).not.toContain("i1");
  });

  it("searches roll number and name, and pages", async () => {
    const { collection } = fakeStudentsCollection(roster);
    expect((await fetchHodStudentsPage(collection, ctx, primaryFilters, { ...opts, search: "r3" })).students.map((s) => s.id)).toEqual(["s3"]);
    expect((await fetchHodStudentsPage(collection, ctx, primaryFilters, { ...opts, search: "anu" })).students.map((s) => s.id)).toEqual(["s2"]);
    const page2 = await fetchHodStudentsPage(collection, ctx, primaryFilters, { ...opts, pageSize: 2, page: 2 });
    expect(page2.students.map((s) => s.id)).toEqual(["s3"]);
    expect(page2.totalPages).toBe(2);
  });

  it("ignores search for the unassigned count", async () => {
    const { collection } = fakeStudentsCollection(roster);
    const page = await fetchHodStudentsPage(collection, ctx, primaryFilters, { ...opts, search: "chitra" });
    expect(page.total).toBe(1);
    expect(page.unassignedTotal).toBe(1);
  });

  it("returns signed ids for every match, and later pages read only those documents", async () => {
    const first = fakeStudentsCollection(roster);
    const page = await fetchHodStudentsPage(first.collection, ctx, primaryFilters, { ...opts, pageSize: 2 });
    expect(page.orderedIds).toHaveLength(3);
    expect(page.orderedIds.map((t) => verifySignedStudentId(binding, t))).toEqual(["s2", "s1", "s3"]);

    const second = fakeStudentsCollection(roster);
    const rows = await fetchHodStudentsByIds(second.collection, page.orderedIds.slice(2), binding, "primary");
    expect(rows.map((s) => s.id)).toEqual(["s3"]);
    expect(second.stats.docsRead).toBe(1);
  });

  it("drops ids that were not issued to this user and view", async () => {
    const { collection, stats } = fakeStudentsCollection(roster);
    const mine = signStudentId(binding, "s1");
    const theirs = signStudentId("college|someone-else|primary|", "s3");
    const rows = await fetchHodStudentsByIds(collection, [mine, theirs, "e1.99999999999999.forged"], binding, "primary");
    expect(rows.map((s) => s.id)).toEqual(["s1"]);
    expect(stats.docsRead).toBe(1);
  });

  it("lists the incoming students held by one Freshman's Department, view-only", async () => {
    const { collection } = fakeStudentsCollection(roster);
    const page = await fetchHodStudentsPage(
      collection,
      ctx,
      { ...primaryFilters, level: "secondary", freshmanDept: "BS-Maths" },
      { ...opts, binding: "college|uid|secondary|BS-Maths" }
    );
    expect(page.students.map((s) => s.id)).toEqual(["i1"]);
    expect(page.students[0].accessLevel).toBe("secondary");
  });

  it("selects everything matching the filters, optionally within a roll-number range", async () => {
    const { collection } = fakeStudentsCollection(roster);
    const unassigned = await fetchHodStudentsMatching(collection, ctx, { ...primaryFilters, unassignedOnly: true }, { rollFrom: "", rollTo: "" });
    expect(unassigned.students.map((s) => s.id)).toEqual(["s2"]);
    const range = await fetchHodStudentsMatching(collection, ctx, primaryFilters, { rollFrom: "r3", rollTo: "r1" });
    expect(range.students.map((s) => s.id)).toEqual(["s2", "s1", "s3"]);
    const narrow = await fetchHodStudentsMatching(collection, ctx, primaryFilters, { rollFrom: "R2", rollTo: "R2" });
    expect(narrow.students.map((s) => s.id)).toEqual(["s1"]);
    expect(narrow.truncated).toBe(false);
  });

  it("reports the filter options without reading any student", async () => {
    const { collection, stats } = fakeStudentsCollection(roster);
    const meta = await fetchHodMeta(collection, hodContext({ own: ["CSE"], child: ["Cyber"], managed: ["IT"] }));
    // Own + sub-departments only: a managed branch ("IT") is another
    // department's name and is not offered as a filter option.
    expect(meta.departmentNames).toEqual(["CSE", "Cyber"]);
    expect(meta.freshmanDepartments).toEqual([]); // no shared first year configured
    expect(stats.docsRead).toBe(0);
  });

  it("recognises the on-demand request shapes, and nothing else", () => {
    expect(isHodOnDemandRequest(new URLSearchParams("page=1&pageSize=20"))).toBe(true);
    expect(isHodOnDemandRequest(new URLSearchParams("ids=a.1.b"))).toBe(true);
    expect(isHodOnDemandRequest(new URLSearchParams("selectAll=1&unassigned=1"))).toBe(true);
    expect(isHodOnDemandRequest(new URLSearchParams("hodMeta=1"))).toBe(true);
    // The existing callers (section rosters, sub-departments, ...) are untouched.
    expect(isHodOnDemandRequest(new URLSearchParams("section=A&year=2"))).toBe(false);
    expect(isHodOnDemandRequest(new URLSearchParams(""))).toBe(false);
  });
});
