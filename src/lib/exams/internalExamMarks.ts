import type { ExamConfiguration, ExamType, InternalExamMarkEntry, InternalExamMarksBatch, Subject, TeachingAssignment } from "@/types";

// == `${courseId}_year${year}_${examType}` — one ExamConfiguration per
// course+year+examType (branch is implied by courseId, since a Course doc is
// department-specific). Theory and Lab are always two separate documents -
// never merged - so this always takes examType explicitly rather than
// defaulting it.
export function examConfigId(courseId: string, year: number, examType: ExamType): string {
  return `${courseId}_year${year}_${examType}`;
}

// Maps a Subject's own SubjectType to the Theory/Lab split Exam Cell
// configures separately (see ExamConfiguration.examType) - PRACTICAL is the
// only SubjectType that means "Lab" here; everything else (THEORY, TUTORIAL,
// PROJECT) shares the Theory configuration, since Exam Cell only ever
// configures two buckets, not one per SubjectType. A faculty/HOD/Principal
// never picks this themselves - it's always resolved from the subject.
export function subjectTypeToExamType(subjectType: Subject["type"] | undefined): ExamType {
  return subjectType === "PRACTICAL" ? "LAB" : "THEORY";
}

// Looks up a subject's own SubjectType and resolves it to Theory/Lab -
// shared by every caller that only has a subjectId in hand (attendance/marks
// routes keyed off a TeachingAssignment or InternalExamMarksBatch, both of
// which carry subjectId but not the subject's own type).
export async function resolveExamTypeForSubject(
  collegeRef: FirebaseFirestore.DocumentReference,
  subjectId: string
): Promise<ExamType> {
  const subjectSnap = await collegeRef.collection("subjects").doc(subjectId).get();
  const subject = subjectSnap.exists ? (subjectSnap.data() as Subject) : null;
  return subjectTypeToExamType(subject?.type);
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

// Resolves (courseId, year, examType) for a batch and returns its Exam Cell
// config, self-healing for batches saved before InternalExamMarksBatch
// carried its own courseId/courseName (falls back to the linked
// teachingAssignments doc, same as it was always resolved before this field
// existed). examType is always resolved fresh from the batch's own subject
// (see resolveExamTypeForSubject) - a faculty never picks Theory/Lab
// themselves. Returns null if no course/year can be resolved (e.g. a
// semester-scoped assignment) or no config exists yet for that
// course+year+examType.
export async function resolveExamConfigForBatch(
  db: FirebaseFirestore.Firestore,
  collegeRef: FirebaseFirestore.DocumentReference,
  batch: Pick<InternalExamMarksBatch, "courseId" | "year" | "assignmentId" | "subjectId">
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

  const examType = await resolveExamTypeForSubject(collegeRef, batch.subjectId);

  const configSnap = await collegeRef.collection("examConfigurations").doc(examConfigId(courseId, year, examType)).get();
  if (!configSnap.exists) return null;
  const config = { id: configSnap.id, ...configSnap.data() } as ExamConfiguration;
  return { config, courseId, courseName: courseName ?? config.courseName };
}
