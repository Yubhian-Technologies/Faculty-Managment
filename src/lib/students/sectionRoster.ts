import type { StudentRecord } from "@/types";

export interface SectionIdentity {
  department: string;
  sectionName: string;
  year?: number | null;
}

// The one canonical filter for "students belonging to this section" - used
// identically everywhere a section's roster or headcount is needed (Student
// Attendance's roster load, the Faculty/HOD/Principal Attendance Reports'
// section tiles and reports), so a displayed count can never drift from what
// the roster query actually returns. `identity` must come from the Section
// doc's own fields (never a denormalized copy on some other doc, e.g.
// TeachingAssignment.sectionName) - StudentRecord has no sectionId of its
// own (see types/core.ts), so department+section-name+year is the real,
// canonical match, same as api/college/students/route.ts already
// establishes for section rosters.
//
// Two queries, merged and deduped: a shared first-year student stays filed
// under their common department (until promotion) with `secondaryDepartment`
// naming this section's real branch instead (see StudentRecord's own doc
// comment) - matching on `department` alone would leave that student out of
// their own section's roster entirely.
export async function fetchSectionStudents(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): Promise<(StudentRecord & { id: string })[]> {
  let primaryQuery: FirebaseFirestore.Query = collegeRef.collection("students")
    .where("department", "==", identity.department)
    .where("section", "==", identity.sectionName);
  let secondaryQuery: FirebaseFirestore.Query = collegeRef.collection("students")
    .where("secondaryDepartment", "==", identity.department)
    .where("section", "==", identity.sectionName);
  if (identity.year != null) {
    primaryQuery = primaryQuery.where("year", "==", identity.year);
    secondaryQuery = secondaryQuery.where("year", "==", identity.year);
  }

  const [primarySnap, secondarySnap] = await Promise.all([primaryQuery.get(), secondaryQuery.get()]);
  const seen = new Set<string>();
  const students: (StudentRecord & { id: string })[] = [];
  for (const d of [...primarySnap.docs, ...secondarySnap.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    students.push({ id: d.id, ...d.data() } as StudentRecord & { id: string });
  }
  return students;
}

// Not a cheaper .count() aggregate anymore - the primary/secondary merge
// needs the actual doc ids to dedupe, so this just reuses fetchSectionStudents.
// Section rosters are small (tens of students), so the extra doc reads are
// not a meaningful cost, and it guarantees the count can never disagree with
// what actually loads.
export async function countSectionStudents(
  collegeRef: FirebaseFirestore.DocumentReference,
  identity: SectionIdentity,
): Promise<number> {
  const students = await fetchSectionStudents(collegeRef, identity);
  return students.length;
}
