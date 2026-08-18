import type { StudentRecord } from "@/types";

export interface SectionIdentity {
  department: string;
  sectionName: string;
  year?: number | null;
}

// The one canonical filter for "students belonging to this section" - used
// identically everywhere a section's roster or headcount is needed (Student
// Attendance's roster load, the Faculty Attendance Report's section tiles),
// so a displayed count can never drift from what the roster query actually
// returns. `identity` must come from the Section doc's own fields (never a
// denormalized copy on some other doc, e.g. TeachingAssignment.sectionName) -
// StudentRecord has no sectionId of its own (see types/core.ts), so
// department+section-name+year is the real, canonical match, same as
// api/college/students/route.ts already establishes for section rosters.
export function sectionStudentsQuery(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): FirebaseFirestore.Query {
  let q: FirebaseFirestore.Query = collegeRef.collection("students")
    .where("department", "==", identity.department)
    .where("section", "==", identity.sectionName);
  if (identity.year != null) q = q.where("year", "==", identity.year);
  return q;
}

export async function fetchSectionStudents(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): Promise<(StudentRecord & { id: string })[]> {
  const snap = await sectionStudentsQuery(collegeRef, identity).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StudentRecord & { id: string });
}

// Aggregate .count() instead of fetching every doc - the tile only needs a
// number, and this is the same query fetchSectionStudents/the roster load
// use, so the count a Faculty sees on a section tile is guaranteed to equal
// how many students actually load when they open it.
export async function countSectionStudents(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): Promise<number> {
  const snap = await sectionStudentsQuery(collegeRef, identity).count().get();
  return snap.data().count;
}
