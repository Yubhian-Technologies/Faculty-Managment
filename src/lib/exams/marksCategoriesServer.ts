import type { InternalExamMarksBatch, TeachingAssignment } from "@/types";

export const MARKS_CATEGORY_ROLES = ["EXAM_CELL", "SUPER_ADMIN"];

/**
 * For each subject: who has entered marks for it in a CURRENT teaching
 * assignment ("Dr A (CSE-A)"). A subject with any can't change breakdown -
 * entered marks would be read against different components. Past years' batches
 * don't count.
 */
export async function marksEnteredFor(db: FirebaseFirestore.Firestore, collegeId: string, subjectIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const college = db.collection("colleges").doc(collegeId);
  const ids = [...new Set(subjectIds)];
  for (let i = 0; i < ids.length; i += 30) {
    const batches = (await college.collection("internalExamMarks").where("subjectId", "in", ids.slice(i, i + 30)).get()).docs
      .map((d) => d.data() as InternalExamMarksBatch).filter((b) => (b.enteredCount ?? 0) > 0);
    if (batches.length === 0) continue;
    const tas = await db.getAll(...batches.map((b) => college.collection("teachingAssignments").doc(b.assignmentId)));
    batches.forEach((b, k) => {
      if (!tas[k].exists || (tas[k].data() as TeachingAssignment).isPast) return;
      out.set(b.subjectId, [...new Set([...(out.get(b.subjectId) ?? []), `${b.facultyName} (${b.sectionName})`])]);
    });
  }
  return out;
}
