import type { StudentRecord } from "@/types";

// Finds the Section doc a student is currently sitting in. Originally a
// FALLBACK inside api/college/students/[id]/route.ts for a legacy student
// with no `courseId` yet (the migration that backfills it couldn't resolve
// them confidently - see scripts/backfill-student-course-id.mjs); extracted
// here, unchanged, so api/college/student/me/route.ts (a student's own
// self-view, which has no courseId shortcut to take) can resolve their
// section the same way. A shared-first-year student is filed under their
// common department (department, preserved until promotion) with
// secondaryDepartment naming their real branch instead - the section they're
// actually in is filed under THAT branch, not their own department (see
// students/[id] PATCH's write, and sections/new's managed-branch mode). Try
// the student's own department first (covers the plain and legacy-cross-
// listed cases, where it's already correct), then their secondaryDepartment.
//
// Deliberately does NOT `.limit(1)` and silently pick a winner when a
// department+name+year search matches more than one Section (two different
// courses each running a same-named section - see StudentRecord.courseId's
// doc-comment) - that used to be exactly how a student could silently
// resolve against the wrong course. Returns null (a real "current section"
// can't be determined) instead, so callers fail closed rather than guess.
export async function findCurrentSectionDoc(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  student: Pick<StudentRecord, "department" | "secondaryDepartment" | "section" | "year">
): Promise<FirebaseFirestore.QueryDocumentSnapshot | null> {
  const sectionsColl = db.collection("colleges").doc(collegeId).collection("sections");
  const byOwnDept = await sectionsColl
    .where("department", "==", student.department)
    .where("name", "==", student.section)
    .where("year", "==", student.year)
    .get();
  if (byOwnDept.size === 1) return byOwnDept.docs[0];
  if (byOwnDept.size > 1) return null;
  if (!student.secondaryDepartment) return null;
  const bySecondaryDept = await sectionsColl
    .where("department", "==", student.secondaryDepartment)
    .where("name", "==", student.section)
    .where("year", "==", student.year)
    .get();
  return bySecondaryDept.size === 1 ? bySecondaryDept.docs[0] : null;
}
