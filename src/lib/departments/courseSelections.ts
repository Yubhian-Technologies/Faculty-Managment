import { ensureAssignedYearsOpen } from "@/lib/departments/courseScopeValidation";

export interface DepartmentCourseSelection {
  catalogId: string;
  assignedYears: number[];
}

export interface ResolvedDepartmentCourse {
  catalogId: string;
  name: string;
  code: string;
  durationYears: number;
  assignedYears: number[];
}

// A new department must start with at least one catalog course, each with its
// own Years Taught - same rules college/courses POST applies one course at a
// time, validated up front here so a bad selection never leaves a half-created
// department behind.
export async function resolveDepartmentCourseSelections(
  db: FirebaseFirestore.Firestore,
  collegeId: string,
  selections: DepartmentCourseSelection[] | undefined
): Promise<{ error: string } | { courses: ResolvedDepartmentCourse[] }> {
  if (!Array.isArray(selections) || selections.length === 0) {
    return { error: "Select at least one course for this department" };
  }

  const catalogCol = db.collection("colleges").doc(collegeId).collection("courseCatalog");
  const seen = new Set<string>();
  const courses: ResolvedDepartmentCourse[] = [];

  for (const sel of selections) {
    if (!sel?.catalogId) return { error: "Each selected course needs a catalogId" };
    if (seen.has(sel.catalogId)) return { error: "The same course was selected more than once" };
    seen.add(sel.catalogId);

    const snap = await catalogCol.doc(sel.catalogId).get();
    if (!snap.exists) return { error: "A selected course is not in the course list" };
    const catalog = snap.data() as { name: string; code: string; durationYears: number; isActive?: boolean };
    if (catalog.isActive === false) return { error: `"${catalog.name}" is inactive` };

    const years = Array.from(new Set((sel.assignedYears ?? []).map(Number).filter((y) => Number.isFinite(y)))).sort((a, b) => a - b);
    if (years.length === 0) {
      return { error: `Select at least one year this department teaches ${catalog.name}` };
    }
    const outOfRange = years.filter((y) => y < 1 || y > catalog.durationYears);
    if (outOfRange.length > 0) {
      return { error: `Year(s) ${outOfRange.join(", ")} are outside ${catalog.name}'s ${catalog.durationYears}-year duration` };
    }

    courses.push({
      catalogId: sel.catalogId,
      name: catalog.name,
      code: catalog.code,
      durationYears: Number(catalog.durationYears),
      assignedYears: years,
    });
  }

  await ensureAssignedYearsOpen(db, collegeId, Array.from(new Set(courses.flatMap((c) => c.assignedYears))));
  return { courses };
}
