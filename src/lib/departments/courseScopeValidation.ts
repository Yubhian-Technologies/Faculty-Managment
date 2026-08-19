// Shared by the two write paths that can set a department's academic
// structure - the flat fields (college/departments POST/PATCH) and the
// per-course override (college/departments PATCH's `courseScope`, and
// college/courses POST's inline `courseScope` at creation time). Kept in one
// place so a rule change (e.g. what counts as a valid secondary department)
// can't drift between the two.

import { ensureAcademicYear } from "@/lib/college/academicYears";

// Years a department/course teaches must be a subset of the years this
// college has actually opened (Principal's Academic Years toggle). Mirrors
// the same check done for Section creation in college/sections/route.ts.
// Still used for the flat (legacy, no-longer-UI-settable) Department.assignedYears
// field - see ensureAssignedYearsOpen below for the per-course path, which no
// longer rejects.
export async function validateAssignedYears(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  assignedYears: number[]
): Promise<string | null> {
  const academicYearsSnap = await db
    .collection("colleges")
    .doc(collegeId)
    .collection("academicYears")
    .get();
  const openYears = new Set(
    academicYearsSnap.docs
      .map((d) => d.data() as { yearNumber: number; isActive: boolean })
      .filter((y) => y.isActive)
      .map((y) => y.yearNumber)
  );
  const invalid = assignedYears.filter((y) => !openYears.has(Number(y)));
  return invalid.length > 0 ? `Year(s) ${invalid.join(", ")} are not open for this college` : null;
}

// Per-course Years Taught (college/courses POST, college/departments PATCH's
// `courseScope`) no longer requires the Principal to have pre-opened the
// college's Academic Years one at a time via a "+ Add Year" button before a
// longer course's later years become assignable - picking a year for a
// course now just opens it (idempotent - a year already open is untouched).
// The college-wide `academicYears` collection still exists and still gates
// the legacy flat `Department.assignedYears` field above and Section
// creation, so this keeps that collection correctly populated rather than
// bypassing it.
export async function ensureAssignedYearsOpen(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  assignedYears: number[]
): Promise<void> {
  for (const year of assignedYears) {
    await ensureAcademicYear(db, collegeId, Number(year));
  }
}

// A named secondary department must exist and never be the department
// itself. May be a top-level department (e.g. a shared first-year department
// feeding plain "Electronics and Communication Engineering") OR one of its
// sub-departments (e.g. feeding "ECE-VLSI" specifically, for students
// admitted straight into that specialization) - a sub-department's own HOD is
// always its parent's HOD (getHodDepartmentScope's childDepartmentNames
// rollup), so once such a student is actually promoted into a real
// ECE-VLSI-owned section, that HOD gets full (not just view-only) management
// of them, exactly as for any other sub-department section.
export function validateSecondaryDepartmentNames(
  names: string[],
  selfName: string,
  deptByName: Map<string, { parentDepartmentId?: string }>
): string | null {
  if (names.includes(selfName)) {
    return "Secondary department must be different from this department";
  }
  for (const secName of names) {
    if (!deptByName.has(secName)) return `Secondary department "${secName}" not found`;
  }
  return null;
}
