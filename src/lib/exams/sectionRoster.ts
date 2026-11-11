import type { StudentRecord } from "@/types";

// A section's students for marks entry (internal marks, CEA), in Regd. No order. Section-scoped teaching
// assignments resolve to a real section (department + section + year); a shared-first-year student filed under
// their common department carries this section's branch as `secondaryDepartment` - matched separately and merged,
// or the roster would come up empty. Scoped by `courseId` too: a department can run a same-named section under
// more than one course.

export async function sectionRoster(
  collegeRef: FirebaseFirestore.DocumentReference,
  q: { department: string; sectionName: string; courseId: string; year?: number | null },
): Promise<StudentRecord[]> {
  let primary = collegeRef.collection("students").where("department", "==", q.department).where("section", "==", q.sectionName).where("courseId", "==", q.courseId);
  let secondary = collegeRef.collection("students").where("secondaryDepartment", "==", q.department).where("section", "==", q.sectionName).where("courseId", "==", q.courseId);
  if (q.year != null) {
    primary = primary.where("year", "==", q.year);
    secondary = secondary.where("year", "==", q.year);
  }
  const [a, b] = await Promise.all([primary.get(), secondary.get()]);
  const seen = new Set<string>();
  const students: StudentRecord[] = [];
  for (const d of [...a.docs, ...b.docs]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    students.push({ id: d.id, ...d.data() } as StudentRecord);
  }
  return students.sort((x, y) => x.rollNumber.localeCompare(y.rollNumber, undefined, { numeric: true }));
}
