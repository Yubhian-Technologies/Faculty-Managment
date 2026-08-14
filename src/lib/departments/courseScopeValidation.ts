// Shared by the two write paths that can set a department's academic
// structure - the flat fields (college/departments POST/PATCH) and the
// per-course override (college/departments PATCH's `courseScope`, and
// college/courses POST's inline `courseScope` at creation time). Kept in one
// place so a rule change (e.g. what counts as a valid secondary department)
// can't drift between the two.

// Years a department/course teaches must be a subset of the years this
// college has actually opened (Principal's Academic Years toggle). Mirrors
// the same check done for Section creation in college/sections/route.ts.
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

// A named secondary department must exist, be a top-level department (never
// a sub-department), and never be the department itself.
export function validateSecondaryDepartmentNames(
  names: string[],
  selfName: string,
  deptByName: Map<string, { parentDepartmentId?: string }>
): string | null {
  if (names.includes(selfName)) {
    return "Secondary department must be different from this department";
  }
  for (const secName of names) {
    const secDept = deptByName.get(secName);
    if (!secDept) return `Secondary department "${secName}" not found`;
    if (secDept.parentDepartmentId) return `"${secName}" is a sub-department and can't be used as a secondary department`;
  }
  return null;
}
