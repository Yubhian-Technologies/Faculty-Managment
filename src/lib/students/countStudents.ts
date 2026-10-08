// Student head-counts via Firestore `count()` aggregations instead of reading
// every student document just to take `.length` / `.size`.
//
// A student belongs to a department in TWO ways (see StudentRecord.
// secondaryDepartment's own doc-comment): `department` (where they're filed)
// and `secondaryDepartment` (the real branch of a shared-first-year student,
// who stays filed under the common department until promotion). Every caller
// below wants the UNION of the two - a student matched by both fields must
// count once - which used to be done by reading both result sets and
// de-duping by document id.
//
// A count aggregation has no ids to de-dupe with, but the union is exactly
// |A| + |B| - |A and B| (inclusion-exclusion), and each of the three terms is
// an equality-only query, so they're served by Firestore's automatic
// single-field indexes - no composite index to deploy, same as every other
// query on this collection (see lib/students/paginatedList.ts).
//
// A count aggregation is billed at one read per 1,000 index entries (minimum
// one) rather than one read per document.

type StudentsQuery = FirebaseFirestore.Query;

async function countOf(query: StudentsQuery): Promise<number> {
  const snap = await query.count().get();
  return snap.data().count;
}

/**
 * Number of distinct students for whom `matchPrimary` and/or `matchSecondary`
 * hold - the two queries must be the same filter set except for which field
 * (`department` / `secondaryDepartment`) carries the department name, and
 * `matchBoth` is that filter set with BOTH fields pinned to the department.
 */
async function countUnion(matchPrimary: StudentsQuery, matchSecondary: StudentsQuery, matchBoth: StudentsQuery): Promise<number> {
  const [primary, secondary, both] = await Promise.all([countOf(matchPrimary), countOf(matchSecondary), countOf(matchBoth)]);
  return primary + secondary - both;
}

/**
 * Students enrolled in `department` - filed under it, or pre-registered to it
 * as their real branch. Same set the faculty-requirement and teaching-
 * assignment ratio checks used to build by reading every matching document.
 */
export function countStudentsOfDepartment(
  studentsColl: FirebaseFirestore.CollectionReference,
  department: string
): Promise<number> {
  return countUnion(
    studentsColl.where("department", "==", department),
    studentsColl.where("secondaryDepartment", "==", department),
    studentsColl.where("department", "==", department).where("secondaryDepartment", "==", department)
  );
}

/**
 * Students in one section (department + section name, optionally narrowed to a
 * year and a course) - filed under the department, or pre-registered to it as
 * their real branch. Same filter set as `fetchSectionStudents` (sectionRoster.ts),
 * so the count can never disagree with the roster that loads.
 */
export function countStudentsInSection(
  studentsColl: FirebaseFirestore.CollectionReference,
  identity: { department: string; sectionName: string; year?: number | null; courseId?: string }
): Promise<number> {
  const narrow = (q: StudentsQuery): StudentsQuery => {
    let out = q.where("section", "==", identity.sectionName);
    if (identity.year != null) out = out.where("year", "==", identity.year);
    if (identity.courseId) out = out.where("courseId", "==", identity.courseId);
    return out;
  };
  // Graduated students keep their section/year but are not in the class: the same set
  // as fetchSectionStudents, i.e. everyone matched minus the matched alumni.
  const union = (extra: (q: StudentsQuery) => StudentsQuery) => countUnion(
    extra(narrow(studentsColl.where("department", "==", identity.department))),
    extra(narrow(studentsColl.where("secondaryDepartment", "==", identity.department))),
    extra(narrow(studentsColl.where("department", "==", identity.department).where("secondaryDepartment", "==", identity.department)))
  );
  return Promise.all([union((q) => q), union((q) => q.where("status", "==", "GRADUATED"))]).then(([all, alumni]) => all - alumni);
}
