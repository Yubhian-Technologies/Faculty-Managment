import type { StudentListItem, StudentRecord } from "@/types";

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
  /** Exact course name. "" means no filter. */
  course: string;
  /** null means no filter. */
  year: number | null;
  /** Exact studentType ("Regular"/"Lateral"). "" means no filter. */
  studentType: string;
}

type Doc = FirebaseFirestore.QueryDocumentSnapshot;

function matchesRemaining(
  data: FirebaseFirestore.DocumentData,
  opts: Pick<StudentListQuery, "search" | "course" | "year" | "studentType">
): boolean {
  if (opts.year !== null && Number(data.year) !== opts.year) return false;
  if (opts.course && data.course !== opts.course) return false;
  if (opts.studentType && data.studentType !== opts.studentType) return false;
  if (opts.search) {
    const name = String(data.name ?? "").toLowerCase();
    const roll = String(data.rollNumber ?? "").toLowerCase();
    const email = String(data.email ?? "").toLowerCase();
    if (!name.includes(opts.search) && !roll.includes(opts.search) && !email.includes(opts.search)) return false;
  }
  return true;
}

/** Dedupes by id (a shared-first-year student's department/secondaryDepartment
 *  queries can both match the same doc) and sorts by name - locale-aware, same
 *  comparator the client used to sort with before this moved server-side. */
function dedupeAndSortByName(docs: Doc[]): Doc[] {
  const seen = new Set<string>();
  const out: Doc[] = [];
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out.sort((a, b) => String(a.data().name ?? "").localeCompare(String(b.data().name ?? "")));
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
    const names = params.departments;
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
  const hasFilter = params.departments.length > 0 || params.year !== null || !!params.course || !!params.search || !!params.studentType;

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
  params: Pick<StudentListQuery, "departments" | "year" | "course" | "search" | "studentType">
): Promise<string[]> {
  const candidates = await resolveCandidates(studentsColl, params);
  return candidates.filter((d) => matchesRemaining(d.data(), params)).map((d) => d.id);
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
