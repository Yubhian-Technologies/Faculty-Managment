import type { StudentListItem, StudentRecord } from "@/types";
import { compareStudentsForList } from "@/lib/students/listOrder";
import { compareGraduates, graduateBatchLabel, graduateCourseLabel, graduateFacets } from "@/lib/students/graduates";

// Server-side pagination for the College Office / Principal-tier Students
// list (the roles that see the whole college unscoped - no HOD/PANEL_MEMBER
// fan-out to reconcile with LIMIT/OFFSET, see college/students/route.ts GET).
//
// Firestore can't do arbitrary substring search across several fields, and an
// OR across department/secondaryDepartment (the existing "shared-first-year
// student stays visible under either name" rule - see StudentRecord.
// secondaryDepartment's own doc-comment) can't be expressed as one query
// either. So exactly ONE structural filter (department, else year, else
// course - department preferred as usually the most selective) is pushed
// down to Firestore as a BARE equality `.where()` - deliberately with no
// `.orderBy()` alongside it, so every branch here is servable by the
// automatic single-field index Firestore already maintains for every field,
// and never needs a composite index to be deployed first (combining an
// equality filter with an orderBy on a *different* field is exactly what
// forces one - the mistake an earlier version of this file made, which
// surfaced as a 500 the moment a course/department/year filter was used).
// Everything else - the other structural filters, the free-text search
// Firestore can't do natively, and the name ordering itself - is applied
// in-route, in memory, over that already-narrowed candidate set. Only when
// NO structural filter or search is active at all - the common "just browse
// the roster" case - is this a true, un-narrowed LIMIT/OFFSET query straight
// against Firestore (a bare `.orderBy("name")` with no filter is likewise
// servable by the automatic single-field index, so that branch alone was
// never at risk of this).
//
// The response sent to the browser is always exactly one page, regardless of
// which path was taken - the client never downloads the full roster.

export interface StudentListQuery {
  page: number;
  pageSize: number;
  /** Trimmed, lower-cased. "" means no search. */
  search: string;
  /**
   * Exact department name(s); matches department OR secondaryDepartment.
   * [] means no filter. More than one name is how a "no own sections"
   * shared-first-year parent's filter rolls up to include its children too
   * (see expandDepartmentNameForRollup, academicStructure.ts) - the caller
   * expands a single picked name into this array before calling in, this
   * file stays agnostic to why there's more than one.
   */
  departments: string[];
  /**
   * Exact "core department" name - a student's `secondaryDepartment`, the real
   * branch a shared-first-year student belongs to while the feeder department
   * holds them. "" means no filter. Only ever meaningful alongside
   * `departments`: it narrows a feeder department's roll-up to one of the
   * branches it manages. Applied in memory, like the other non-structural
   * filters, over the candidate set `departments` already narrowed.
   */
  coreDepartment?: string;
  /** Exact course name. "" means no filter. */
  course: string;
  /** null means no filter. */
  year: number | null;
  /**
   * The years the picked department is actually configured to teach - what
   * "All years" means once a department is chosen, rather than "no filter at
   * all". A department filter matches department OR secondaryDepartment, so
   * picking a branch that teaches years 2-4 otherwise also returned the 1st
   * years a feeder department holds for it. [] / absent means no filter, which
   * is still what "All years" means with no department picked.
   */
  years?: number[];
  /** Exact studentType ("Regular"/"Lateral"). "" means no filter. */
  studentType: string;
  /**
   * Inclusive roll-number range, compared upper-cased as strings (the same rule
   * as the HOD page's range - hodPagedList.fetchHodStudentsMatching). Either end
   * may be left blank for an open-ended range; both given in the wrong order are
   * swapped. A student with no roll number never matches an active range.
   * Applied in memory over the candidate set like the other non-structural
   * filters: roll numbers are stored in mixed case ("24pa1a1222" next to
   * "24PA1A1241"), so a Firestore range query on `rollNumber` would miss rows.
   */
  rollFrom?: string;
  rollTo?: string;
}

type Doc = FirebaseFirestore.QueryDocumentSnapshot;

type RollRange = Pick<StudentListQuery, "rollFrom" | "rollTo">;

function hasRollRange(range: RollRange): boolean {
  return !!(range.rollFrom?.trim() || range.rollTo?.trim());
}

/** Whether `roll` lies inside the (possibly open-ended) inclusive range. */
export function rollInRange(roll: unknown, range: RollRange): boolean {
  let lo = (range.rollFrom ?? "").trim().toUpperCase();
  let hi = (range.rollTo ?? "").trim().toUpperCase();
  if (!lo && !hi) return true;
  const value = typeof roll === "string" ? roll.trim().toUpperCase() : "";
  if (!value) return false;
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
  if (lo && value < lo) return false;
  if (hi && value > hi) return false;
  return true;
}

function matchesRemaining(
  data: FirebaseFirestore.DocumentData,
  opts: Pick<StudentListQuery, "search" | "course" | "year" | "years" | "studentType" | "rollFrom" | "rollTo" | "coreDepartment">
): boolean {
  if (opts.year !== null && Number(data.year) !== opts.year) return false;
  if (opts.years && opts.years.length > 0 && !opts.years.includes(Number(data.year))) return false;
  if (opts.coreDepartment && data.secondaryDepartment !== opts.coreDepartment) return false;
  if (opts.course && data.course !== opts.course) return false;
  if (opts.studentType && data.studentType !== opts.studentType) return false;
  if (!rollInRange(data.rollNumber, opts)) return false;
  if (opts.search) {
    const name = String(data.name ?? "").toLowerCase();
    const roll = String(data.rollNumber ?? "").toLowerCase();
    const email = String(data.email ?? "").toLowerCase();
    if (!name.includes(opts.search) && !roll.includes(opts.search) && !email.includes(opts.search)) return false;
  }
  return true;
}

/** Dedupes by id (a shared-first-year student's department/secondaryDepartment
 *  queries can both match the same doc) and sorts in the standard student list
 *  order - roll number, with roll-less students after them by name (see
 *  lib/students/listOrder.ts). */
function dedupeAndSortByName(docs: Doc[]): Doc[] {
  const seen = new Set<string>();
  const out: Doc[] = [];
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out.sort((a, b) => {
    const da = a.data() as { rollNumber?: string; name?: string };
    const db = b.data() as { rollNumber?: string; name?: string };
    return compareStudentsForList({ id: a.id, rollNumber: da.rollNumber, name: da.name }, { id: b.id, rollNumber: db.rollNumber, name: db.name });
  });
}

async function resolveCandidates(
  studentsColl: FirebaseFirestore.CollectionReference,
  params: Pick<StudentListQuery, "departments" | "year" | "course">
): Promise<Doc[]> {
  if (params.departments.length > 0) {
    // "in" only when there's more than one name to match (the rollup case) -
    // a bare "==" for the common single-name case needs no composite index,
    // same reasoning as every other branch in this file (see top-of-file
    // comment).
    // Firestore's `in` takes at most 30 values - a rollup over a very wide
    // hierarchy is capped rather than thrown, like every other `in` here.
    const names = params.departments.slice(0, 30);
    const byDeptQuery = names.length > 1
      ? studentsColl.where("department", "in", names)
      : studentsColl.where("department", "==", names[0]);
    const bySecondaryQuery = names.length > 1
      ? studentsColl.where("secondaryDepartment", "in", names)
      : studentsColl.where("secondaryDepartment", "==", names[0]);
    const [byDept, bySecondary] = await Promise.all([byDeptQuery.get(), bySecondaryQuery.get()]);
    return dedupeAndSortByName([...byDept.docs, ...bySecondary.docs]);
  }
  if (params.year !== null) {
    return dedupeAndSortByName((await studentsColl.where("year", "==", params.year).get()).docs);
  }
  if (params.course) {
    return dedupeAndSortByName((await studentsColl.where("course", "==", params.course).get()).docs);
  }
  // Search-only, no structural filter - the one case Firestore genuinely
  // can't narrow server-side (no field to key an equality filter off).
  return dedupeAndSortByName((await studentsColl.get()).docs);
}

function toListItem(d: Doc): StudentListItem {
  return { id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" };
}

export async function fetchStudentsPage(
  studentsColl: FirebaseFirestore.CollectionReference,
  params: StudentListQuery
): Promise<{ students: StudentListItem[]; total: number }> {
  const hasFilter = params.departments.length > 0 || params.year !== null || !!params.course || !!params.search || !!params.studentType || !!params.coreDepartment || (params.years?.length ?? 0) > 0 || hasRollRange(params);

  if (!hasFilter) {
    const [countSnap, pageSnap] = await Promise.all([
      studentsColl.count().get(),
      studentsColl.orderBy("name").offset((params.page - 1) * params.pageSize).limit(params.pageSize).get(),
    ]);
    return { students: pageSnap.docs.map(toListItem), total: countSnap.data().count };
  }

  const candidates = await resolveCandidates(studentsColl, params);
  const filtered = candidates.filter((d) => matchesRemaining(d.data(), params));
  const start = (params.page - 1) * params.pageSize;
  return { students: filtered.slice(start, start + params.pageSize).map(toListItem), total: filtered.length };
}

/**
 * Every id matching the given filters, across every page - not just one. Used
 * only for the Students page's explicit "select all N matching" bulk-delete
 * action (never for the default listing), so choosing to select everything
 * that matches the current filters stays a deliberate, visible action rather
 * than something that happens implicitly.
 */
export async function fetchMatchingStudentIds(
  studentsColl: FirebaseFirestore.CollectionReference,
  params: Pick<StudentListQuery, "departments" | "year" | "years" | "course" | "search" | "studentType" | "rollFrom" | "rollTo" | "coreDepartment">
): Promise<string[]> {
  const candidates = await resolveCandidates(studentsColl, params);
  return candidates.filter((d) => matchesRemaining(d.data(), params)).map((d) => d.id);
}

// ── Graduated students ───────────────────────────────────────────────────
// The Graduated view used to download EVERY student in the college and keep
// only status === "GRADUATED" in the browser. `status` is now the one
// structural filter pushed down to Firestore (a bare equality, so the automatic
// single-field index serves it - same reasoning as the top-of-file comment), so
// only graduates are read, and the browser gets exactly one page.
//
// Course/batch/search are applied in memory over that candidate set: a
// graduate's course and batch are labelled with an "Unspecified" bucket when
// blank (lib/students/graduates.ts), which an equality filter can't express.
//
// The list request also returns `orderedIds` - every matching id, in display
// order, and nothing else about them. Paging then needs no further candidate
// read: the client asks for just the ids of the page it wants
// (fetchGraduatesByIds) and Firestore reads exactly that many documents.

export interface GraduatesQuery {
  page: number;
  pageSize: number;
  /** Trimmed, lower-cased. "" means no search. Matches name, roll number or department. */
  search: string;
  /** A course label as in graduateFacets(). "" means every course. */
  course: string;
  /** A batch label as in graduateFacets(). "" means every batch. */
  batch: string;
}

export interface GraduatesPage {
  students: StudentListItem[];
  /** Graduates matching the filters. */
  total: number;
  /** Every graduate, ignoring the filters - the "N graduated total" figure. */
  overallTotal: number;
  /** Every matching id in display order, so later pages can be fetched by id. */
  orderedIds: string[];
  /** Drop-down options over every graduate, so they don't shrink as filters narrow. */
  facets: { courses: string[]; batches: string[] };
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchGraduatesPage(
  studentsColl: FirebaseFirestore.CollectionReference,
  params: GraduatesQuery
): Promise<GraduatesPage> {
  const snap = await studentsColl.where("status", "==", "GRADUATED").get();
  const all = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<StudentRecord, "id">), accessLevel: "primary" as const }))
    .sort(compareGraduates) as StudentListItem[];

  const filtered = all.filter((s) => {
    if (params.course && graduateCourseLabel(s) !== params.course) return false;
    if (params.batch && graduateBatchLabel(s) !== params.batch) return false;
    if (params.search) {
      const name = String(s.name ?? "").toLowerCase();
      const roll = String(s.rollNumber ?? "").toLowerCase();
      const dept = String(s.department ?? "").toLowerCase();
      if (!name.includes(params.search) && !roll.includes(params.search) && !dept.includes(params.search)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / params.pageSize));
  const page = Math.min(Math.max(1, params.page), totalPages);
  const start = (page - 1) * params.pageSize;
  return {
    students: filtered.slice(start, start + params.pageSize),
    total: filtered.length,
    overallTotal: all.length,
    orderedIds: filtered.map((s) => s.id),
    facets: graduateFacets(all),
    page,
    pageSize: params.pageSize,
    totalPages,
  };
}

/**
 * The graduates among `ids`, in the order asked - one document read per id.
 * An id that no longer exists, or whose student isn't (any longer) graduated,
 * is simply left out.
 */
export async function fetchGraduatesByIds(
  studentsColl: FirebaseFirestore.CollectionReference,
  ids: string[]
): Promise<StudentListItem[]> {
  if (ids.length === 0) return [];
  const snaps = await studentsColl.firestore.getAll(...ids.map((id) => studentsColl.doc(id)));
  const out: StudentListItem[] = [];
  for (const d of snaps) {
    if (!d.exists) continue;
    const data = d.data() as Omit<StudentRecord, "id">;
    if (data.status !== "GRADUATED") continue;
    out.push({ id: d.id, ...data, accessLevel: "primary" });
  }
  return out;
}

// ── CSV export ───────────────────────────────────────────────────────────
// Unlike the paginated listing above, export deliberately accepts MULTIPLE
// departments/courses/years at once (e.g. "every 1st and 2nd year B.Tech
// student across these 3 departments") - a combination the single-value
// pagination filters were never meant to express. An empty array for any of
// the three means "no filter on that dimension", not "match nothing".

export interface StudentExportQuery {
  /** Trimmed, lower-cased. "" means no search. */
  search: string;
  /** Exact department names; matches department OR secondaryDepartment. [] means every department. */
  departments: string[];
  /** Exact course names. [] means every course. */
  courses: string[];
  /** [] means every year. */
  years: number[];
}

// A row cap protects against an unbounded read/response for a college with an
// unusually large roster and no filters at all - well beyond any real
// college's headcount, so it should never actually bind in practice.
const EXPORT_ROW_CAP = 5000;

function matchesExportFilters(
  data: FirebaseFirestore.DocumentData,
  opts: Pick<StudentExportQuery, "search" | "courses" | "years">
): boolean {
  if (opts.years.length > 0 && !opts.years.includes(Number(data.year))) return false;
  if (opts.courses.length > 0 && !opts.courses.includes(String(data.course ?? ""))) return false;
  if (opts.search) {
    const name = String(data.name ?? "").toLowerCase();
    const roll = String(data.rollNumber ?? "").toLowerCase();
    const email = String(data.email ?? "").toLowerCase();
    if (!name.includes(opts.search) && !roll.includes(opts.search) && !email.includes(opts.search)) return false;
  }
  return true;
}

export async function fetchStudentsForExport(
  studentsColl: FirebaseFirestore.CollectionReference,
  params: StudentExportQuery
): Promise<{ students: StudentListItem[]; total: number; truncated: boolean }> {
  let candidates: Doc[];
  if (params.departments.length > 0) {
    // Firestore's `in` clause caps at 30 values - realistically a handful to
    // a couple dozen departments get picked at once, same cap already used
    // elsewhere in this app for department-name `in` queries.
    const names = params.departments.slice(0, 30);
    const [byDept, bySecondary] = await Promise.all([
      studentsColl.where("department", "in", names).get(),
      studentsColl.where("secondaryDepartment", "in", names).get(),
    ]);
    candidates = dedupeAndSortByName([...byDept.docs, ...bySecondary.docs]);
  } else {
    candidates = dedupeAndSortByName((await studentsColl.get()).docs);
  }

  const filtered = candidates.filter((d) => matchesExportFilters(d.data(), params));
  const truncated = filtered.length > EXPORT_ROW_CAP;
  const limited = truncated ? filtered.slice(0, EXPORT_ROW_CAP) : filtered;
  return { students: limited.map(toListItem), total: filtered.length, truncated };
}
