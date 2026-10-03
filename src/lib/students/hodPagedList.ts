import type { Course, StudentRecord } from "@/types";
import { getHodDepartmentScope, type HodDepartmentScope } from "@/lib/departments/scope";
import { resolveBranchYearOwner, type DepartmentYearRow } from "@/lib/departments/managedBranches";
import {
  resolveCatalogId,
  expandDepartmentNameForRollup,
  freshmanLandingDepartmentNames,
  type DepartmentWithId,
} from "@/lib/college/academicStructure";
import { sortStudentsForList } from "@/lib/students/listOrder";
import { signStudentId, verifySignedStudentId } from "@/lib/students/signedIds";
import { projectStudentsForRole } from "@/lib/students/listProjection";

// Paged / on-demand reads of the HOD Students page - the opt-in shapes of
// college/students GET for role HOD (`page`, `ids`, `selectAll`, `hodMeta`).
// A plain request (no such param) still returns the HOD's whole scoped
// `{ students }` list from the route's own inline logic, which every other
// HOD caller (sub-departments, section rosters, ...) relies on and which this
// file deliberately leaves alone.
//
// WHO IS "MINE" - classifyHodStudent below is that route logic, applied one
// document at a time. Keep the two in step (route.ts's HOD branch: the
// primary loop, then the sub-department/managed-branch loop, then the
// secondary loop).
//
// WHAT IS PUSHED TO FIRESTORE - the Department/Course/Year filters, "unassigned"
// (section == ""), and the Freshman's Department are plain equality / `in`
// filters, so they narrow the read itself instead of being applied after
// everything was downloaded. Year ownership of a managed branch
// (resolveBranchYearOwner) and the roll-number ordering can't be expressed as a
// query, so those still run over the (now narrowed) candidates in memory.
//
// WHAT THE BROWSER GETS - one page of rows, plus every matching id (each one
// signed - see signedIds.ts) so later pages are fetched by id: the server reads
// exactly that page's documents and never has to re-run the scoping.

export const HOD_PAGE_SIZES = [10, 20, 30, 50];
// A bulk selection ("select all unassigned", a roll-number range) is sent whole
// to the client so it can be acted on; capped well beyond any real department.
const SELECT_ALL_CAP = 2000;

export type HodAccess = "primary" | "secondary";
export type HodStudent = Omit<StudentRecord, "id"> & { id: string; accessLevel: HodAccess };

export interface HodStudentsContext {
  scope: HodDepartmentScope;
  departments: DepartmentYearRow[];
  courses: Course[];
  deptIdByName: Map<string, string>;
  /** Sub-departments + managed branches, capped to what one `in` query takes. */
  ownedDeptNames: string[];
  /** Names a cross-listed (secondaryDepartment) student can carry to be this HOD's. */
  secondaryTargets: string[];
}

export async function loadHodStudentsContext(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  uid: string
): Promise<HodStudentsContext> {
  const scope = await getHodDepartmentScope(db, collegeId, uid);
  const collegeRef = db.collection("colleges").doc(collegeId);
  let departments: DepartmentYearRow[] = [];
  let courses: Course[] = [];
  if (scope.ownDepartmentNames.length > 0) {
    const [deptsSnap, coursesSnap] = await Promise.all([
      collegeRef.collection("departments").get(),
      collegeRef.collection("courses").get(),
    ]);
    departments = deptsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as DepartmentYearRow[];
    if (departments.length > 0) {
      courses = coursesSnap.docs.map((c) => ({ id: c.id, ...(c.data() as object) })) as Course[];
    }
  }
  const deptIdByName = new Map<string, string>();
  for (const d of departments) if (d.name) deptIdByName.set(d.name, d.id);
  return {
    scope,
    departments,
    courses,
    deptIdByName,
    ownedDeptNames: [...scope.childDepartmentNames, ...scope.managedDepartmentNames].slice(0, 30),
    secondaryTargets: Array.from(new Set([...scope.ownDepartmentNames, ...scope.childDepartmentNames])).slice(0, 30),
  };
}

/**
 * "primary" - this HOD's own to manage; "secondary" - only cross-listed to them
 * (view-only); null - not theirs. Same decision, in the same order, as the
 * route's inline HOD loops: own department (year-checked against whoever
 * manages the branch), else sub-department / managed branch (a managed
 * branch's year is checked too), else a secondaryDepartment match.
 */
export function classifyHodStudent(data: Omit<StudentRecord, "id">, ctx: HodStudentsContext): HodAccess | null {
  const { scope, departments } = ctx;
  const dept = data.department as string;
  const catalogId = () => resolveCatalogId(ctx.courses, ctx.deptIdByName.get(dept), data.course);

  if (scope.ownDepartmentNames.includes(dept)) {
    if (departments.length === 0) return "primary";
    const owner = resolveBranchYearOwner(departments, dept, data.year as number, catalogId());
    if (scope.ownDepartmentNames.includes(owner)) return "primary";
  }
  if (ctx.ownedDeptNames.includes(dept)) {
    if (!scope.managedDepartmentNames.includes(dept) || departments.length === 0) return "primary";
    const owner = resolveBranchYearOwner(departments, dept, data.year as number, catalogId());
    if (scope.ownDepartmentNames.includes(owner) || scope.childDepartmentNames.includes(owner)) return "primary";
  }
  if (scope.ownDepartmentNames.length > 0 && ctx.secondaryTargets.includes(data.secondaryDepartment as string)) return "secondary";
  return null;
}

export interface HodListFilters {
  /** "primary": the editable roster. "secondary": the read-only incoming list for `freshmanDept`. */
  level: HodAccess;
  /** Level "secondary" only: the Freshman's Department currently holding the students. */
  freshmanDept: string;
  /** Names a Department filter matches (rollup-expanded). null = no Department filter. */
  departmentNames: string[] | null;
  /** "" = no Course filter. */
  course: string;
  /** null = no Year filter. */
  year: number | null;
  /** Only students not yet in a section. */
  unassignedOnly: boolean;
}

async function loadCandidates(
  studentsColl: FirebaseFirestore.CollectionReference,
  ctx: HodStudentsContext,
  f: HodListFilters
): Promise<HodStudent[]> {
  const narrow = (q: FirebaseFirestore.Query): FirebaseFirestore.Query => {
    let out = q;
    if (f.year !== null) out = out.where("year", "==", f.year);
    if (f.course) out = out.where("course", "==", f.course);
    if (f.unassignedOnly) out = out.where("section", "==", "");
    return out;
  };
  const withinDeptFilter = (names: string[]) => (f.departmentNames ? names.filter((n) => f.departmentNames!.includes(n)) : names);

  const queries: FirebaseFirestore.Query[] = [];
  if (f.level === "primary") {
    const own = withinDeptFilter(ctx.scope.ownDepartmentNames);
    if (own.length > 0) queries.push(narrow(studentsColl.where("department", "in", own)));
    const owned = withinDeptFilter(ctx.ownedDeptNames);
    if (owned.length > 0) queries.push(narrow(studentsColl.where("department", "in", owned)));
  } else if (ctx.scope.ownDepartmentNames.length > 0 && ctx.secondaryTargets.length > 0 && f.freshmanDept) {
    queries.push(narrow(studentsColl.where("secondaryDepartment", "in", ctx.secondaryTargets).where("department", "==", f.freshmanDept)));
  }

  const seen = new Set<string>();
  const out: HodStudent[] = [];
  for (const snap of await Promise.all(queries.map((q) => q.get()))) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as Omit<StudentRecord, "id">;
      if (classifyHodStudent(data, ctx) !== f.level) continue;
      out.push({ id: d.id, ...data, accessLevel: f.level });
    }
  }
  return sortStudentsForList(out);
}

function matchesSearch(s: HodStudent, search: string): boolean {
  if (!search) return true;
  return String(s.rollNumber ?? "").toLowerCase().includes(search) || String(s.name ?? "").toLowerCase().includes(search);
}

export interface HodPage {
  students: HodStudent[];
  total: number;
  /** Unassigned students among those matching the filters (ignoring search). */
  unassignedTotal: number;
  /** Every matching student, as signed ids in display order, so later pages can be fetched by id. */
  orderedIds: string[];
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchHodStudentsPage(
  studentsColl: FirebaseFirestore.CollectionReference,
  ctx: HodStudentsContext,
  f: HodListFilters,
  opts: { page: number; pageSize: number; search: string; binding: string }
): Promise<HodPage> {
  const candidates = await loadCandidates(studentsColl, ctx, f);
  const unassignedTotal = candidates.filter((s) => !s.section).length;
  const matching = candidates.filter((s) => matchesSearch(s, opts.search));
  const totalPages = Math.max(1, Math.ceil(matching.length / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), totalPages);
  const start = (page - 1) * opts.pageSize;
  return {
    students: matching.slice(start, start + opts.pageSize),
    total: matching.length,
    unassignedTotal,
    orderedIds: matching.map((s) => signStudentId(opts.binding, s.id)),
    page,
    pageSize: opts.pageSize,
    totalPages,
  };
}

/**
 * Every student matching the filters (and, optionally, whose roll number lies
 * between `rollFrom` and `rollTo`, inclusive, compared upper-cased as strings)
 * - what a bulk selection acts on. Never includes search: "select all N
 * unassigned" and "select by roll range" are about the filtered view, not the
 * text in the search box.
 */
export async function fetchHodStudentsMatching(
  studentsColl: FirebaseFirestore.CollectionReference,
  ctx: HodStudentsContext,
  f: HodListFilters,
  range: { rollFrom: string; rollTo: string }
): Promise<{ students: HodStudent[]; truncated: boolean }> {
  let rows = await loadCandidates(studentsColl, ctx, f);
  if (range.rollFrom && range.rollTo) {
    const from = range.rollFrom.trim().toUpperCase();
    const to = range.rollTo.trim().toUpperCase();
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    rows = rows.filter((s) => {
      const roll = (s.rollNumber ?? "").toUpperCase();
      return roll >= lo && roll <= hi;
    });
  }
  const truncated = rows.length > SELECT_ALL_CAP;
  return { students: truncated ? rows.slice(0, SELECT_ALL_CAP) : rows, truncated };
}

/**
 * The students behind the signed ids a list request returned - one document
 * read each. A token that isn't genuine, is expired, or was issued to someone
 * else / for another view is dropped without touching Firestore.
 */
export async function fetchHodStudentsByIds(
  studentsColl: FirebaseFirestore.CollectionReference,
  tokens: string[],
  binding: string,
  level: HodAccess
): Promise<HodStudent[]> {
  const ids = Array.from(new Set(tokens.map((t) => verifySignedStudentId(binding, t)).filter((id): id is string => !!id)));
  if (ids.length === 0) return [];
  const snaps = await studentsColl.firestore.getAll(...ids.map((id) => studentsColl.doc(id)));
  const out: HodStudent[] = [];
  for (const d of snaps) {
    if (!d.exists) continue;
    out.push({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: level });
  }
  return out;
}

/**
 * What the page needs before anything is loaded, without reading the roster:
 * the departments this HOD's students can be filed under (for the Department
 * filter), and which Freshman's Departments currently hold students
 * pre-registered to them (count() aggregations - one cheap read each - rather
 * than reading the cross-listed students to find out).
 */
export async function fetchHodMeta(
  studentsColl: FirebaseFirestore.CollectionReference,
  ctx: HodStudentsContext
): Promise<{ departmentNames: string[]; freshmanDepartments: string[] }> {
  const departmentNames = Array.from(
    new Set([...ctx.scope.ownDepartmentNames, ...ctx.scope.childDepartmentNames, ...ctx.scope.managedDepartmentNames])
  ).sort();

  let freshmanDepartments: string[] = [];
  if (ctx.scope.ownDepartmentNames.length > 0 && ctx.secondaryTargets.length > 0) {
    const candidates = Array.from(freshmanLandingDepartmentNames(ctx.departments as DepartmentWithId[])).slice(0, 30);
    const counts = await Promise.all(
      candidates.map(async (name) => {
        const snap = await studentsColl
          .where("secondaryDepartment", "in", ctx.secondaryTargets)
          .where("department", "==", name)
          .count()
          .get();
        return snap.data().count;
      })
    );
    freshmanDepartments = candidates.filter((_, i) => counts[i] > 0).sort();
  }
  return { departmentNames, freshmanDepartments };
}

// ── Request handling ────────────────────────────────────────────────────────

export interface HodRequestResult {
  status: number;
  body: unknown;
}

/** Whether a GET from an HOD asks for one of the on-demand shapes above. */
export function isHodOnDemandRequest(params: URLSearchParams): boolean {
  return params.has("page") || params.has("ids") || params.get("selectAll") === "1" || params.get("hodMeta") === "1";
}

export async function handleHodStudentsRequest(
  db: FirebaseFirestore.Firestore,
  session: { collegeId: string; uid: string },
  params: URLSearchParams
): Promise<HodRequestResult> {
  const studentsColl = db.collection("colleges").doc(session.collegeId).collection("students");
  const incoming = (params.get("incoming") ?? "").trim();
  const level: HodAccess = incoming ? "secondary" : "primary";
  const binding = `${session.collegeId}|${session.uid}|${level}|${incoming}`;

  // Later pages: just the documents behind this page's signed ids - no scoping
  // to redo, no department/course lists to load.
  if (params.has("ids")) {
    const tokens = (params.get("ids") ?? "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 50);
    const rows = await fetchHodStudentsByIds(studentsColl, tokens, binding, level);
    return { status: 200, body: { students: projectStudentsForRole("HOD", rows) } };
  }

  const ctx = await loadHodStudentsContext(db, session.collegeId, session.uid);

  if (params.get("hodMeta") === "1") {
    return { status: 200, body: await fetchHodMeta(studentsColl, ctx) };
  }

  const department = (params.get("department") ?? "").trim();
  const yearParam = params.get("year");
  const filters: HodListFilters = {
    level,
    freshmanDept: incoming,
    departmentNames: department ? expandDepartmentNameForRollup(ctx.departments as DepartmentWithId[], department) : null,
    course: (params.get("course") ?? "").trim(),
    year: yearParam && Number.isFinite(Number(yearParam)) ? Number(yearParam) : null,
    unassignedOnly: params.get("unassigned") === "1",
  };

  if (params.get("selectAll") === "1") {
    const result = await fetchHodStudentsMatching(studentsColl, ctx, filters, {
      rollFrom: (params.get("rollFrom") ?? "").trim(),
      rollTo: (params.get("rollTo") ?? "").trim(),
    });
    return { status: 200, body: { ...result, students: projectStudentsForRole("HOD", result.students) } };
  }

  const pageSizeRaw = Number(params.get("pageSize"));
  const result = await fetchHodStudentsPage(studentsColl, ctx, filters, {
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: HOD_PAGE_SIZES.includes(pageSizeRaw) ? pageSizeRaw : 20,
    search: (params.get("search") ?? "").trim().toLowerCase(),
    binding,
  });
  return { status: 200, body: { ...result, students: projectStudentsForRole("HOD", result.students) } };
}
