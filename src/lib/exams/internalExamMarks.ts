import type { ExamConfiguration, InternalExamMarkEntry, InternalExamMarksBatch, TeachingAssignment } from "@/types";

// == `${courseId}_year${year}` — one ExamConfiguration per course+year
// (branch is implied by courseId, since a Course doc is department-specific).
export function examConfigId(courseId: string, year: number): string {
  return `${courseId}_year${year}`;
}

export function activeComponentIds(config: ExamConfiguration): string[] {
  return config.components.filter((c) => c.isActive).map((c) => c.id);
}

// A student's entry only counts as "entered" once every currently-active
// component has a value — matches the "X out of Y students" completion
// count shown on the Faculty Dashboard.
export function isEntryComplete(entry: InternalExamMarkEntry, activeIds: string[]): boolean {
  if (activeIds.length === 0) return false;
  return activeIds.every((id) => entry.componentMarks[id] != null);
}

export function countEntered(entries: InternalExamMarkEntry[], config: ExamConfiguration): number {
  const ids = activeComponentIds(config);
  return entries.filter((e) => isEntryComplete(e, ids)).length;
}

// Resolves (courseId, year) for a batch and returns its Exam Cell config,
// self-healing for batches saved before InternalExamMarksBatch carried its
// own courseId/courseName (falls back to the linked teachingAssignments doc,
// same as it was always resolved before this field existed). Returns null if
// no course/year can be resolved (e.g. a semester-scoped assignment) or no
// config exists yet for that course+year.
export async function resolveExamConfigForBatch(
  db: FirebaseFirestore.Firestore,
  collegeRef: FirebaseFirestore.DocumentReference,
  batch: Pick<InternalExamMarksBatch, "courseId" | "year" | "assignmentId">
): Promise<{ config: ExamConfiguration; courseId: string; courseName: string } | null> {
  let courseId = batch.courseId;
  let year = batch.year;
  let courseName: string | undefined;

  if (!courseId || year == null) {
    const assignmentSnap = await collegeRef.collection("teachingAssignments").doc(batch.assignmentId).get();
    if (!assignmentSnap.exists) return null;
    const assignment = assignmentSnap.data() as TeachingAssignment;
    courseId = assignment.courseId;
    year = assignment.year;
    courseName = assignment.courseName;
  }
  if (!courseId || year == null) return null;

  const configSnap = await collegeRef.collection("examConfigurations").doc(examConfigId(courseId, year)).get();
  if (!configSnap.exists) return null;
  const config = { id: configSnap.id, ...configSnap.data() } as ExamConfiguration;
  return { config, courseId, courseName: courseName ?? config.courseName };
}
